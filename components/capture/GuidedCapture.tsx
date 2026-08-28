'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronRight, Minus, Plus, RotateCcw, SkipForward, Mic, AlertTriangle } from 'lucide-react';
import { encodeToBudget, FRAME_BUDGET_CHARS, TOTAL_BUDGET_CHARS } from '@/lib/vision/frames';
import {
  SPACE_TEMPLATES,
  buildPlan,
  captionFor,
  estimateWalkSeconds,
  MAX_GUIDED_FRAMES,
  MAX_SPACES,
  type CaptureStep,
  type SpaceSelection,
} from '@/lib/capture/guide';
import { getRecognition, speak, stopSpeaking, synthesisSupported, type SpeechRecognitionLike } from '@/lib/speech';
import { normalize } from '@/lib/vision/voice-commands';

/**
 * A walkthrough the app leads, instead of a video the person guesses at.
 *
 * The camera opens once and stays open. For each item on the checklist the
 * phone says what to point at, the person points, one frame is captured, and
 * it moves on. Nothing is saved to the gallery, nothing is uploaded until the
 * end, and the frame count is decided by the checklist rather than by how long
 * someone happened to walk.
 *
 * Voice is first-class here, not a bonus: the phone is held up at arm's length
 * facing a room, so "listo" advancing the step is often the only reachable
 * control. The buttons stay for every browser that has no speech engine.
 */

export interface GuidedResult {
  frames: string[];
  captions: string[];
  /** The depth of clean the person asked for, as a service slug. */
  serviceSlug: string;
}

export interface GuidedCaptureProps {
  onComplete: (result: GuidedResult) => void;
  /** Rendered when the browser will not open a camera. */
  fallback?: React.ReactNode;
  /** Skips the closing depth question when the caller already knows the service. */
  serviceSlug?: string;
  disabled?: boolean;
}

type Stage = 'plan' | 'starting' | 'guiding' | 'review' | 'depth' | 'denied' | 'unsupported';

const DEPTH_OPTIONS = [
  {
    slug: 'house-cleaning',
    label: 'Por encima',
    detail: 'Mantenimiento: polvo, suelos, baños y cocina por fuera.',
  },
  {
    slug: 'deep-cleaning',
    label: 'A fondo',
    detail: 'Todo lo anterior más hornos, dentro de electrodomésticos, juntas y rodapiés.',
  },
  {
    slug: 'move-out-cleaning',
    label: 'Mudanza / entrega',
    detail: 'Casa vacía, todo dentro y fuera de armarios, para entregar las llaves.',
  },
];

/** Spoken words that mean "take the shot" and "I don't have that one". */
const SAY_CAPTURE = ['listo', 'ya', 'ahora', 'foto', 'toma', 'dale', 'ok', 'okay', 'ready'];
const SAY_SKIP = ['saltar', 'salta', 'no tengo', 'no hay', 'siguiente', 'pasa', 'skip'];

