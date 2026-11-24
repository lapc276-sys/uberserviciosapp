'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, SkipForward, Mic, AlertTriangle } from 'lucide-react';
import { encodeToBudget, FRAME_BUDGET_CHARS, TOTAL_BUDGET_CHARS } from '@/lib/vision/frames';
import {
  SPACE_TEMPLATES,
  buildPlan,
  captionFor,
  droppedNote,
  estimateWalkSeconds,
  shortenedNote,
  planFrameCount,
  MAX_GUIDED_FRAMES,
  MAX_SPACES,
  type CaptureStep,
  type SpaceSelection,
} from '@/lib/capture/guide';
import { SettleWatcher, STILL, difference, signatureOf, spreadPick, type Signature } from '@/lib/capture/scene';
import { SAY, grayOf, isTooDark, panTooFast, sharpnessOf, usablePanFrames } from '@/lib/capture/quality';
import {
  PRODUCT_LABELS,
  SAY_CHAT,
  TIME_LABELS,
  TOOLS_LABELS,
  WHEN_LABELS,
  parseDepth,
  parseProducts,
  parseTools,
  parseWhen,
  parseYesNo,
  spokenQuestion,
  visitNote,
  wantsToContinue,
  type ProductPreference,
  type TimeOfDay,
  type ToolsPreference,
  type VisitDetails,
  type WhenPreference,
} from '@/lib/capture/conversation';
import { getRecognition, isSpeaking, speak, stopSpeaking, synthesisSupported, type SpeechRecognitionLike } from '@/lib/speech';
import { normalize } from '@/lib/vision/voice-commands';
import { readJson } from '@/lib/http';
import type { RoomQuestion, Answers, RepairRequest } from '@/lib/vision/upsell';
import { REPAIR, depthChoicesFrom, noteFrom, repairNote, repairsFrom } from '@/lib/vision/upsell';

/**
 * A walkthrough the app leads, instead of a video the person guesses at.
 *
 * The camera opens once and runs continuously. The phone says what to point
 * at, watches the stream, and takes the shot itself the moment the view has
 * changed and then held still — someone swinging a fridge door open and
 * steadying their hand. Then it says "ya puedes cerrarla" and moves on. No
 * button is pressed at any point in a normal walkthrough.
 *
 * Deciding when to shoot is done on the phone, by comparing 32x32 thumbnails
 * (see lib/capture/scene.ts). The alternative — asking a vision model "is the
 * fridge open yet?" once a second — is a network round trip per check, in
 * someone else's kitchen, on one bar of signal: slower, far more expensive,
 * and a hundred new ways for the walkthrough to die halfway. The model gets
 * the whole set once, at the end, where it is actually good.
 *
 * Every automatic path has a manual one beside it, because a phone held
 * perfectly still from the start never produces the change the watcher waits
 * for. The shutter button stays, voice stays, and a step that sees nothing
 * decisive shoots anyway rather than stranding someone mid-kitchen.
 */

export interface GuidedResult {
  frames: string[];
  captions: string[];
  /** The depth of clean the person asked for, as a service slug. */
  serviceSlug: string;
  /**
   * What the customer wants special attention on, in their own words.
   *
   * Worth asking because it is the one thing the frames genuinely cannot show:
   * two identical bathrooms carry different work when one owner cares about
   * the grout and the other only ever looks at the mirror. It also gives the
   * crew somewhere obvious to earn a tip.
   */
  focus?: string;
  /**
   * What they said when asked "inside the oven?" in each room.
   *
   * Keyed "<roomType>:<object>". A "no" is carried as explicitly as a "yes":
   * on a deep clean it is the only way to decline the inside of a fridge that
   * is otherwise included and billed.
   */
  depthChoices?: Record<string, 'surface' | 'deep'>;
  /** The spaces actually filmed, by name — so a message describes the home that was walked. */
  spaces: string[];
  /** What they answered in the closing chat: when, which products, whose vacuum. */
  visit?: VisitDetails;
  /** Broken things they want to be contacted about. Never priced. */
  repairs?: RepairRequest[];
  /**
   * Everything above, as one Spanish paragraph for the company — the lead,
   * the WhatsApp message. Undefined when there is nothing to say.
   */
  notes?: string;
}

export interface GuidedCaptureProps {
  onComplete: (result: GuidedResult) => void;
  /** Rendered when the browser will not open a camera. */
  fallback?: React.ReactNode;
  /** Skips the closing depth question when the caller already knows the service. */
  serviceSlug?: string;
  disabled?: boolean;
  /**
   * A fixed plan to walk, instead of asking which spaces there are.
   *
   * This is what makes an "after" pass comparable to its "before". Measuring
   * improvement means subtracting two scores of the SAME surface; a free-form
   * second walkthrough produces a photo of whatever the person pointed at,
   * and the difference between "inside the microwave" and "a countertop" is
   * not a quality score, it is noise. Replaying the plan guarantees frame i
   * of the after shows what frame i of the before showed.
   */
  plan?: CaptureStep[];
  /** Reports the plan actually walked, so an "after" pass can replay it. */
  onPlan?: (steps: CaptureStep[]) => void;
  /** Shown above the walkthrough, e.g. "Repite el recorrido del principio". */
  title?: string;
}

