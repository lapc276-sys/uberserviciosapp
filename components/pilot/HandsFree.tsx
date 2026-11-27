'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Mic, MicOff, CloudUpload, Smartphone, Pause, Play, BatteryLow } from 'lucide-react';
import type { JobRoom } from '@/lib/workers/job';
import type { CaptureConfig } from '@/lib/activity/recordings';
import { parseJobVoice, type JobVoiceAction } from '@/lib/workers/voice';
import {
  ACTIVE_RECORDINGS,
  deviceInfo,
  digest,
  EventLog,
  isQuotaError,
  post,
  SegmentRecorder,
  SensorRecorder,
  sensorsUnavailable,
  syncClock,
  telemetry,
  uploadPieces,
  watchPressure,
  type CapturedSegment,
  type CapturedSensors,
} from './capture';
import { eventsOf, forgetRecording, piecesOf, putPiece, putRecording, updateRecording } from './recordingStore';

/**
 * Hands-free timing: the phone strapped to the head or chest films the job,
 * and the cleaner marks each room and object by saying its name.
 *
 * It answers with beeps and vibration, never with speech. A phone that said
 * "horno" back would hear itself say "horno" — the same trap the walkthrough
 * avoids (CLAUDE.md, "Nada de lo que dice el bot puede ser una respuesta").
 *
 * What it records is the raw layer of the dataset (docs/DATOS.md):
 * independent 30-second video segments, motion sensor chunks, and a log of
 * every interruption, each checksummed and written to the phone before it is
 * uploaded. Only the cleaner's spoken commands are used: the microphone is
 * never recorded into the video.
 */

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

export interface HandsFreeSetup {
  config: CaptureConfig;
  uploads: boolean;
  /** The worker's wording version, when it is being accepted now; and the customer's yes. */
  consent: { worker?: string; customer: boolean };
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

/**
 * H.264 in MP4 first: it is what the data spec asks for, what current
 * Chrome on Android records, and what phones have a hardware encoder for —
 * probably less heat and battery over three hours than VP8, which many
 * phones encode in software. Not measured on a phone yet. VP8 in WebM where
 * H.264 is not offered; Safari only records MP4 anyway.
 */
const MIME_PREFERENCE = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of MIME_PREFERENCE) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

type WakeLock = { release: () => Promise<void>; addEventListener?: (type: 'release', cb: () => void) => void };

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

type Camera = 'starting' | 'recording' | 'paused' | 'unavailable' | 'full' | 'lost' | 'stopped';

const UNAVAILABLE: Record<string, string> = {
  consent_required: 'Falta aceptar la grabación: apaga y vuelve a activar manos libres.',
  customer_consent_required: 'Falta confirmar que el cliente lo sabe: apaga y vuelve a activar manos libres.',
  no_open_job: 'No hay un trabajo abierto todavía.',
  default: 'Este teléfono no graba desde el navegador. Los tiempos se miden igual.',
};

interface Rec {
  id: string;
  mime: string;
  uploads: boolean;
  /** performance.now() at the recording's t0. */
  t0: number;
}