export function GuidedCapture({ onComplete, fallback, serviceSlug, disabled }: GuidedCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);

  const [stage, setStage] = useState<Stage>('plan');
  const [selection, setSelection] = useState<SpaceSelection>({ kitchen: 1, bathroom: 1, living_room: 1 });
  const [steps, setSteps] = useState<CaptureStep[]>([]);
  const [index, setIndex] = useState(0);
  const [shots, setShots] = useState<{ step: CaptureStep; frame: string }[]>([]);
  const [heard, setHeard] = useState('');
  const [voiceOn, setVoiceOn] = useState(false);
  const [error, setError] = useState('');

  const plan = buildPlan(selection);
  const totalSpaces = Object.values(selection).reduce((a, b) => a + b, 0);
  const current = steps[index];

  // Budget is fixed by the plan length before the first shot, so every frame in
  // one walkthrough is encoded to the same ceiling and the whole set fits.
  const budget = Math.min(
    FRAME_BUDGET_CHARS,
    Math.floor(TOTAL_BUDGET_CHARS / Math.max(1, steps.length || MAX_GUIDED_FRAMES)),
  );

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopVoice = useCallback(() => {
    listeningRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Already stopped.
    }
    recognitionRef.current = null;
  }, []);

  // A camera or a microphone still live after this component goes away reads
  // as spyware to whoever owns the kitchen.
  useEffect(
    () => () => {
      stopStream();
      stopVoice();
      stopSpeaking();
    },
    [stopStream, stopVoice],
  );

  // ── Capture ────────────────────────────────────────────────────────────────

  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;

    return encodeToBudget(
      canvas,
      (ctx, edge) => {
        const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      },
      budget,
    );
  }, [budget]);

  /**
   * Advancing is a ref-driven callback because the speech recogniser outlives
   * the render that created it; reading `index` from a closure would freeze the
   * walkthrough on whichever step was current when the microphone started.
   */
  const advanceRef = useRef<(action: 'capture' | 'skip') => void>(() => {});

  const advance = useCallback(
    (action: 'capture' | 'skip') => {
      const step = steps[index];
      if (!step) return;

      if (action === 'capture') {
        const frame = grabFrame();
        if (!frame) {
          setError('La cámara todavía no está lista. Espera un segundo y vuelve a intentar.');
          return;
        }
        setShots((prev) => [...prev, { step, frame }]);
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(40);
      }

      setError('');
      const next = index + 1;
      if (next >= steps.length) {
        stopStream();
        stopVoice();
        speak('Listo, ya tengo todo.');
        setStage('review');
      } else {
        setIndex(next);
      }
    },
    [index, steps, grabFrame, stopStream, stopVoice],
  );

  advanceRef.current = advance;

  // Read each instruction aloud as it becomes current.
  useEffect(() => {
    if (stage !== 'guiding' || !current) return;
    speak(current.spoken);
  }, [stage, current]);

  /**
   * Re-binds the stream whenever the stage swaps one `<video>` for another.
   *
   * The planning screen and the walkthrough render the element in different
   * places, so React unmounts one and mounts the other; a `srcObject` set
   * before the swap is attached to a node that no longer exists, and the
   * preview comes up black. Binding from an effect makes the element the
   * source of truth rather than the moment the stream arrived.
   */
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stage]);

  // ── Voice ──────────────────────────────────────────────────────────────────

  const startVoice = useCallback(() => {
    const recognition = getRecognition();
    if (!recognition) return;

    recognition.lang = 'es-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const results = Array.from(event.results as ArrayLike<ArrayLike<{ transcript: string }>>);
      const transcript = results[results.length - 1]?.[0]?.transcript ?? '';
      if (!transcript) return;

      const text = normalize(transcript);
      setHeard(transcript);

      if (SAY_SKIP.some((w) => text.includes(w))) advanceRef.current('skip');
      else if (SAY_CAPTURE.some((w) => text.split(' ').includes(w))) advanceRef.current('capture');
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        listeningRef.current = false;
        setVoiceOn(false);
      }
      // 'no-speech' and 'aborted' are normal during a walkthrough; onend restarts.
    };

    recognition.onend = () => {
      if (!listeningRef.current) return;
      try {
        recognition.start();
      } catch {
        // Already starting; the next onend retries.
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      listeningRef.current = true;
      setVoiceOn(true);
    } catch {
      setVoiceOn(false);
    }
  }, []);

  // ── Start ──────────────────────────────────────────────────────────────────

  async function begin() {
    setError('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStage('unsupported');
      return;
    }

    const built = buildPlan(selection);
    if (built.steps.length === 0) {
      setError('Elige al menos un espacio.');
      return;
    }

    setStage('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // `ideal`, not `exact`, so a laptop or a single-camera phone still works.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setSteps(built.steps);
      setShots([]);
      setIndex(0);
      setStage('guiding');
      startVoice();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setStage(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
      setError(
        name === 'NotAllowedError'
          ? 'No diste permiso a la cámara. Pulsa otra vez y acepta, o sube un vídeo que ya tengas.'
          : 'No pude abrir la cámara en este navegador.',
      );
    }
  }

  function finish(slug: string) {
    onComplete({
      frames: shots.map((s) => s.frame),
      captions: shots.map((s) => captionFor(s.step)),
      serviceSlug: slug,
    });
  }

  function setCount(key: string, delta: number) {
    setSelection((prev) => {
      const next = Math.max(0, Math.min((prev[key] ?? 0) + delta, MAX_SPACES));
      return { ...prev, [key]: next };
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (stage === 'denied' || stage === 'unsupported') {
    return (
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {stage === 'denied' && (
          <button
            type="button"
            onClick={() => {
              setStage('plan');
              setError('');
            }}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium"
          >
            <RotateCcw className="h-4 w-4" /> Reintentar la cámara
          </button>
        )}
        {fallback}
      </div>
    );
  }

  if (stage === 'plan' || stage === 'starting') {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold">¿Qué espacios vamos a ver?</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Te voy guiando uno por uno. Yo te digo a dónde apuntar y tomo la foto — tú solo caminas.
          </p>
        </div>

        <ul className="divide-y rounded-2xl border">
          {SPACE_TEMPLATES.map((tpl) => {
            const count = selection[tpl.key] ?? 0;
            return (
              <li key={tpl.key} className="flex items-center gap-3 p-3">
                <span className="text-xl" aria-hidden>
                  {tpl.emoji}
                </span>
                <span className="flex-1 text-sm font-medium">{tpl.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Quitar ${tpl.label}`}
                    onClick={() => setCount(tpl.key, -1)}
                    disabled={count === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{count}</span>
                  <button
                    type="button"
                    aria-label={`Añadir ${tpl.label}`}
                    onClick={() => setCount(tpl.key, 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {plan.tooManySpaces && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Son demasiados espacios para un solo recorrido. Haz la cocina y los baños primero, y luego
            repite para el resto.
          </p>
        )}

        {plan.droppedOptional > 0 && !plan.tooManySpaces && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Para que quepa en un recorrido dejaré fuera {plan.droppedOptional}{' '}
            {plan.droppedOptional === 1 ? 'toma de detalle' : 'tomas de detalle'} (dentro del horno, la
            basura y parecidos).
          </p>
        )}

        {totalSpaces > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {plan.steps.length} tomas · unos {Math.ceil(estimateWalkSeconds(plan.steps.length) / 60)} min
            caminando.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={begin}
          disabled={disabled || stage === 'starting' || totalSpaces === 0}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
        >
          <Camera className="h-5 w-5" />
          {stage === 'starting' ? 'Abriendo la cámara…' : 'Empezar el recorrido'}
        </button>

        <video ref={videoRef} playsInline muted className="hidden" />
      </div>
    );
  }

  if (stage === 'guiding') {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 aspect-[3/4]">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">
              {current?.spaceLabel} · {index + 1} de {steps.length}
            </p>
            <p className="mt-1 text-xl font-semibold leading-snug text-white">{current?.spoken}</p>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-3">
            {voiceOn ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs text-white">
                <Mic className="h-3.5 w-3.5" /> di “listo”
              </span>
            ) : (
              <span />
            )}
            {heard && <span className="truncate text-xs text-white/60">“{heard}”</span>}
          </div>

          <div
            className="absolute bottom-0 left-0 h-1 bg-brand-500 transition-all"
            style={{ width: `${(index / steps.length) * 100}%` }}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={() => advance('capture')}
          className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white"
        >
          <Camera className="h-6 w-6" /> Tomar la foto
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => advance('skip')}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-medium"
          >
            <SkipForward className="h-4 w-4" /> {current?.optional ? 'No tengo' : 'Saltar'}
          </button>
          {!synthesisSupported() && (
            <span className="flex-1 self-center text-center text-xs text-slate-500">
              Este navegador no habla — lee la instrucción arriba.
            </span>
          )}
        </div>
      </div>
    );
  }

  // review + depth share the thumbnail strip.
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">
          {shots.length} {shots.length === 1 ? 'foto tomada' : 'fotos tomadas'}
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Revisa que se vea lo que hay que limpiar. Si falta algo, repite el recorrido.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {shots.map((s) => (
          <figure key={s.step.id} className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.frame} alt={s.step.title} className="aspect-square w-full rounded-lg object-cover" />
            <figcaption className="truncate text-[10px] leading-tight text-slate-500">{s.step.title}</figcaption>
          </figure>
        ))}
      </div>

      {shots.length === 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          No se tomó ninguna foto. Repite el recorrido y pulsa “Tomar la foto” en cada paso.
        </p>
      )}

      {stage === 'review' && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={shots.length === 0}
            onClick={() => (serviceSlug ? finish(serviceSlug) : setStage('depth'))}
            className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
          >
            Continuar <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShots([]);
              setIndex(0);
              setStage('plan');
            }}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium"
          >
            <RotateCcw className="h-4 w-4" /> Repetir el recorrido
          </button>
        </div>
      )}

      {stage === 'depth' && (
        <div className="space-y-2">
          <h4 className="font-semibold">¿Qué tan a fondo lo quieres?</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Lo mismo de sucio da precios distintos según hasta dónde quieras llegar.
          </p>
          {DEPTH_OPTIONS.map((opt) => (
            <button
              key={opt.slug}
              type="button"
              onClick={() => finish(opt.slug)}
              className="flex w-full items-start gap-3 rounded-xl border p-4 text-left hover:border-brand-500"
            >
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              <span>
                <span className="block font-medium">{opt.label}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">{opt.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