type Stage =
  | 'plan'
  | 'starting'
  | 'guiding'
  | 'questions'
  | 'review'
  | 'chat'
  | 'depth'
  | 'denied'
  | 'unsupported';

/** The closing questions, in the order they are asked. */
type ChatTopic = 'when' | 'products' | 'tools';
const CHAT_ORDER: ChatTopic[] = ['when', 'products', 'tools'];

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

/**
 * Spoken words that mean "take the shot" and "I don't have that one".
 *
 * `ya`, `ahora` and `ok` used to be here and are deliberately gone. Two
 * separate problems, and the second survives even with the microphone muted
 * while the phone talks:
 *
 *   The app said them. Six instructions open with "Ahora" and every
 *   confirmation is "Listo, ya puedes cerrarlo", so the speaker triggered the
 *   next step through its own microphone.
 *
 *   People say them. Somebody walking a homeowner through their kitchen says
 *   "ya", "ok" and "ahora" constantly without addressing the app at all. A
 *   command has to be a word you would not say by accident.
 */
const SAY_CAPTURE = ['listo', 'foto', 'toma', 'dale', 'ready'];
const SAY_SKIP = ['saltar', 'salta', 'no tengo', 'no hay', 'siguiente', 'pasa', 'skip'];

/** How often the stream is sampled while looking for the shot. */
const WATCH_INTERVAL_MS = 400;

/**
 * A step that has seen nothing decisive for this long shoots anyway.
 *
 * Someone who holds the phone perfectly steady from the first instruction
 * never produces the change-then-settle the watcher waits for, and waiting
 * forever for a signal that is not coming is worse than an imperfect frame.
 */
const SETTLE_TIMEOUT_MS = 9000;

/** Grace period after speaking, so the shot isn't taken mid-instruction. */
const LEAD_IN_MS = 1200;

/** A pan samples across this window, then keeps the most different frames. */
const PAN_WINDOW_MS = 7000;

/**
 * After asking for light, how long a step waits for it before shooting what
 * it has. Long enough to reach a switch; short enough that a home with a
 * blown bulb is not a walkthrough that stops.
 */
const DARK_GRACE_MS = 7000;

/** A pan that found the room dark starts its sweep again after this. */
const DARK_PAUSE_MS = 2500;

/**
 * Still moving this long into a step, the safety timeout is about to shoot
 * blind — so the bot asks for a steady hand first. Late on purpose: walking to
 * the fridge and opening it is movement too, and nobody needs to be told to
 * hold still while they are still walking.
 */
const SHAKE_WARN_MS = 6500;

/** Extra sweep time after "más despacio", so the slower pass fits. */
const PAN_SLOWER_EXTRA_MS = 3000;

/** One sample of a pan, with what the quality check needs to choose among them. */
interface PanSample {
  frame: string;
  signature: Signature | null;
  dark: boolean;
  sharpness: number;
}