export function HandsFree({
  ref,
  rooms,
  current,
  onAction,
  setup,
}: {
  ref?: Ref<HandsFreeHandle>;
  rooms: JobRoom[];
  current: { roomKey?: string } | null;
  onAction: (action: JobVoiceAction) => void;
  setup: HandsFreeSetup;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<Camera>('starting');
  const [why, setWhy] = useState('');
  const [voice, setVoice] = useState<'on' | 'off' | 'unsupported' | 'blocked'>('off');
  const [heard, setHeard] = useState<{ text: string; did: string } | null>(null);
  const [uploads, setUploads] = useState<boolean | null>(null);
  const [counts, setCounts] = useState({ uploaded: 0, onPhone: 0 });
  const [sensing, setSensing] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);
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
  const segmentsRef = useRef<SegmentRecorder | null>(null);
  const sensorsRef = useRef<SensorRecorder | null>(null);
  const logRef = useRef<EventLog | null>(null);
  const recRef = useRef<Rec | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const listeningRef = useRef(false);
  const wakeRef = useRef<WakeLock | null>(null);
  const writesRef = useRef<Promise<unknown>>(Promise.resolve());
  const uploadsRef = useRef<Promise<unknown>>(Promise.resolve());
  const uploadedRef = useRef(0);
  const endMonoRef = useRef(0);
  const cleanupRef = useRef<(() => void)[]>([]);
  const stoppedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function refreshCounts(): Promise<void> {
    const rec = recRef.current;
    if (!rec) return;
    const left = await piecesOf(rec.id).catch(() => []);
    setCounts({ uploaded: uploadedRef.current, onPhone: left.length });
  }

  async function flush(): Promise<void> {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.uploads) {
      await uploadPieces(rec.id, () => {
        uploadedRef.current += 1;
      });
    }
    await logRef.current?.flush();
    await refreshCounts();
  }

  /** Every piece: checksummed, written to the phone, then queued for upload. */
  function keep(kind: 'video' | 'sensors', piece: CapturedSegment | CapturedSensors): void {
    const rec = recRef.current;
    if (!rec) return;
    // Every step inside catches: one piece that fails must not stop the
    // chain, or every piece after it would never be written.
    writesRef.current = writesRef.current.then(async () => {
      let sum: Awaited<ReturnType<typeof digest>>;
      try {
        sum = await digest(piece.blob);
      } catch (err) {
        logRef.current?.add('store_error', { kind, index: piece.index, name: (err as Error)?.name ?? 'digest' });
        return;
      }
      endMonoRef.current = Math.max(endMonoRef.current, piece.monoEndMs);
      try {
        await putPiece({
          recordingId: rec.id,
          kind,
          index: piece.index,
          mimeType: kind === 'video' ? rec.mime : 'application/gzip',
          blob: piece.blob,
          bytes: sum.bytes,
          sha256: sum.sha256,
          crc32: sum.crc32,
          monoStartMs: piece.monoStartMs,
          monoEndMs: piece.monoEndMs,
          ...('samples' in piece ? { samples: piece.samples, streams: piece.streams } : {}),
          createdAt: Date.now(),
        });
        void updateRecording(rec.id, { endMonoMs: endMonoRef.current }).catch(() => {});
      } catch (err) {
        if (isQuotaError(err)) {
          // A full phone stops the camera instead of failing piece after
          // piece; the timing goes on, and the log says when and why.
          logRef.current?.add('storage_full', { kind, index: piece.index });
          await segmentsRef.current?.stop();
          setCamera('full');
        } else {
          logRef.current?.add('store_error', { kind, index: piece.index, name: (err as Error)?.name ?? 'error' });
        }
        return;
      }
      uploadsRef.current = uploadsRef.current.then(flush).catch(() => {});
      await refreshCounts().catch(() => {});
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
        if (action.kind !== 'unknown') {
          // What was heard and when, on the phone's clock: the raw half of a
          // marker, next to the server's timestamp for the room. Anything
          // that was not a command is not written anywhere.
          logRef.current?.add('voice_marker', {
            text: text.trim().slice(0, 80),
            action: action.kind,
            ...(action.kind === 'room' ? { roomKey: action.roomKey, taskKey: action.taskKey ?? null } : {}),
          });
          onActionRef.current(action);
        }
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
      const lock = (await nav.wakeLock?.request('screen')) ?? null;
      lock?.addEventListener?.('release', () => {
        if (!stoppedRef.current) logRef.current?.add('wake_lock_lost');
      });
      wakeRef.current = lock;
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
    for (const undo of cleanupRef.current.splice(0)) undo();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }

  /** Lifecycle of the page, as events: each one is a possible hole in the film. */
  function watch(track: MediaStreamTrack): void {
    const log = () => logRef.current;
    const on = (target: EventTarget, type: string, fn: () => void) => {
      target.addEventListener(type, fn);
      cleanupRef.current.push(() => target.removeEventListener(type, fn));
    };
    on(document, 'visibilitychange', () => {
      const visible = document.visibilityState === 'visible';
      log()?.add(visible ? 'visible' : 'hidden');
      // The screen lock is dropped when the tab is hidden; take it back.
      if (visible && listeningRef.current) void keepAwake();
    });
    on(document, 'freeze', () => log()?.add('frozen'));
    on(document, 'resume', () => log()?.add('resumed'));
    on(window, 'pagehide', () => {
      log()?.add('pagehide');
      log()?.beacon();
    });
    on(window, 'offline', () => log()?.add('offline'));
    on(window, 'online', () => {
      log()?.add('online');
      uploadsRef.current = uploadsRef.current.then(flush).catch(() => {});
    });
    on(track, 'mute', () => log()?.add('camera_muted'));
    on(track, 'unmute', () => log()?.add('camera_unmuted'));
    on(track, 'ended', () => {
      if (stoppedRef.current) return;
      log()?.add('camera_ended');
      void segmentsRef.current?.stop();
      setCamera('lost');
    });

    const minute = setInterval(() => {
      void (async () => {
        const rec = recRef.current;
        const pending = rec ? (await piecesOf(rec.id).catch(() => [])).length : 0;
        const snap = await telemetry(streamRef.current?.getVideoTracks()[0] ?? null, pending);
        const b = snap.battery as { level: number; charging: boolean } | null;
        setBattery(b && !b.charging ? b.level : null);
        log()?.add('telemetry', snap);
        if (rec) void updateRecording(rec.id, { heartbeatAt: Date.now() }).catch(() => {});
      })();
    }, 60_000);
    // Two clocks drift apart over three hours; a fresh fix every ten minutes
    // lets the pipeline correct for it instead of trusting the first one.
    const resync = setInterval(() => {
      void syncClock(3).then((fix) => fix && log()?.add('clock_sync', { ...fix }));
    }, 10 * 60_000);
    cleanupRef.current.push(() => clearInterval(minute), () => clearInterval(resync));
    cleanupRef.current.push(watchPressure((state) => log()?.add('pressure', { state })));
  }

  useEffect(() => {
    let cancelled = false;
    const { config } = setup;

    void (async () => {
      await keepAwake();
      const mime = pickMime();
      let stream: MediaStream | null = null;
      if (mime && navigator.mediaDevices?.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: Math.round((config.maxHeight * 4) / 3) },
              height: { ideal: config.maxHeight },
              frameRate: { ideal: config.frameRate, max: config.frameRate },
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
        setWhy(UNAVAILABLE.default);
        setCamera('unavailable');
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();

      const fix = await syncClock(5);
      const t0 = performance.now();
      const res = await post({
        action: 'start',
        mimeType: mime,
        consent: setup.consent,
        clock: { t0EpochMs: performance.timeOrigin + t0, ...(fix ?? {}) },
        capture: {
          mimeType: mime,
          width: settings.width ?? null,
          height: settings.height ?? null,
          frameRate: settings.frameRate ?? null,
          facingMode: settings.facingMode ?? null,
          videoBitsPerSecond: config.videoBitsPerSecond,
          segmentSeconds: config.segmentSeconds,
          audio: false,
        },
        device: deviceInfo(),
      }).catch(() => null);
      const data = res?.ok
        ? ((await res.json()) as { recordingId: string; sessionId: string; startedAt: string; uploads: boolean; clockTrusted: boolean })
        : null;
      if (cancelled) return;
      if (!data) {
        const failure = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
        setWhy(UNAVAILABLE[failure ?? ''] ?? UNAVAILABLE.default);
        setCamera('unavailable');
        return;
      }

      const base = mime.split(';')[0];
      recRef.current = { id: data.recordingId, mime: base, uploads: data.uploads, t0 };
      ACTIVE_RECORDINGS.add(data.recordingId);
      await putRecording({
        heartbeatAt: Date.now(),
        recordingId: data.recordingId,
        sessionId: data.sessionId,
        mimeType: base,
        uploads: data.uploads,
        t0EpochMs: performance.timeOrigin + t0,
        startedAt: data.startedAt,
        clockOffsetMs: fix?.offsetMs,
        clockRttMs: fix?.rttMs,
        capture: { mimeType: mime, width: settings.width, height: settings.height, frameRate: settings.frameRate },
        device: deviceInfo(),
      }).catch(() => {});
      setUploads(data.uploads);
      const log = new EventLog(data.recordingId, t0);
      logRef.current = log;

      const segments = new SegmentRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: config.videoBitsPerSecond,
        segmentMs: config.segmentSeconds * 1000,
        t0,
        onSegment: (s) => keep('video', s),
        onError: (error) => log.add('recorder_error', { error }),
      });
      try {
        segments.start();
      } catch {
        setWhy(UNAVAILABLE.default);
        setCamera('unavailable');
        return;
      }
      segmentsRef.current = segments;
      log.add('recorder_started', { trustedClock: data.clockTrusted });

      const missing = sensorsUnavailable();
      if (missing) {
        log.add('sensors_unavailable', { reason: missing });
      } else {
        const sensors = new SensorRecorder(t0, config.segmentSeconds * 1000, (c) => keep('sensors', c));
        sensors.start();
        sensorsRef.current = sensors;
        setSensing(true);
      }

      watch(track);
      setStartedAt(Date.now());
      setCamera('recording');
    })();

    return () => {
      cancelled = true;
      // Unmounted without stop() — navigating away mid-job: whatever is in
      // the recorders is still written to the phone, for recovery later.
      if (!stoppedRef.current) {
        void segmentsRef.current?.stop();
        void sensorsRef.current?.stop();
      }
      if (recRef.current) ACTIVE_RECORDINGS.delete(recRef.current.id);
      release();
    };
    // Mounting is starting; the latest props are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pauseCamera(): Promise<void> {
    await segmentsRef.current?.stop();
    logRef.current?.add('privacy_pause');
    setCamera('paused');
  }

  function resumeCamera(): void {
    try {
      segmentsRef.current?.start();
      logRef.current?.add('privacy_resume');
      setCamera('recording');
    } catch {
      setWhy(UNAVAILABLE.default);
      setCamera('unavailable');
    }
  }

  useImperativeHandle(ref, () => ({
    async stop() {
      stoppedRef.current = true;
      listeningRef.current = false;
      await segmentsRef.current?.stop();
      await sensorsRef.current?.stop();
      release();
      setCamera('stopped');
      const rec = recRef.current;
      if (!rec) return null;
      await writesRef.current;
      // Give the last uploads a moment; whatever does not make it stays on
      // the phone and is uploaded later or saved as a ZIP.
      await Promise.race([(uploadsRef.current = uploadsRef.current.then(flush).catch(() => {})), new Promise((r) => setTimeout(r, 20_000))]);
      const endMonoMs = Math.max(endMonoRef.current, Math.round(performance.now() - rec.t0));
      const stopped = await post({ action: 'stop', recordingId: rec.id, endMonoMs })
        .then((r) => r.ok)
        .catch(() => false);
      if (stopped) await updateRecording(rec.id, { stoppedAt: new Date().toISOString(), endMonoMs }).catch(() => {});
      const [left, events] = await Promise.all([piecesOf(rec.id).catch(() => []), eventsOf(rec.id).catch(() => [])]);
      // Everything is in the bucket and the log was received: nothing left
      // on the phone to keep.
      if (rec.uploads && stopped && left.length === 0 && events.every((e) => e.posted)) {
        await forgetRecording(rec.id).catch(() => {});
      }
      ACTIVE_RECORDINGS.delete(rec.id);
      return { recordingId: rec.id, mimeType: rec.mime, uploaded: uploadedRef.current, onPhone: left.length, uploads: rec.uploads };
    },
  }));

  const filming = camera === 'recording' || camera === 'paused';

  return (
    <div className="rounded-2xl border-2 border-red-300 p-3 dark:border-red-900/60" data-testid="hands-free">
      <div className="flex gap-3">
        <div className="relative h-[72px] w-24 shrink-0">
          <video ref={videoRef} muted playsInline className="h-full w-full rounded-lg bg-slate-900 object-cover" />
          {camera === 'paused' && (
            <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/80 text-xs font-semibold text-white">
              En pausa
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          {camera === 'recording' && (
            <p className="flex items-center gap-1.5 font-semibold text-red-600">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />
              Grabando {startedAt ? clock(now - startedAt) : ''}
            </p>
          )}
          {camera === 'paused' && <p className="font-semibold text-slate-700 dark:text-slate-200">Cámara en pausa: no se graba nada</p>}
          {camera === 'starting' && <p className="text-slate-500">Encendiendo la cámara…</p>}
          {camera === 'unavailable' && <p className="text-amber-700 dark:text-amber-400">{why}</p>}
          {camera === 'full' && (
            <p className="text-amber-700 dark:text-amber-400">El teléfono se quedó sin espacio y la cámara se paró. Los tiempos se siguen midiendo.</p>
          )}
          {camera === 'lost' && (
            <p className="text-amber-700 dark:text-amber-400">La cámara se cortó (otra app la usa o el teléfono la apagó). Los tiempos se siguen midiendo.</p>
          )}
          {camera === 'stopped' && <p className="text-slate-500">Grabación terminada.</p>}
          {uploads !== null && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" data-testid="hands-free-pieces">
              {uploads ? <CloudUpload className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
              {uploads
                ? `${counts.uploaded} ${counts.uploaded === 1 ? 'parte subida' : 'partes subidas'}${counts.onPhone ? ` · ${counts.onPhone} esperando señal` : ''}`
                : `Guardándose en este teléfono · ${counts.onPhone} ${counts.onPhone === 1 ? 'parte' : 'partes'}`}
              {sensing ? ' · con movimiento' : ''}
            </p>
          )}
          {battery !== null && battery < 0.2 && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <BatteryLow className="h-3.5 w-3.5" /> Batería al {Math.round(battery * 100)}%
            </p>
          )}
        </div>
      </div>

      {/* Someone walks in, a bathroom is occupied: one tap and nothing is
          kept until the next. The pause itself goes in the log, so a gap in
          the film is never mistaken for a lost piece. */}
      {filming && (
        <button
          type="button"
          data-testid="privacy-pause"
          onClick={() => (camera === 'paused' ? resumeCamera() : void pauseCamera())}
          className={`mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border-2 text-sm font-semibold ${
            camera === 'paused' ? 'border-red-400 text-red-700 dark:text-red-300' : 'dark:border-white/15'
          }`}
        >
          {camera === 'paused' ? (
            <>
              <Play className="h-4 w-4" /> Seguir grabando
            </>
          ) : (
            <>
              <Pause className="h-4 w-4" /> Pausar cámara
            </>
          )}
        </button>
      )}

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
