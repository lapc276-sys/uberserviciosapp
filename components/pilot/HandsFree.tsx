'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Mic, MicOff, CloudUpload, Smartphone } from 'lucide-react';
import type { JobRoom } from '@/lib/workers/job';
import { parseJobVoice, type JobVoiceAction } from '@/lib/workers/voice';
import { chunksOf, deleteChunk, putChunk } from './recordingStore';

/**
 * Hands-free timing: the phone strapped to the head or chest films the job,
 * and the cleaner marks each room and object by saying its name.
 *
 * Three decisions shape it.
 *
 * It answers with beeps and vibration, never with speech. A phone that said
 * "horno" back would hear itself say "horno" — the same trap the walkthrough
 * avoids (CLAUDE.md, "Nada de lo que dice el bot puede ser una respuesta").
 *
 * Every 30-second piece of video is written to the phone first and deleted
 * only once the bucket confirms it, so a basement with no signal delays the
 * upload instead of losing the film.
 *
 * And the video is 480p at 15 frames a second, ~0.8 Mbit/s. Recognising
 * "she is cleaning the oven" needs nothing more, and three hours of it is a
 * size a phone battery and a home connection can carry.
 *
 * Only the cleaner's spoken commands are used — the microphone is not
 * recorded into the video. Smaller files, and no recording of conversations
 * in somebody's home.
 */

const CHUNK_MS = 30_000;
const BITRATE = 800_000;

export interface RecordingSummary {
  recordingId: string;
  mimeType: string;
  uploaded: number;
  /** Pieces still only on this phone. */
  onPhone: number;
  uploads: boolean;
}

export interface HandsFreeHandle {
  /** Stops filming and listening, waits for the last piece, and says where the video is. */
  stop: () => Promise<RecordingSummary | null>;
}

// ── Beeps ───────────────────────────────────────────────────────────────────

let audio: AudioContext | null = null;

/** Called from the tap that turns hands-free on: browsers only allow sound after one. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // No sound; vibration still works on Android.
  }
}

function beep(kind: 'start' | 'stop' | 'leave'): void {
  try {
    navigator.vibrate?.(kind === 'start' ? [60, 40, 60] : 150);
  } catch {
    /* not on iPhone */
  }
  if (!audio) return;
  const notes = kind === 'start' ? [660, 880] : kind === 'stop' ? [520] : [520, 390];
  let t = audio.currentTime + 0.01;
  for (const frequency of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.2);
    t += 0.22;
  }
}

// ── Speech recognition (prefixed on Safari, absent in Firefox) ──────────────

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

function newRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  // VP8 before VP9: a phone encodes it with less heat and battery, and the
  // file is for recognising objects, not for watching.
  for (const t of ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

type WakeLock = { release: () => Promise<void> };

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function HandsFree({
  ref,
  rooms,
  current,
  onAction,
}: {
  ref?: Ref<HandsFreeHandle>;
  rooms: JobRoom[];
  current: { roomKey?: string } | null;
  onAction: (action: JobVoiceAction) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'starting' | 'recording' | 'unavailable' | 'stopped'>('starting');
  const [voice, setVoice] = useState<'on' | 'off' | 'unsupported' | 'blocked'>('off');
  const [heard, setHeard] = useState<{ text: string; did: string } | null>(null);
  const [uploads, setUploads] = useState<boolean | null>(null);
  const [counts, setCounts] = useState({ uploaded: 0, onPhone: 0 });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The recognition callback outlives renders; it reads the latest of these.
  const roomsRef = useRef(rooms);
  const currentRef = useRef(current);
  const onActionRef = useRef(onAction);
  roomsRef.current = rooms;
  currentRef.current = current;
  onActionRef.current = onAction;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const listeningRef = useRef(false);
  const wakeRef = useRef<WakeLock | null>(null);
  const recordingRef = useRef<{ id: string; mime: string; uploads: boolean } | null>(null);
  const indexRef = useRef(0);
  const writesRef = useRef<Promise<unknown>>(Promise.resolve());
  const uploadsRef = useRef<Promise<unknown>>(Promise.resolve());
  const uploadedRef = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const post = (body: Record<string, unknown>) =>
    fetch('/api/recordings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function refreshCounts(): Promise<void> {
    const rec = recordingRef.current;
    if (!rec) return;
    const left = await chunksOf(rec.id).catch(() => []);
    setCounts({ uploaded: uploadedRef.current, onPhone: left.length });
  }

  /** Uploads every piece still on the phone, oldest first; stops at the first failure. */
  async function flush(): Promise<void> {
    const rec = recordingRef.current;
    if (!rec?.uploads) return refreshCounts();
    const left = await chunksOf(rec.id).catch(() => []);
    for (const piece of left) {
      try {
        const signed = await post({ action: 'chunk', recordingId: rec.id, index: piece.index });
        if (!signed.ok) break;
        const { url, contentType } = (await signed.json()) as { url: string; contentType: string };
        const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: piece.blob });
        if (!put.ok) break;
        await post({ action: 'uploaded', recordingId: rec.id, index: piece.index, kilobytes: piece.blob.size / 1024 });
        await deleteChunk(rec.id, piece.index);
        uploadedRef.current += 1;
      } catch {
        break; // No signal: the piece waits on the phone for the next try.
      }
    }
    await refreshCounts();
  }

  function onPiece(blob: Blob): void {
    const rec = recordingRef.current;
    if (!rec || blob.size === 0) return;
    const index = ++indexRef.current;
    writesRef.current = writesRef.current
      .then(() => putChunk({ recordingId: rec.id, index, mimeType: rec.mime, blob }))
      .catch(() => {})
      .then(() => {
        uploadsRef.current = uploadsRef.current.then(flush);
        return refreshCounts();
      });
  }

  function listen(): void {
    const recognition = newRecognition();
    if (!recognition) {
      setVoice('unsupported');
      return;
    }
    recognition.lang = 'es-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const text = result[0]?.transcript ?? '';
        const action = parseJobVoice(text, roomsRef.current, currentRef.current);
        if (action.kind === 'room') beep('start');
        if (action.kind === 'pause') beep('stop');
        if (action.kind === 'leave') beep('leave');
        setHeard({
          text: text.trim(),
          did:
            action.kind === 'room'
              ? `▶ ${action.label}`
              : action.kind === 'pause'
                ? '⏸ Parado'
                : action.kind === 'leave'
                  ? '⏹ Para terminar, toca Me voy'
                  : 'No es una orden',
        });
        if (action.kind !== 'unknown') onActionRef.current(action);
      }
    };
    // Recognition ends itself after silence; it is restarted for as long as
    // hands-free is on, which is what makes it feel continuous.
    recognition.onend = () => {
      if (!listeningRef.current) return;
      try {
        recognition.start();
      } catch {
        /* already starting */
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        listeningRef.current = false;
        setVoice('blocked');
      }
    };
    recognitionRef.current = recognition;
    listeningRef.current = true;
    try {
      recognition.start();
      setVoice('on');
    } catch {
      setVoice('off');
    }
  }

  async function keepAwake(): Promise<void> {
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } };
      wakeRef.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* not supported, or the tab is hidden */
    }
  }

  function release(): void {
    listeningRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* already stopped */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await keepAwake();
      const mime = pickMime();
      let stream: MediaStream | null = null;
      if (mime && navigator.mediaDevices?.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 15, max: 15 },
            },
            audio: false,
          });
        } catch {
          stream = null;
        }
      }
      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      // Voice works without the camera: the times still get measured.
      listen();
      if (!stream || !mime) {
        setCamera('unavailable');
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }

      const res = await post({ action: 'start', mimeType: mime, chunkSeconds: CHUNK_MS / 1000 }).catch(() => null);
      const data = res?.ok ? ((await res.json()) as { recordingId: string; uploads: boolean }) : null;
      if (cancelled || !data) {
        if (!data) setCamera('unavailable');
        return;
      }
      recordingRef.current = { id: data.recordingId, mime: mime.split(';')[0], uploads: data.uploads };
      setUploads(data.uploads);

      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE });
      recorder.ondataavailable = (e) => onPiece(e.data);
      recorder.start(CHUNK_MS);
      recorderRef.current = recorder;
      setStartedAt(Date.now());
      setCamera('recording');
    })();

    // The screen lock is dropped when the tab is hidden; take it back.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && listeningRef.current) void keepAwake();
    };
    const onOnline = () => {
      uploadsRef.current = uploadsRef.current.then(flush);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      release();
    };
    // Mounting is starting; the latest props are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    async stop() {
      listeningRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        // The last piece arrives in a final dataavailable, before 'stop'.
        await new Promise<void>((resolve) => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
          recorder.stop();
        });
      }
      release();
      setCamera('stopped');
      const rec = recordingRef.current;
      if (!rec) return null;
      await writesRef.current;
      // Give the last uploads a moment; whatever does not make it stays on
      // the phone and is offered as a download.
      await Promise.race([(uploadsRef.current = uploadsRef.current.then(flush)), new Promise((r) => setTimeout(r, 20_000))]);
      await post({ action: 'stop', recordingId: rec.id }).catch(() => {});
      const left = await chunksOf(rec.id).catch(() => []);
      return { recordingId: rec.id, mimeType: rec.mime, uploaded: uploadedRef.current, onPhone: left.length, uploads: rec.uploads };
    },
  }));

  return (
    <div className="rounded-2xl border-2 border-red-300 p-3 dark:border-red-900/60" data-testid="hands-free">
      <div className="flex gap-3">
        <video ref={videoRef} muted playsInline className="h-[72px] w-24 shrink-0 rounded-lg bg-slate-900 object-cover" />
        <div className="min-w-0 flex-1 text-sm">
          {camera === 'recording' && (
            <p className="flex items-center gap-1.5 font-semibold text-red-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />
              Grabando {startedAt ? clock(now - startedAt) : ''}
            </p>
          )}
          {camera === 'starting' && <p className="text-slate-500">Encendiendo la cámara…</p>}
          {camera === 'unavailable' && (
            <p className="text-amber-700 dark:text-amber-400">Este teléfono no graba desde el navegador. Los tiempos se miden igual.</p>
          )}
          {camera === 'stopped' && <p className="text-slate-500">Grabación terminada.</p>}
          {uploads !== null && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              {uploads ? <CloudUpload className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
              {uploads
                ? `${counts.uploaded} ${counts.uploaded === 1 ? 'parte subida' : 'partes subidas'}${counts.onPhone ? ` · ${counts.onPhone} esperando señal` : ''}`
                : `Guardándose en este teléfono · ${counts.onPhone} ${counts.onPhone === 1 ? 'parte' : 'partes'}`}
            </p>
          )}
        </div>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-sm">
        {voice === 'on' ? <Mic className="h-4 w-4 text-brand-600" /> : <MicOff className="h-4 w-4 text-slate-400" />}
        {voice === 'on' && (
          <span>
            Di <strong>“horno”</strong>, <strong>“baño dos”</strong>, <strong>“termino”</strong>
          </span>
        )}
        {voice === 'unsupported' && <span className="text-slate-500">La voz no funciona en este navegador: usa los botones.</span>}
        {voice === 'blocked' && <span className="text-amber-700 dark:text-amber-400">El micrófono está bloqueado: permítelo para mandar por voz.</span>}
        {voice === 'off' && <span className="text-slate-500">Voz apagada.</span>}
      </p>
      {heard && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="heard">
          Oí “{heard.text}” → <span className="font-medium text-slate-700 dark:text-slate-200">{heard.did}</span>
        </p>
      )}
    </div>
  );
}
