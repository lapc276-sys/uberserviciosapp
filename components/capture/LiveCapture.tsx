'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Video, Square, RotateCcw, AlertTriangle, Upload } from 'lucide-react';
import { encodeToBudget, FRAME_BUDGET_CHARS, TOTAL_BUDGET_CHARS, DEFAULT_FRAME_COUNT } from '@/lib/vision/frames';

/**
 * Records straight from the camera inside the page.
 *
 * The file picker this replaces asked someone standing in a stranger's kitchen
 * to record, save to the gallery, come back, and find the clip — three steps
 * and an app switch for what should be one button.
 *
 * Sampling the live stream also removes the format problem entirely. Reading a
 * saved file means decoding whatever the phone chose to write, which is where
 * HEVC and Android's Infinity-duration bug live; frames drawn off a live
 * `<video>` never touch a container or a codec at all.
 *
 * The picker stays as a fallback, because a browser can always refuse the
 * camera and being unable to capture at all is the one outcome worth avoiding.
 */

export interface LiveCaptureProps {
  onFrames: (frames: string[]) => void;
  /** Rendered when the camera is unavailable, so the caller supplies its own picker. */
  fallback?: React.ReactNode;
  frameCount?: number;
  /** Seconds between samples. Slow enough to move to the next room. */
  intervalMs?: number;
  disabled?: boolean;
  label?: string;
}

type Stage = 'idle' | 'starting' | 'live' | 'recording' | 'denied' | 'unsupported';

export function LiveCapture({
  onFrames,
  fallback,
  frameCount = DEFAULT_FRAME_COUNT,
  intervalMs = 2500,
  disabled,
  label = 'Grabar recorrido',
}: LiveCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const framesRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [captured, setCaptured] = useState(0);
  const [error, setError] = useState('');

  const budget = Math.min(FRAME_BUDGET_CHARS, Math.floor(TOTAL_BUDGET_CHARS / Math.max(1, frameCount)));

  const stopStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // A camera left running after the component goes away keeps the phone's
  // indicator lit, which reads as spyware to whoever owns the kitchen.
  useEffect(() => stopStream, [stopStream]);

  async function start() {
    setError('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStage('unsupported');
      return;
    }

    setStage('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera is the one pointed at the room. `ideal` rather than
        // `exact` so a laptop or a phone with one camera still works.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStage('live');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setStage(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
      setError(
        name === 'NotAllowedError'
          ? 'No diste permiso a la cámara. Púlsalo otra vez y acepta, o usa el botón de abajo.'
          : 'No pude abrir la cámara en este navegador.',
      );
    }
  }

  function grabFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;

    const frame = encodeToBudget(
      canvas,
      (ctx, edge) => {
        const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      },
      budget,
    );

    framesRef.current.push(frame);
    setCaptured(framesRef.current.length);

    if (framesRef.current.length >= frameCount) finish();
  }

  function beginRecording() {
    framesRef.current = [];
    setCaptured(0);
    setStage('recording');

    // One immediately, so a very short walkthrough still yields something.
    grabFrame();
    timerRef.current = setInterval(grabFrame, intervalMs);
  }

  function finish() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const frames = [...framesRef.current];
    stopStream();
    setStage('idle');
    setCaptured(0);
    if (frames.length > 0) onFrames(frames);
    else setError('No se capturó ningún fotograma. Inténtalo otra vez.');
  }

  const cameraUnavailable = stage === 'denied' || stage === 'unsupported';

  return (
    <div className="space-y-3">
      <div
        className={`relative overflow-hidden rounded-2xl bg-slate-900 ${
          stage === 'live' || stage === 'recording' ? 'aspect-[3/4]' : 'hidden'
        }`}
      >
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

        {stage === 'recording' && (
          <>
            <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              Grabando · {captured}/{frameCount}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-center text-sm text-white">
              Camina despacio. Apunta a suelos, encimeras y baños.
            </div>
          </>
        )}
      </div>

      {stage === 'live' && (
        <button
          type="button"
          onClick={beginRecording}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white"
        >
          <span className="h-4 w-4 rounded-full bg-white" /> Empezar a grabar
        </button>
      )}

      {stage === 'recording' && (
        <button
          type="button"
          onClick={finish}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-base font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          <Square className="h-4 w-4" /> Terminar ({captured} {captured === 1 ? 'foto' : 'fotos'})
        </button>
      )}

      {(stage === 'idle' || stage === 'starting') && (
        <button
          type="button"
          onClick={start}
          disabled={disabled || stage === 'starting'}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
        >
          <Video className="h-5 w-5" />
          {stage === 'starting' ? 'Abriendo la cámara…' : label}
        </button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {cameraUnavailable && (
        <div className="space-y-2">
          {stage === 'denied' && (
            <button
              type="button"
              onClick={start}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium"
            >
              <RotateCcw className="h-4 w-4" /> Reintentar la cámara
            </button>
          )}
          {fallback && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
                <Upload className="h-3.5 w-3.5" /> O sube un vídeo que ya tengas grabado:
              </p>
              {fallback}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