export function GuidedCapture({
  onComplete,
  fallback,
  serviceSlug,
  disabled,
  plan: fixedPlan,
  onPlan,
  title,
}: GuidedCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  /** When the current step began, for the voice lead-in guard. */
  const stepStartedAt = useRef(0);
  /**
   * The recogniser outlives renders, so it reads the stage through a ref. What
   * a word means depends on it: "dale" takes the shot while guiding and is a
   * yes while a question is open.
   */
  const stageRef = useRef<Stage>('plan');
  /** Applies a spoken answer to whichever question is open. Reassigned each render. */
  const answerRef = useRef<(heard: string) => void>(() => {});
  /** The same, for the closing chat and the depth question. */
  const chatAnswerRef = useRef<(heard: string) => void>(() => {});
  const resumeRef = useRef<() => void>(() => {});
  /** How the last question was answered — by voice, the walk resumes by itself. */
  const lastAnswerVia = useRef<'voice' | 'touch' | null>(null);

  const [stage, setStage] = useState<Stage>('plan');
  stageRef.current = stage;
  const [selection, setSelection] = useState<SpaceSelection>({ kitchen: 1, bathroom: 1, living_room: 1 });
  const [steps, setSteps] = useState<CaptureStep[]>([]);
  const [index, setIndex] = useState(0);
  const [shots, setShots] = useState<{ step: CaptureStep; frame: string }[]>([]);
  const [heard, setHeard] = useState('');
  const [voiceOn, setVoiceOn] = useState(false);
  const [watching, setWatching] = useState<'waiting' | 'moving' | 'settling'>('waiting');
  /** What the bot just asked for about the shot itself — light, mostly. */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Which step we are re-shooting, if any.
   *
   * Retaking one step rather than the whole walkthrough matters more than it
   * looks: somebody who has already opened an oven, a fridge and four
   * cupboards will not do all of it again because one frame came out blurry.
   * They will accept the bad frame, and the estimate is then built on it.
   */
  const [retakeOf, setRetakeOf] = useState<number | null>(null);
  /**
   * Questions per space, filled in by the scout while the walk continues.
   *
   * The scout fires the moment a room's pan ends and the answer is not waited
   * for: by the time the last step of that room is done, thirty seconds have
   * passed and it is back. Asking straight after the pan would have been the
   * obvious design and would have parked somebody in their own kitchen
   * watching a spinner.
   */
  const [scouted, setScouted] = useState<Record<string, RoomQuestion[]>>({});
  const [answers, setAnswers] = useState<Answers>({});
  /** Where the walkthrough resumes once the questions are answered. */
  const [gateNext, setGateNext] = useState<number | null>(null);
  const [focus, setFocus] = useState('');
  /** The closing chat's answers. */
  const [visit, setVisit] = useState<VisitDetails>({});
  /** How the last closing answer arrived — by voice, the chat moves on by itself. */
  const chatVia = useRef<'voice' | 'touch' | null>(null);
  const [error, setError] = useState('');

  const plan = buildPlan(selection);
  const totalSpaces = Object.values(selection).reduce((a, b) => a + b, 0);
  const current = steps[index];

  // Fixed by the plan before the first shot, so every frame in one walkthrough
  // is encoded to the same ceiling and the whole set fits. Divides by frames
  // rather than steps, because a pan contributes several.
  const budget = Math.min(
    FRAME_BUDGET_CHARS,
    Math.floor(TOTAL_BUDGET_CHARS / Math.max(1, planFrameCount(steps) || MAX_GUIDED_FRAMES)),
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

  const grabSignature = useCallback((): Signature | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    return signatureOf(video, video.videoWidth, video.videoHeight);
  }, []);

  const grabGray = useCallback((): Uint8Array | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    return grayOf(video, video.videoWidth, video.videoHeight);
  }, []);

  /**
   * The phone's flashlight, where the browser exposes it.
   *
   * Chrome on Android does, for the rear camera; Safari does not. Where it
   * exists the bot simply turns it on when a space is dark — the person is
   * holding a fridge door open and has no free hand for a light switch.
   * Everything here fails silently, because a flashlight is a convenience and
   * the shot goes ahead either way.
   */
  const torchAvailable = useCallback((): boolean => {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      return Boolean(caps.torch);
    } catch {
      return false;
    }
  }, []);

  const setTorch = useCallback(async (on: boolean): Promise<void> => {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    } catch {
      // No flashlight, or it refused. The step carries on.
    }
  }, []);

  /**
   * Ref-driven because both the speech recogniser and the sampling interval
   * outlive the render that created them; reading `index` from a closure would
   * freeze the walkthrough on whichever step was current when they started.
   */
  /**
   * Asks the server what is in the room just panned, and keeps the questions.
   *
   * Never surfaces a failure. A room that could not be looked at simply has
   * no questions and the fixed script carries on, which is the only
   * acceptable behaviour in a basement with no signal.
   */
  const scoutSpace = useCallback(
    async (spaceKey: string, roomType: string, spaceLabel: string, frames: string[]) => {
      if (frames.length === 0) return;
      try {
        const res = await fetch('/api/vision/scout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames, roomType, serviceSlug }),
        });
        const { data } = await readJson<{ questions?: RoomQuestion[] }>(res);
        // A broken thing belongs to THIS space, not to every bathroom: the
        // server only knows the room type, so the walkthrough names the place.
        const questions = (data?.questions ?? []).map((q) =>
          q.kind === 'repair' ? { ...q, id: `${spaceKey}:${REPAIR}`, place: spaceLabel } : q,
        );
        if (questions.length) setScouted((prev) => ({ ...prev, [spaceKey]: questions }));
      } catch {
        // Deliberately silent — see above.
      }
    },
    [serviceSlug],
  );

  const advanceRef = useRef<(action: 'capture' | 'skip', collected?: string[]) => void>(() => {});

  const advance = useCallback(
    (action: 'capture' | 'skip', collected?: string[]) => {
      const step = steps[index];
      if (!step) return;

      if (action === 'capture') {
        const frames = collected?.length ? collected : [grabFrame()].filter((f): f is string => !!f);
        if (frames.length === 0) {
          setError('La cámara todavía no está lista. Espera un segundo.');
          return;
        }
        setShots((prev) => {
          const fresh = frames.map((frame) => ({ step, frame }));
          // Replace this step's previous shots, keeping walkthrough order.
          const without = prev.filter((s) => s.step.id !== step.id);
          const at = prev.findIndex((s) => s.step.id === step.id);
          if (at === -1) return [...without, ...fresh];
          const before = without.slice(0, at);
          return [...before, ...fresh, ...without.slice(at)];
        });
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(40);
        if (step.after) speak(step.after);

        // The pan is the only step that sees the whole room, so it is the one
        // worth asking the model about. Fired and not awaited.
        if (step.mode === 'pan') void scoutSpace(step.spaceKey, step.roomType, step.spaceLabel, frames);
      }

      setError('');

      // A retake replaces one step's shots and returns; it does not walk on.
      if (retakeOf !== null) {
        setRetakeOf(null);
        stopStream();
        stopVoice();
        setStage('review');
        return;
      }

      const next = index + 1;

      // Questions are asked as a room is left, not as it is entered: by now
      // the scout has had the whole room's worth of steps to come back, so
      // nobody waits, and the person is still standing in the room being
      // asked about.
      const leavingSpace = steps[next]?.spaceKey !== step.spaceKey;
      const pending = scouted[step.spaceKey];
      // Only when something is still open. Depth questions are keyed by room
      // type, so the second bathroom's "¿la ducha a fondo?" was answered in the
      // first — stopping somebody to show them a card with nothing to answer,
      // and waiting for them to say "seguir", is the conversation stalling.
      if (leavingSpace && pending?.some((q) => answers[q.id] === undefined)) {
        setGateNext(next);
        setHeard('');
        setStage('questions');
        return;
      }

      if (next >= steps.length) {
        stopStream();
        stopVoice();
        speak('Listo, ya tengo todo.');
        setStage('review');
      } else {
        setIndex(next);
      }
    },
    [index, steps, grabFrame, stopStream, stopVoice, retakeOf, scouted, scoutSpace, answers],
  );

  /** Closes the question card and puts the walkthrough back where it was. */
  const resumeFromQuestions = useCallback(() => {
    const next = gateNext ?? index + 1;
    setGateNext(null);
    lastAnswerVia.current = null;
    if (next >= steps.length) {
      stopStream();
      stopVoice();
      speak('Listo, ya tengo todo.');
      setStage('review');
    } else {
      setStage('guiding');
      setIndex(next);
    }
  }, [gateNext, index, steps.length, stopStream, stopVoice]);

  advanceRef.current = advance;
  resumeRef.current = resumeFromQuestions;

  // ── Questions, said out loud ───────────────────────────────────────────────

  const roomQuestions = stage === 'questions' ? (scouted[steps[index]?.spaceKey] ?? []) : [];
  const openQuestion = roomQuestions.find((q) => answers[q.id] === undefined);

  const answerQuestion = useCallback((id: string, value: boolean, via: 'voice' | 'touch') => {
    lastAnswerVia.current = via;
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  answerRef.current = (heard: string) => {
    if (stageRef.current !== 'questions') return;
    if (wantsToContinue(heard)) {
      resumeFromQuestions();
      return;
    }
    if (!openQuestion) return;
    const yes = parseYesNo(heard);
    // Not clearly a yes or a no: leave the question open rather than guess.
    if (yes !== null) answerQuestion(openQuestion.id, yes, 'voice');
  };

  /**
   * Asks the open question aloud, and the next one once it is answered.
   *
   * When the last one was answered by voice the walk simply carries on — the
   * person never had to look at the screen, and making them tap "Seguir"
   * would undo that. Answered by touch, they are looking at the card already
   * and may want to change an answer, so the button is theirs to press.
   */
  useEffect(() => {
    if (stage !== 'questions') return;
    if (openQuestion) {
      speak(spokenQuestion(openQuestion));
      return;
    }
    if (lastAnswerVia.current === 'voice') {
      speak(SAY_CHAT.moveOn);
      const t = setTimeout(() => resumeRef.current(), 1200);
      return () => clearTimeout(t);
    }
    // Keyed on the question, not the object: re-running for the same open
    // question would read it out again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, openQuestion?.id]);

  // ── The closing chat ───────────────────────────────────────────────────────

  /** The first closing question still open. "Elegir día" without a day is still open. */
  const openChat: ChatTopic | undefined =
    stage === 'chat'
      ? CHAT_ORDER.find((topic) =>
          topic === 'when' ? !visit.when || (visit.when === 'date' && !visit.date) : !visit[topic],
        )
      : undefined;

  const setVisitPart = useCallback((part: Partial<VisitDetails>, via: 'voice' | 'touch') => {
    chatVia.current = via;
    setVisit((prev) => ({ ...prev, ...part }));
  }, []);

  const finishRef = useRef<(slug: string) => void>(() => {});

  chatAnswerRef.current = (heard: string) => {
    const at = stageRef.current;
    if (at === 'depth') {
      const slug = parseDepth(heard);
      if (slug) finishRef.current(slug);
      return;
    }
    if (at !== 'chat') return;
    if (wantsToContinue(heard)) {
      setStage('depth');
      return;
    }
    // Only the open question is listened for: "por la tarde" while the bot is
    // asking about products is not an answer to anything.
    if (openChat === 'when') {
      const parsed = parseWhen(heard);
      if (parsed.when || parsed.timeOfDay) setVisitPart(parsed, 'voice');
    } else if (openChat === 'products') {
      const products = parseProducts(heard);
      if (products) setVisitPart({ products }, 'voice');
    } else if (openChat === 'tools') {
      const tools = parseTools(heard);
      if (tools) setVisitPart({ tools }, 'voice');
    }
  };

  /** Asks the open closing question aloud; carries on by itself after a spoken last answer. */
  useEffect(() => {
    if (stage !== 'chat') return;
    if (openChat) {
      speak(SAY_CHAT[openChat]);
      return;
    }
    if (chatVia.current === 'voice') {
      speak(SAY_CHAT.closing);
      const t = setTimeout(() => setStage('depth'), 900);
      return () => clearTimeout(t);
    }
  }, [stage, openChat]);

  useEffect(() => {
    if (stage === 'depth') speak(SAY_CHAT.depth);
  }, [stage]);

  /**
   * Runs one step: speak it, watch the stream, shoot when it is right.
   *
   * All of a step's behaviour lives in this one effect, keyed on the step
   * itself, so moving to the next step tears the whole thing down — timers,
   * watcher, pan buffer — and builds it again. Sharing any of that across
   * steps is how a pan's leftover frames end up attached to the next
   * instruction.
   *
   * It also talks back when the shot would be useless — too dark to see, a
   * phone that never stops moving, a pan swung instead of swept — the way the
   * person holding the camera would if they were a cleaner. Each of those is
   * said at most once per step: a phone that nags is a phone people stop
   * listening to, and every one of them ends in a shot regardless.
   */
  useEffect(() => {
    if (stage !== 'guiding' || !current) return;

    speak(current.spoken);
    stepStartedAt.current = Date.now();
    setWatching('waiting');
    setNotice(null);

    const watcher = new SettleWatcher();
    const panBuffer: PanSample[] = [];
    const panDeltas: number[] = [];
    let startedAt = Date.now();
    let previous: Signature | null = null;
    let done = false;
    let warnedDark = false;
    let warnedShake = false;
    let warnedFast = false;
    /** Set while the step waits for the light it asked for. */
    let lightBy = 0;
    let panExtraMs = 0;
    let torchOn = false;

    const finishStep = (frames?: string[]) => {
      if (done) return;
      done = true;
      advanceRef.current('capture', frames);
    };

    const askForLight = () => {
      warnedDark = true;
      if (torchAvailable()) {
        torchOn = true;
        void setTorch(true);
        speak(SAY.darkTorch);
        setNotice('Está oscuro: encendí la linterna');
      } else {
        speak(SAY.dark);
        setNotice('Está muy oscuro: enciende la luz');
      }
    };

    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startedAt;
      // Don't shoot over the instruction still being spoken.
      if (elapsed < LEAD_IN_MS) return;

      const signature = grabSignature();
      const delta = difference(previous, signature);
      previous = signature;
      const dark = isTooDark(signature);

      if (current.mode === 'pan') {
        // Light first: a sweep through a dark room is several photographs of
        // nothing, and the room's questions are built from them.
        if (dark && !warnedDark) {
          askForLight();
          panBuffer.length = 0;
          panDeltas.length = 0;
          previous = null;
          startedAt = now + DARK_PAUSE_MS;
          return;
        }

        const frame = grabFrame();
        if (frame) panBuffer.push({ frame, signature, dark, sharpness: sharpnessOf(grabGray()) });
        // The first sample has nothing to compare with and reads as 1.
        if (delta < 1) panDeltas.push(delta);
        setWatching('moving');

        if (!warnedFast && panTooFast(panDeltas)) {
          warnedFast = true;
          speak(SAY.slower);
          panExtraMs = PAN_SLOWER_EXTRA_MS;
        }

        if (elapsed >= LEAD_IN_MS + PAN_WINDOW_MS + panExtraMs) {
          // Keep the most different frames, so a sweep covers the room rather
          // than returning three photographs of the same cupboard — choosing
          // only among the ones that are lit and in focus, or a fast swing
          // wins by being the most "different" blur.
          finishStep(spreadPick(usablePanFrames(panBuffer, current.frames), current.frames));
        }
        return;
      }

      const settled = watcher.push(signature);
      setWatching(watcher.state);

      // Waiting for the light that was asked for: shoot as soon as there is
      // some and the phone is steady, and never wait past the grace period.
      if (lightBy) {
        if ((!dark && delta <= STILL) || now >= lightBy) finishStep();
        return;
      }

      // Settled, or nothing decisive for long enough: someone holding the
      // phone steady from the start never produces the change the watcher
      // waits for.
      if (settled || elapsed >= LEAD_IN_MS + SETTLE_TIMEOUT_MS) {
        if (dark && !warnedDark) {
          askForLight();
          lightBy = now + DARK_GRACE_MS;
          return;
        }
        finishStep();
        return;
      }

      // Still moving this late, the timeout is about to shoot whatever is in
      // front of the lens. Ask for a steady hand first.
      if (!warnedShake && watcher.state === 'moving' && elapsed >= LEAD_IN_MS + SHAKE_WARN_MS) {
        warnedShake = true;
        speak(SAY.steady);
      }
    }, WATCH_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      done = true;
      if (torchOn) void setTorch(false);
    };
  }, [stage, current, grabFrame, grabSignature, grabGray, torchAvailable, setTorch]);

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

      // The phone's speaker reaches its own microphone. Anything heard while
      // it is talking is the app hearing itself, not the person.
      if (isSpeaking()) return;

      // Answering a question is a different conversation from driving the
      // camera: "dale" is a yes here, and must not photograph whatever the
      // phone happens to face while somebody reads the card.
      if (stageRef.current === 'questions') {
        setHeard(transcript);
        answerRef.current(transcript);
        return;
      }
      if (stageRef.current === 'chat' || stageRef.current === 'depth') {
        setHeard(transcript);
        chatAnswerRef.current(transcript);
        return;
      }
      if (stageRef.current !== 'guiding') return;

      // The same grace period the shutter honours. A command arriving before
      // the instruction has finished landing is almost always the tail of the
      // previous step, and it would shoot at whatever the camera is pointed at
      // while somebody is still walking.
      if (Date.now() - stepStartedAt.current < LEAD_IN_MS) return;

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

    const built = fixedPlan?.length ? { steps: fixedPlan } : buildPlan(selection);
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
      onPlan?.(built.steps);
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
    stopVoice();
    const asked = Object.values(scouted).flat();
    const tidying = noteFrom(asked, answers);
    // The tidy-up request rides along with whatever the customer typed, since
    // clutter is already a scored dimension and must not be billed twice as
    // minutes. The crew still has to be told in words.
    const focusNotes = [focus.trim(), tidying].filter(Boolean).join(' ');
    const repairs = repairsFrom(asked, answers);
    // For the company, not the model: when, with what, and what to fix. None
    // of it is about where to look in the photos, so none of it goes in focus.
    const companyNotes = [visitNote(visit), repairNote(repairs)].filter(Boolean).join(' ');

    onComplete({
      frames: shots.map((s) => s.frame),
      captions: shots.map((s) => captionFor(s.step)),
      serviceSlug: slug,
      focus: focusNotes || undefined,
      depthChoices: depthChoicesFrom(asked, answers),
      spaces: [...new Set(shots.map((s) => s.step.spaceLabel))],
      visit: Object.keys(visit).length ? visit : undefined,
      repairs: repairs.length ? repairs : undefined,
      notes: companyNotes || undefined,
    });
  }
  finishRef.current = finish;

  /** From the review to the closing chat, listening again for the answers. */
  function beginChat() {
    setHeard('');
    setStage('chat');
    startVoice();
  }

  /** Re-opens the camera on one already-shot step. */
  async function retake(stepIndex: number) {
    setRetakeOf(stepIndex);
    setIndex(stepIndex);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setStage('guiding');
      startVoice();
    } catch {
      setRetakeOf(null);
      setError('No pude volver a abrir la cámara.');
    }
  }

  /** Steps back one, discarding what that step captured. */
  function goBack() {
    if (index === 0) return;
    const previous = steps[index - 1];
    setShots((prev) => prev.filter((s) => s.step.id !== previous.id));
    setIndex(index - 1);
    setError('');
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

  if ((stage === 'plan' || stage === 'starting') && fixedPlan?.length) {
    // Replaying a known plan: nothing to choose, so nothing is asked.
    const spaces = Array.from(new Set(fixedPlan.map((s) => s.spaceLabel)));
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold">{title ?? 'Repite el mismo recorrido'}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Los mismos {fixedPlan.length} pasos, en el mismo orden. Te voy guiando igual que antes — así
            cada foto del después se compara con la misma foto del antes.
          </p>
        </div>

        <ul className="rounded-2xl border divide-y text-sm">
          {spaces.map((label) => (
            <li key={label} className="flex items-center gap-2 p-3">
              <Check className="h-4 w-4 shrink-0 text-brand-600" />
              {label}
            </li>
          ))}
        </ul>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={begin}
          disabled={disabled || stage === 'starting'}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
        >
          <Camera className="h-5 w-5" />
          {stage === 'starting' ? 'Abriendo la cámara…' : 'Empezar'}
        </button>

        <video ref={videoRef} playsInline muted className="hidden" />
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

        {/* Named, never counted. "6 tomas de detalle" is the sentence that
            once hid three whole rooms — and a room nobody filmed is a room
            the price does not charge for. */}
        {droppedNote(plan) && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {droppedNote(plan)}
          </p>
        )}

        {shortenedNote(plan) && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{shortenedNote(plan)}</p>
        )}

        {totalSpaces > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {plan.steps.length} pasos · {planFrameCount(plan.steps)} fotos · unos{' '}
            {Math.ceil(estimateWalkSeconds(plan.steps) / 60)} min caminando. No tienes que pulsar nada:
            la cámara dispara sola.
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

  if (stage === 'guiding' || stage === 'questions') {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 aspect-[3/4]">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">
              {current?.spaceLabel} · {index + 1} de {steps.length}
            </p>
            <p className="mt-1 text-xl font-semibold leading-snug text-white">{current?.spoken}</p>
            {notice && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/90 px-2.5 py-1 text-sm font-medium text-black">
                <AlertTriangle className="h-4 w-4" /> {notice}
              </p>
            )}
          </div>

          {/* What the app is doing right now. Without this the camera looks
              frozen while it waits, and people start pressing things. */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent p-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white ${
                watching === 'settling' ? 'bg-emerald-600' : 'bg-white/15'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  watching === 'waiting' ? 'bg-white/70' : 'animate-pulse bg-white'
                }`}
              />
              {current?.mode === 'pan'
                ? 'Grabando el paneo…'
                : watching === 'settling'
                  ? 'Quieto… tomando la foto'
                  : watching === 'moving'
                    ? 'Te veo, sujeta el teléfono quieto'
                    : 'Esperando a que apuntes'}
            </span>
            {voiceOn && (
              <span className="inline-flex items-center gap-1 text-xs text-white/60">
                <Mic className="h-3.5 w-3.5" />
                {heard ? `“${heard}”` : 'di “listo”'}
              </span>
            )}
          </div>

          <div
            className="absolute bottom-0 left-0 h-1 bg-brand-500 transition-all"
            style={{ width: `${(index / steps.length) * 100}%` }}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* What the camera just saw, asked about before leaving the room.
            Every question here was generated from objects actually detected
            in this room — see lib/vision/upsell.ts — because a question about
            an oven in a kitchen with no oven teaches the customer that the
            price is guesswork too. */}
        {stage === 'questions' && gateNext !== null && (
          <div className="space-y-3 rounded-2xl border-2 border-brand-500 bg-brand-50 p-4 dark:bg-brand-950/30">
            <p className="text-sm font-medium text-brand-900 dark:text-brand-200">
              {roomQuestions.length === 1
                ? 'Antes de seguir, una pregunta sobre este espacio'
                : 'Antes de seguir, unas preguntas sobre este espacio'}
            </p>
            {voiceOn && (
              <p className="flex items-center gap-1.5 text-xs text-brand-900/70 dark:text-brand-200/70">
                <Mic className="h-3.5 w-3.5" />
                {heard ? `Te oí: “${heard}”` : 'Contesta en voz alta: “sí” o “no”'}
              </p>
            )}

            {roomQuestions.map((q) => {
              const answered = answers[q.id];
              return (
                <div
                  key={q.id}
                  className={`rounded-xl bg-white p-3 dark:bg-white/5 ${
                    q.id === openQuestion?.id ? 'ring-2 ring-brand-500' : ''
                  }`}
                >
                  <p className="text-base font-medium">{q.prompt}</p>
                  {q.extraMinutes > 0 && (
                    /* Shown so a yes is informed rather than a trap: nobody
                       should discover what they agreed to on the invoice. */
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Añade unos {q.extraMinutes} min al trabajo
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { label: 'Sí', value: true },
                      { label: 'No', value: false },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => answerQuestion(q.id, opt.value, 'touch')}
                        className={`min-h-[48px] rounded-xl border-2 text-base font-medium transition-colors ${
                          answered === opt.value
                            ? 'border-brand-600 bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100'
                            : 'dark:border-white/15'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={resumeFromQuestions}
              className="min-h-[52px] w-full rounded-xl bg-brand-600 text-base font-semibold text-white"
            >
              Seguir
            </button>
            {/* Unanswered is a real answer: it leaves the service default
                alone rather than forcing a choice nobody wanted to make. */}
            <p className="text-center text-xs text-brand-900/60 dark:text-brand-200/60">
              Lo que no contestes se queda como en una limpieza normal
            </p>
          </div>
        )}

        {/* The walkthrough shoots by itself. These stay because automatic
            detection has one honest failure mode — a phone held perfectly
            still from the start never changes enough to trigger it — and
            because a browser with no speech engine leaves nothing else. */}
        {stage === 'guiding' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => advance('capture')}
            className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white"
          >
            <Camera className="h-5 w-5" /> {retakeOf !== null ? 'Repetir esta foto' : 'Tomar ya'}
          </button>
          <button
            type="button"
            onClick={() => advance('skip')}
            className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-medium"
          >
            <SkipForward className="h-4 w-4" /> {current?.optional ? 'No tengo' : 'Saltar'}
          </button>
        </div>
        )}

        {/* Going back one step, discarding what it caught. Without this the
            only remedy for a blurry frame is redoing the whole walkthrough,
            which nobody does — they keep the bad frame, and the estimate is
            built on it. */}
        {stage === 'guiding' && retakeOf === null && index > 0 && (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-500"
          >
            <ChevronLeft className="h-4 w-4" /> Atrás — repetir “{steps[index - 1]?.title}”
          </button>
        )}

        {!synthesisSupported() && (
          <p className="text-center text-xs text-slate-500">
            Este navegador no habla en voz alta — lee la instrucción de arriba.
          </p>
        )}
      </div>
    );
  }

  if (stage === 'chat') {
    const chip = (active: boolean) =>
      `min-h-[44px] rounded-xl border-2 px-3 text-sm font-medium transition-colors ${
        active
          ? 'border-brand-600 bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100'
          : 'dark:border-white/15'
      }`;
    const block = (topic: ChatTopic) =>
      `rounded-2xl border p-4 dark:border-white/10 ${topic === openChat ? 'ring-2 ring-brand-500' : ''}`;
    const today = new Date().toISOString().slice(0, 10);

    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold">Ya casi está</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tres preguntas rápidas para quien vaya a limpiar. Contesta en voz alta o tocando.
          </p>
          {voiceOn && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Mic className="h-3.5 w-3.5" /> {heard ? `Te oí: “${heard}”` : 'Te escucho'}
            </p>
          )}
        </div>

        <div className={block('when')}>
          <p className="font-medium">¿Qué día te vendría bien?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(WHEN_LABELS) as WhenPreference[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setVisitPart({ when: w }, 'touch')}
                className={chip(visit.when === w)}
              >
                {WHEN_LABELS[w]}
              </button>
            ))}
          </div>
          {visit.when === 'date' && (
            <input
              type="date"
              min={today}
              value={visit.date ?? ''}
              aria-label="Día de la limpieza"
              onChange={(e) => setVisitPart({ date: e.target.value || undefined }, 'touch')}
              className="mt-2 min-h-[44px] w-full rounded-xl border bg-white px-3 text-base dark:bg-white/5"
            />
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(TIME_LABELS) as TimeOfDay[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVisitPart({ timeOfDay: t }, 'touch')}
                className={chip(visit.timeOfDay === t)}
              >
                {TIME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className={block('products')}>
          <p className="font-medium">¿Con qué productos limpiamos?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(PRODUCT_LABELS) as ProductPreference[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setVisitPart({ products: p }, 'touch')}
                className={chip(visit.products === p)}
              >
                {PRODUCT_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <div className={block('tools')}>
          <p className="font-medium">¿Tienes aspiradora y trapeador que podamos usar?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(TOOLS_LABELS) as ToolsPreference[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVisitPart({ tools: t }, 'touch')}
                className={chip(visit.tools === t)}
              >
                {TOOLS_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStage('depth')}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white"
        >
          Seguir <ChevronRight className="h-5 w-5" />
        </button>
        {/* Unanswered is fine: the company asks on the phone, as it would have
            without any of this. */}
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Lo que no contestes lo hablas luego con la empresa.
        </p>
      </div>
    );
  }

  // review + depth share the thumbnail strip.
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">¿Está todo?</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Esto es lo que tengo. Toca cualquier foto para repetirla, o añade un espacio que falte.
        </p>
      </div>

      {/* Grouped by space and named, because "18 fotos" tells nobody whether
          the second bathroom was actually filmed. A list of what WAS captured
          is the only way somebody can notice what wasn't. */}
      {(() => {
        const bySpace = new Map<string, typeof shots>();
        for (const shot of shots) {
          const list = bySpace.get(shot.step.spaceLabel) ?? [];
          list.push(shot);
          bySpace.set(shot.step.spaceLabel, list);
        }
        const skipped = steps.filter((st) => !shots.some((sh) => sh.step.id === st.id));

        return (
          <div className="space-y-4">
            {[...bySpace.entries()].map(([label, list]) => (
              <div key={label}>
                <p className="mb-1.5 text-sm font-medium">
                  {label} <span className="text-slate-400">· {list.length}</span>
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {list.map((shot) => (
                    <button
                      key={shot.step.id + shot.frame.slice(-12)}
                      type="button"
                      onClick={() => retake(steps.findIndex((st) => st.id === shot.step.id))}
                      className="space-y-1 text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shot.frame}
                        alt={shot.step.title}
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                      <span className="block truncate text-[10px] leading-tight text-slate-500">
                        {shot.step.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {skipped.length > 0 && (
              <div className="rounded-xl border border-dashed p-3">
                <p className="text-sm font-medium">Te saltaste {skipped.length}:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {skipped.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => retake(steps.findIndex((x) => x.id === st.id))}
                      className="rounded-full border px-2.5 py-1 text-xs"
                    >
                      + {st.spaceLabel} · {st.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
            onClick={() => (serviceSlug || fixedPlan?.length ? finish(serviceSlug ?? DEPTH_OPTIONS[0].slug) : beginChat())}
            className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
          >
            Continuar <ChevronRight className="h-5 w-5" />
          </button>
          {!fixedPlan?.length && (
            <button
              type="button"
              onClick={() => {
                setShots([]);
                setIndex(0);
                setStage('plan');
              }}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium"
            >
              <RotateCcw className="h-4 w-4" /> Falta un espacio entero — empezar de nuevo
            </button>
          )}
        </div>
      )}

      {stage === 'depth' && (
        <div className="space-y-2">
          {/* Asked before the depth buttons, because those submit. A field
              underneath a button that ends the flow is a field nobody fills. */}
          <label className="block">
            <span className="font-semibold">¿Hay algo en lo que quieras que nos enfoquemos?</span>
            <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
              Opcional. Por ejemplo: “las juntas de la ducha”, “la cocina sobre todo”, “tengo un
              perro y suelta mucho pelo”.
            </span>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={2}
              maxLength={400}
              className="mt-2 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none dark:bg-white/5"
            />
          </label>

          <h4 className="pt-2 font-semibold">¿Qué tan a fondo lo quieres?</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Lo mismo de sucio da precios distintos según hasta dónde quieras llegar.
          </p>
          {voiceOn && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Mic className="h-3.5 w-3.5" />
              {heard ? `Te oí: “${heard}”` : 'Puedes decir “por encima”, “a fondo” o “mudanza”'}
            </p>
          )}
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
