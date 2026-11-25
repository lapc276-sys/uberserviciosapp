'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, SkipForward, Mic, AlertTriangle } from 'lucide-react';
import { encodeToBudget, FRAME_BUDGET_CHARS, TOTAL_BUDGET_CHARS } from '@/lib/vision/frames';
import {
  SPACE_TEMPLATES,
  buildPlan,
  captionFor,
  droppedNote,
  joinList,
  estimateWalkSeconds,
  shortenedNote,
  wordsFor,
  planFrameCount,
  MAX_GUIDED_FRAMES,
  MAX_SPACES,
  type CaptureStep,
  type SpaceSelection,
} from '@/lib/capture/guide';
import { SettleWatcher, STILL, difference, signatureOf, spreadPick, type Signature } from '@/lib/capture/scene';
import { SAY, grayOf, isTooDark, panTooFast, sharpnessOf, usablePanFrames } from '@/lib/capture/quality';
import {
  COMMANDS,
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
import {
  estimateSpeechMs,
  getRecognition,
  isSpeaking,
  speak,
  stopSpeaking,
  synthesisSupported,
  type SpeechRecognitionLike,
} from '@/lib/speech';
import { COPY } from '@/lib/capture/copy';
import { POINTED_TITLE, POINTED_TITLE_EN, SAY_ROOM_CHECK, aRoom, theSpace } from '@/lib/capture/roomcheck';
import type { RoomType } from '@/lib/vision/types';
import {
  LANGS,
  LANG_NAMES,
  SPEECH_TAG,
  browserLanguages,
  initialLang,
  isLang,
  languageName,
  phoneLanguage,
  type Lang,
} from '@/lib/capture/lang';
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
  /** The spaces actually filmed, named in the walkthrough's language. */
  spaces: string[];
  /** The language the walkthrough was done in. */
  lang: Lang;
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
  /**
   * The page's language, when the page has one (the home page's ES/EN switch).
   * Without it the phone's own language decides, and either way the planning
   * screen lets the person change it.
   */
  locale?: string;
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

/** The depths offered at the end, in order. Their words live in COPY. */
const DEPTH_SLUGS = ['house-cleaning', 'deep-cleaning', 'move-out-cleaning'] as const;

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
// The lists themselves are COMMANDS in lib/capture/conversation.ts, one per
// language, next to everything else the walkthrough says and hears.

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
 * Consecutive dark samples (400ms apart) before the bot says anything.
 *
 * Long enough that walking through a dim hallway, or the camera's exposure
 * catching up after a turn, is not "dark"; short enough that a dark kitchen
 * is noticed in under two seconds instead of after the nine-second timeout.
 */
const DARK_SAMPLES = 4;

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
  locale,
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
  /**
   * Spaces where the bot already asked for light. Once per room: if the
   * kitchen has no working bulb, being told so before every close-up is
   * nagging, and waiting seven seconds each time is a ten-minute walkthrough.
   */
  const darkSpaces = useRef<Set<string>>(new Set());

  const [stage, setStage] = useState<Stage>('plan');
  stageRef.current = stage;

  /**
   * The walkthrough's language.
   *
   * Starts from the page's language, else Spanish; the phone's preference is
   * applied after mount, because reading `navigator` during render would make
   * the server's first frame and the browser's disagree.
   */
  const [lang, setLang] = useState<Lang>(() => initialLang(locale, []));
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  /** Once the person taps a language, nothing guesses over them. */
  const langChosen = useRef(false);
  /** The phone's first language when it is one not spoken yet ("ru"), to say so. */
  const [phonePrimary, setPhonePrimary] = useState<string | null>(null);
  const copy = COPY[lang];

  useEffect(() => {
    const phone = phoneLanguage(browserLanguages());
    setPhonePrimary(phone.primary && !isLang(phone.primary) ? phone.primary : null);
    if (langChosen.current) return;
    if (isLang(locale)) setLang(locale);
    else if (phone.lang) setLang(phone.lang);
  }, [locale]);

  /** Says a line in the walkthrough's language. Reads the ref, so timers set long ago say it right. */
  const talk = useCallback((text: string) => speak(text, { lang: SPEECH_TAG[langRef.current] }), []);

  /**
   * What the bot says about each room as it is left, from the scout — see
   * lib/vision/remarks.ts. Said once per room: before that room's questions
   * when it has some, else at the start of the next instruction.
   */
  const remarksRef = useRef<Record<string, string>>({});
  const toldRemarks = useRef<Set<string>>(new Set());
  /** A remark waiting to open the next step's instruction. */
  const prefaceRef = useRef<string | null>(null);
  /** The remark on screen while it is being said. */
  const [remarkShown, setRemarkShown] = useState<string | null>(null);
  /** The room's remark if it has not been said yet — and marks it said. */
  const takeRemark = useCallback((spaceKey: string | undefined): string | undefined => {
    if (!spaceKey || toldRemarks.current.has(spaceKey)) return undefined;
    const remark = remarksRef.current[spaceKey];
    if (remark) toldRemarks.current.add(spaceKey);
    return remark;
  }, []);
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
  /**
   * Spaces whose pan was not the room asked for — a car, an office where the
   * kitchen should be. Filled by the scout; see lib/capture/roomcheck.ts.
   * The value is what was seen instead.
   */
  const [mismatch, setMismatch] = useState<Record<string, RoomType | 'none'>>({});
  const mismatchSaid = useRef<Set<string>>(new Set());
  /** "¿Me salté algo?": which space to point in, while choosing. */
  const [choosingMissed, setChoosingMissed] = useState(false);
  /** What each pointed frame turned out to be, by step id. */
  const [pointed, setPointed] = useState<
    Record<string, { status: 'looking' | 'found' | 'unknown' | 'saved'; labels: string[] }>
  >({});
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
          body: JSON.stringify({ frames, roomType, serviceSlug, lang: langRef.current }),
        });
        const { data } = await readJson<{
          questions?: RoomQuestion[];
          remark?: string | null;
          mismatch?: { saw: RoomType | 'none' };
        }>(res);
        // Not the room asked for: no questions and no remark about it — only
        // the fact, said as the room is left (or shown at the review if the
        // answer comes back later than that).
        if (data?.mismatch?.saw) {
          const saw = data.mismatch.saw;
          setMismatch((prev) => ({ ...prev, [spaceKey]: saw }));
          return;
        }
        // A re-filmed space that is now the right room clears the notice.
        setMismatch((prev) => {
          if (!(spaceKey in prev)) return prev;
          const next = { ...prev };
          delete next[spaceKey];
          return next;
        });
        if (data?.remark) remarksRef.current[spaceKey] = data.remark;
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

  /**
   * What the customer pointed at, named back to them: "Veo la lavadora".
   * Not awaited, never fatal — the frame goes to the analysis either way,
   * captioned as something the walkthrough missed.
   */
  const identifyPointed = useCallback(
    async (step: CaptureStep, frames: string[]) => {
      setPointed((prev) => ({ ...prev, [step.id]: { status: 'looking', labels: [] } }));
      try {
        const res = await fetch('/api/vision/scout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames, roomType: step.roomType, serviceSlug, lang: langRef.current, pointed: true }),
        });
        const { data } = await readJson<{ found?: { name: string; label: string }[]; scouted?: boolean }>(res);
        const labels = (data?.found ?? []).map((f) => f.label);
        if (labels.length) {
          setPointed((prev) => ({ ...prev, [step.id]: { status: 'found', labels } }));
          talk(SAY_ROOM_CHECK[langRef.current].found(joinList(labels, langRef.current)));
        } else if (data?.scouted) {
          setPointed((prev) => ({ ...prev, [step.id]: { status: 'unknown', labels: [] } }));
          talk(SAY_ROOM_CHECK[langRef.current].unknown);
        } else {
          // Nobody looked (no model configured): kept for the analysis.
          setPointed((prev) => ({ ...prev, [step.id]: { status: 'saved', labels: [] } }));
        }
      } catch {
        setPointed((prev) => ({ ...prev, [step.id]: { status: 'saved', labels: [] } }));
      }
    },
    [serviceSlug, talk],
  );

  const advanceRef = useRef<(action: 'capture' | 'skip', collected?: string[]) => void>(() => {});

  const advance = useCallback(
    (action: 'capture' | 'skip', collected?: string[]) => {
      const step = steps[index];
      if (!step) return;

      if (action === 'capture') {
        const frames = collected?.length ? collected : [grabFrame()].filter((f): f is string => !!f);
        if (frames.length === 0) {
          setError(COPY[langRef.current].cameraNotReady);
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
        const after = wordsFor(step, langRef.current).after;
        if (after) talk(after);

        // The pan is the only step that sees the whole room, so it is the one
        // worth asking the model about. Fired and not awaited.
        if (step.mode === 'pan') void scoutSpace(step.spaceKey, step.roomType, step.spaceLabel, frames);
        if (step.pointed) void identifyPointed(step, frames);
      }

      // Pointing at nothing after all: the step was never part of the plan.
      if (action === 'skip' && step.pointed) setSteps((prev) => prev.filter((s) => s.id !== step.id));

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
      // And a room that was not the room asked for stops here too, to say so
      // while the person is still standing where they filmed it.
      if (leavingSpace && (mismatch[step.spaceKey] || pending?.some((q) => answers[q.id] === undefined))) {
        setGateNext(next);
        setHeard('');
        setStage('questions');
        return;
      }

      // Leaving a room with nothing to ask: its remark, if any, opens the
      // next instruction instead ("La cocina se ve muy bien… Ahora el baño").
      const remark = leavingSpace ? takeRemark(step.spaceKey) : undefined;

      if (next >= steps.length) {
        stopStream();
        stopVoice();
        talk([remark, SAY_CHAT[langRef.current].done].filter(Boolean).join(' '));
        setStage('review');
      } else {
        prefaceRef.current = remark ?? null;
        setIndex(next);
      }
    },
    [index, steps, grabFrame, stopStream, stopVoice, retakeOf, scouted, scoutSpace, identifyPointed, mismatch, answers, takeRemark, talk],
  );

  /** Closes the question card and puts the walkthrough back where it was. */
  const resumeFromQuestions = useCallback(() => {
    const next = gateNext ?? index + 1;
    setGateNext(null);
    lastAnswerVia.current = null;
    if (next >= steps.length) {
      stopStream();
      stopVoice();
      talk(SAY_CHAT[langRef.current].done);
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
    // An answer first, "move on" only if it was not one: "sí, listo" is a yes.
    const yes = openQuestion ? parseYesNo(heard) : null;
    // Not clearly a yes or a no: leave the question open rather than guess.
    if (openQuestion && yes !== null) answerQuestion(openQuestion.id, yes, 'voice');
    else if (wantsToContinue(heard)) resumeFromQuestions();
  };

  /**
   * Asks the open question aloud, and the next one once it is answered.
   *
   * When the last one was answered by voice the walk simply carries on — the
   * person never had to look at the screen, and making them tap "Seguir"
   * would undo that. Answered by touch, they are looking at the card already
   * and may want to change an answer, so the button is theirs to press.
   */
  const gateSpace = stage === 'questions' ? steps[index] : undefined;
  const gateMismatch = gateSpace ? mismatch[gateSpace.spaceKey] : undefined;

  useEffect(() => {
    if (stage !== 'questions') return;
    if (gateSpace && gateMismatch && !mismatchSaid.current.has(gateSpace.spaceKey)) {
      mismatchSaid.current.add(gateSpace.spaceKey);
      talk(
        SAY_ROOM_CHECK[langRef.current].mismatch(
          gateMismatch,
          theSpace(gateSpace.roomType, wordsFor(gateSpace, langRef.current).spaceLabel, langRef.current),
        ),
      );
      return;
    }
    if (openQuestion) {
      // The room's remark opens its first question: "La cocina se ve muy
      // bien… ¿Quieres que limpiemos el horno por dentro?"
      const remark = takeRemark(steps[index]?.spaceKey);
      const question = spokenQuestion(openQuestion, langRef.current);
      talk(remark ? `${remark} ${question}` : question);
      return;
    }
    if (lastAnswerVia.current === 'voice') {
      talk(SAY_CHAT[langRef.current].moveOn);
      const t = setTimeout(() => resumeRef.current(), 1200);
      return () => clearTimeout(t);
    }
    // Keyed on the question, not the object: re-running for the same open
    // question would read it out again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, openQuestion?.id, gateMismatch]);

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
    // Only the open question is listened for: "por la tarde" while the bot is
    // asking about products is not an answer to anything. And an answer is
    // tried before "move on", so "la semana siguiente" books a week instead
    // of skipping the question.
    let answered = false;
    if (openChat === 'when') {
      const parsed = parseWhen(heard);
      if (parsed.when || parsed.timeOfDay) {
        setVisitPart(parsed, 'voice');
        answered = true;
      }
    } else if (openChat === 'products') {
      const products = parseProducts(heard);
      if (products) {
        setVisitPart({ products }, 'voice');
        answered = true;
      }
    } else if (openChat === 'tools') {
      const tools = parseTools(heard);
      if (tools) {
        setVisitPart({ tools }, 'voice');
        answered = true;
      }
    }
    if (!answered && wantsToContinue(heard)) setStage('depth');
  };

  /** Asks the open closing question aloud; carries on by itself after a spoken last answer. */
  useEffect(() => {
    if (stage !== 'chat') return;
    if (openChat) {
      talk(SAY_CHAT[langRef.current][openChat]);
      return;
    }
    if (chatVia.current === 'voice') {
      talk(SAY_CHAT[langRef.current].closing);
      const t = setTimeout(() => setStage('depth'), 900);
      return () => clearTimeout(t);
    }
  }, [stage, openChat, talk]);

  useEffect(() => {
    if (stage === 'depth') talk(SAY_CHAT[langRef.current].depth);
  }, [stage, talk]);

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

    // A remark about the room just left opens this instruction, and the step
    // waits for it: a sweep must not start while the bot is still talking
    // about the kitchen.
    const preface = prefaceRef.current;
    prefaceRef.current = null;
    const words = wordsFor(current, langRef.current);
    talk(preface ? `${preface} ${words.spoken}` : words.spoken);
    const prefaceMs = preface ? estimateSpeechMs(preface) : 0;
    stepStartedAt.current = Date.now() + prefaceMs;
    setRemarkShown(preface);
    setWatching('waiting');
    setNotice(null);

    const watcher = new SettleWatcher();
    const panBuffer: PanSample[] = [];
    const panDeltas: number[] = [];
    let startedAt = Date.now() + prefaceMs;
    let previous: Signature | null = null;
    let done = false;
    let warnedDark = false;
    let warnedShake = false;
    let warnedFast = false;
    /** Consecutive dark samples, so a dim second in a hallway is not "dark". */
    let darkRun = 0;
    /** Set while the step waits for the light it asked for. */
    let lightBy = 0;
    let panExtraMs = 0;
    let torchOn = false;

    const finishStep = (frames?: string[]) => {
      if (done) return;
      done = true;
      advanceRef.current('capture', frames);
    };

    const lightTorch = () => {
      if (torchOn || !torchAvailable()) return false;
      torchOn = true;
      void setTorch(true);
      return true;
    };

    /**
     * True when the bot asked for light and the step should wait for it.
     * Asked once per room; after that the flashlight goes on silently where
     * there is one, and the step simply carries on where there is not.
     */
    const askForLight = (): boolean => {
      warnedDark = true;
      if (darkSpaces.current.has(current.spaceKey)) {
        lightTorch();
        return false;
      }
      darkSpaces.current.add(current.spaceKey);
      if (lightTorch()) {
        talk(SAY[langRef.current].darkTorch);
        setNotice(COPY[langRef.current].darkTorchNotice);
      } else {
        talk(SAY[langRef.current].dark);
        setNotice(COPY[langRef.current].darkNotice);
      }
      return true;
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
      darkRun = dark ? darkRun + 1 : 0;
      const staysDark = darkRun >= DARK_SAMPLES;

      if (current.mode === 'pan') {
        // Light first: a sweep through a dark room is several photographs of
        // nothing, and the room's questions are built from them.
        if (staysDark && !warnedDark && askForLight()) {
          panBuffer.length = 0;
          panDeltas.length = 0;
          previous = null;
          darkRun = 0;
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
          talk(SAY[langRef.current].slower);
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

      // Dark for a couple of seconds: say so now, rather than after the
      // nine-second timeout has already photographed the dark.
      if (staysDark && !warnedDark && askForLight()) {
        lightBy = now + DARK_GRACE_MS;
        return;
      }

      // Settled, or nothing decisive for long enough: someone holding the
      // phone steady from the start never produces the change the watcher
      // waits for.
      if (settled || elapsed >= LEAD_IN_MS + SETTLE_TIMEOUT_MS) {
        // A cupboard opened fast and held still settles before the dark has
        // lasted long enough to be called dark. Checked again at the shutter,
        // so the quick case gets the same question as the slow one.
        if (dark && !warnedDark && askForLight()) {
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
        talk(SAY[langRef.current].steady);
      }
    }, WATCH_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      done = true;
      if (torchOn) void setTorch(false);
    };
  }, [stage, current, grabFrame, grabSignature, grabGray, torchAvailable, setTorch, talk]);

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

    recognition.lang = SPEECH_TAG[langRef.current];
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

      const commands = COMMANDS[langRef.current];
      if (commands.skip.some((w) => text.includes(w))) advanceRef.current('skip');
      else if (commands.capture.some((w) => text.split(' ').includes(w))) advanceRef.current('capture');
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
      setError(copy.pickOne);
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
      // A new walkthrough may be in a different home, or the same one with the
      // lights now on.
      darkSpaces.current = new Set();
      remarksRef.current = {};
      toldRemarks.current = new Set();
      prefaceRef.current = null;
      setStage('guiding');
      startVoice();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setStage(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
      setError(
        name === 'NotAllowedError' ? copy.denied : copy.unsupported,
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
      spaces: [...new Set(shots.map((s) => wordsFor(s.step, lang).spaceLabel))],
      lang,
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
      setError(copy.reopenFailed);
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

  /** Forgets everything the scout said about a space. */
  function forgetSpace(key: string) {
    setMismatch((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setScouted((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    delete remarksRef.current[key];
    toldRemarks.current.delete(key);
    mismatchSaid.current.delete(key);
  }

  /**
   * Films a space again from its first step — the answer to "esto parece un
   * coche" when the person simply was not in the kitchen yet.
   */
  function redoSpace(key: string) {
    const first = steps.findIndex((s) => s.spaceKey === key);
    if (first < 0) return;
    setShots((prev) => prev.filter((s) => s.step.spaceKey !== key));
    forgetSpace(key);
    setGateNext(null);
    setError('');
    setStage('guiding');
    setIndex(first);
  }

  /**
   * Takes a space out of the walkthrough entirely — the answer to "esto parece
   * una oficina" in an office with no kitchen. Its frames are discarded, so
   * the price can never include it, and its steps go too, so the review does
   * not list them as skipped.
   */
  function dropSpace(key: string) {
    const resumeAt = gateNext ?? index + 1;
    const removedBefore = steps.slice(0, resumeAt).filter((s) => s.spaceKey === key).length;
    const remaining = steps.filter((s) => s.spaceKey !== key);
    setShots((prev) => prev.filter((s) => s.step.spaceKey !== key));
    forgetSpace(key);
    setSteps(remaining);
    if (stage !== 'questions') return;
    const next = resumeAt - removedBefore;
    setGateNext(null);
    if (next >= remaining.length) {
      stopStream();
      stopVoice();
      talk(SAY_CHAT[langRef.current].done);
      setIndex(Math.max(0, remaining.length - 1));
      setStage('review');
    } else {
      setStage('guiding');
      setIndex(next);
    }
  }

  /**
   * "¿Me salté algo? Enséñamelo." One extra step, in the space it belongs to,
   * captioned so the analysis knows the customer pointed at it. Runs through
   * the retake path, so it comes back to the review when taken.
   */
  function pointAtMissed(space: { spaceKey: string; roomType: RoomType; spaceLabel: string; spaceLabelEn: string } | null) {
    setChoosingMissed(false);
    const n = steps.filter((s) => s.pointed).length + 1;
    const where = space ?? {
      spaceKey: `extra-${n}`,
      roomType: 'other' as RoomType,
      spaceLabel: COPY.es.otherSpot,
      spaceLabelEn: COPY.en.otherSpot,
    };
    const step: CaptureStep = {
      id: `${where.spaceKey}-pointed-${n}`,
      spaceKey: where.spaceKey,
      roomType: where.roomType,
      spaceLabel: where.spaceLabel,
      title: POINTED_TITLE,
      spoken: SAY_ROOM_CHECK.es.point,
      after: SAY_ROOM_CHECK.es.pointAfter,
      en: {
        title: POINTED_TITLE_EN,
        spoken: SAY_ROOM_CHECK.en.point,
        after: SAY_ROOM_CHECK.en.pointAfter,
        spaceLabel: where.spaceLabelEn,
      },
      mode: 'settle',
      frames: 1,
      optional: true,
      pointed: true,
    };
    // Right after its space's last step, so a space's frames stay together.
    const last = steps.map((s) => s.spaceKey).lastIndexOf(where.spaceKey);
    const at = last >= 0 ? last + 1 : steps.length;
    setSteps([...steps.slice(0, at), step, ...steps.slice(at)]);
    void retake(at);
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
            <RotateCcw className="h-4 w-4" /> {copy.retryCamera}
          </button>
        )}
        {fallback}
      </div>
    );
  }

  if ((stage === 'plan' || stage === 'starting') && fixedPlan?.length) {
    // Replaying a known plan: nothing to choose, so nothing is asked.
    const spaces = Array.from(new Set(fixedPlan.map((s) => wordsFor(s, lang).spaceLabel)));
    return (
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold">{title ?? copy.replayTitle}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.replayIntro(fixedPlan.length)}</p>
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
          {stage === 'starting' ? copy.opening : copy.startShort}
        </button>

        <video ref={videoRef} playsInline muted className="hidden" />
      </div>
    );
  }

  if (stage === 'plan' || stage === 'starting') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">{copy.langQuestion}</p>
          <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={copy.langQuestion}>
            {LANGS.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={lang === code}
                onClick={() => {
                  langChosen.current = true;
                  setLang(code);
                }}
                className={`min-h-[44px] rounded-xl border-2 text-sm font-medium transition-colors ${
                  lang === code
                    ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'dark:border-white/15'
                }`}
              >
                {LANG_NAMES[code]}
              </button>
            ))}
          </div>
          {/* Honest about the limit instead of silently answering a Russian
              speaker in English: the phone said Russian, and we heard it. */}
          {phonePrimary && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {copy.phoneLanguageNote(languageName(phonePrimary, lang))}
            </p>
          )}
        </div>

        <div>
          <h3 className="font-semibold">{copy.planTitle}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.planIntro}</p>
        </div>

        <ul className="divide-y rounded-2xl border">
          {SPACE_TEMPLATES.map((tpl) => {
            const count = selection[tpl.key] ?? 0;
            return (
              <li key={tpl.key} className="flex items-center gap-3 p-3">
                <span className="text-xl" aria-hidden>
                  {tpl.emoji}
                </span>
                <span className="flex-1 text-sm font-medium">{lang === 'en' ? tpl.labelEn : tpl.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={copy.remove(lang === 'en' ? tpl.labelEn : tpl.label)}
                    onClick={() => setCount(tpl.key, -1)}
                    disabled={count === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{count}</span>
                  <button
                    type="button"
                    aria-label={copy.add(lang === 'en' ? tpl.labelEn : tpl.label)}
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
        {droppedNote(plan, lang) && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {droppedNote(plan, lang)}
          </p>
        )}

        {shortenedNote(plan, lang) && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{shortenedNote(plan, lang)}</p>
        )}

        {totalSpaces > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {copy.planSummary(
              plan.steps.length,
              planFrameCount(plan.steps),
              Math.ceil(estimateWalkSeconds(plan.steps) / 60),
            )}
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
          {stage === 'starting' ? copy.opening : copy.start}
        </button>

        <video ref={videoRef} playsInline muted className="hidden" />
      </div>
    );
  }

  if (stage === 'guiding' || stage === 'questions') {
    const words = current ? wordsFor(current, lang) : null;
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 aspect-[3/4]">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">
              {copy.stepCounter(words?.spaceLabel ?? '', index + 1, steps.length)}
            </p>
            {/* The remark about the room just left, while it is being said. */}
            {remarkShown && stage === 'guiding' && (
              <p className="mt-1 text-sm leading-snug text-white/80">“{remarkShown}”</p>
            )}
            <p className="mt-1 text-xl font-semibold leading-snug text-white">{words?.spoken}</p>
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
                ? copy.sweeping
                : watching === 'settling'
                  ? copy.settling
                  : watching === 'moving'
                    ? copy.moving
                    : copy.waiting}
            </span>
            {voiceOn && (
              <span className="inline-flex items-center gap-1 text-xs text-white/60">
                <Mic className="h-3.5 w-3.5" />
                {heard ? `“${heard}”` : copy.sayReady}
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
        {/* The room asked for is not the room in the frames: say what it
            looks like instead, and let them re-film it or drop it. Dropped,
            it is never priced — the answer to an office with no kitchen in
            the middle of a pitch. */}
        {stage === 'questions' && gateNext !== null && gateSpace && gateMismatch && (
          <div className="space-y-3 rounded-2xl border-2 border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/30" data-testid="room-mismatch">
            <p className="flex items-start gap-2 text-base font-semibold text-amber-950 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              {copy.mismatchTitle(gateMismatch === 'none' ? null : aRoom(gateMismatch, lang))}
            </p>
            <p className="text-sm text-amber-900 dark:text-amber-200">
              {copy.mismatchBody(theSpace(gateSpace.roomType, wordsFor(gateSpace, lang).spaceLabel, lang))}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => redoSpace(gateSpace.spaceKey)}
                className="min-h-[52px] rounded-xl bg-amber-600 px-2 text-sm font-semibold text-white"
              >
                {copy.redoSpace(wordsFor(gateSpace, lang).spaceLabel)}
              </button>
              <button
                type="button"
                onClick={() => dropSpace(gateSpace.spaceKey)}
                className="min-h-[52px] rounded-xl border-2 border-amber-600 px-2 text-sm font-semibold text-amber-900 dark:text-amber-100"
              >
                {copy.dropSpace(wordsFor(gateSpace, lang).spaceLabel)}
              </button>
            </div>
            <button
              type="button"
              onClick={resumeFromQuestions}
              className="min-h-[40px] w-full text-sm text-amber-900/70 underline dark:text-amber-200/70"
            >
              {copy.keepAnyway}
            </button>
          </div>
        )}

        {stage === 'questions' && gateNext !== null && !gateMismatch && (
          <div className="space-y-3 rounded-2xl border-2 border-brand-500 bg-brand-50 p-4 dark:bg-brand-950/30">
            <p className="text-sm font-medium text-brand-900 dark:text-brand-200">
              {roomQuestions.length === 1 ? copy.oneQuestion : copy.someQuestions}
            </p>
            {/* What the bot just said about the room, kept on screen. */}
            {remarksRef.current[steps[index]?.spaceKey] && (
              <p className="rounded-xl bg-white/70 p-3 text-sm italic text-brand-950 dark:bg-white/5 dark:text-brand-100">
                “{remarksRef.current[steps[index]?.spaceKey]}”
              </p>
            )}
            {voiceOn && (
              <p className="flex items-center gap-1.5 text-xs text-brand-900/70 dark:text-brand-200/70">
                <Mic className="h-3.5 w-3.5" />
                {heard ? copy.heard(heard) : copy.answerAloud}
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
                      {copy.addsMinutes(q.extraMinutes)}
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { label: copy.yes, value: true },
                      { label: copy.no, value: false },
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
              {copy.carryOn}
            </button>
            {/* Unanswered is a real answer: it leaves the service default
                alone rather than forcing a choice nobody wanted to make. */}
            <p className="text-center text-xs text-brand-900/60 dark:text-brand-200/60">
              {copy.unansweredStandard}
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
            <Camera className="h-5 w-5" /> {retakeOf !== null ? copy.retakeThis : copy.takeNow}
          </button>
          <button
            type="button"
            onClick={() => advance('skip')}
            className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-medium"
          >
            <SkipForward className="h-4 w-4" /> {current?.optional ? copy.dontHave : copy.skip}
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
            <ChevronLeft className="h-4 w-4" /> {copy.back(steps[index - 1] ? wordsFor(steps[index - 1], lang).title : '')}
          </button>
        )}

        {!synthesisSupported() && (
          <p className="text-center text-xs text-slate-500">
            {copy.noSpeech}
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
          <h3 className="font-semibold">{copy.chatTitle}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {copy.chatIntro}
          </p>
          {voiceOn && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Mic className="h-3.5 w-3.5" /> {heard ? copy.heard(heard) : copy.listening}
            </p>
          )}
        </div>

        <div className={block('when')}>
          <p className="font-medium">{copy.whenQuestion}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(WHEN_LABELS[lang]) as WhenPreference[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setVisitPart({ when: w }, 'touch')}
                className={chip(visit.when === w)}
              >
                {WHEN_LABELS[lang][w]}
              </button>
            ))}
          </div>
          {visit.when === 'date' && (
            <input
              type="date"
              min={today}
              value={visit.date ?? ''}
              aria-label={copy.dayLabel}
              onChange={(e) => setVisitPart({ date: e.target.value || undefined }, 'touch')}
              className="mt-2 min-h-[44px] w-full rounded-xl border bg-white px-3 text-base dark:bg-white/5"
            />
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(TIME_LABELS[lang]) as TimeOfDay[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVisitPart({ timeOfDay: t }, 'touch')}
                className={chip(visit.timeOfDay === t)}
              >
                {TIME_LABELS[lang][t]}
              </button>
            ))}
          </div>
        </div>

        <div className={block('products')}>
          <p className="font-medium">{copy.productsQuestion}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(PRODUCT_LABELS[lang]) as ProductPreference[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setVisitPart({ products: p }, 'touch')}
                className={chip(visit.products === p)}
              >
                {PRODUCT_LABELS[lang][p]}
              </button>
            ))}
          </div>
        </div>

        <div className={block('tools')}>
          <p className="font-medium">{copy.toolsQuestion}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(TOOLS_LABELS[lang]) as ToolsPreference[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVisitPart({ tools: t }, 'touch')}
                className={chip(visit.tools === t)}
              >
                {TOOLS_LABELS[lang][t]}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStage('depth')}
          className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white"
        >
          {copy.carryOn} <ChevronRight className="h-5 w-5" />
        </button>
        {/* Unanswered is fine: the company asks on the phone, as it would have
            without any of this. */}
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {copy.unansweredLater}
        </p>
      </div>
    );
  }

  // review + depth share the thumbnail strip.
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{copy.reviewTitle}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.reviewIntro}</p>
      </div>

      {/* Grouped by space and named, because "18 fotos" tells nobody whether
          the second bathroom was actually filmed. A list of what WAS captured
          is the only way somebody can notice what wasn't. */}
      {(() => {
        const bySpace = new Map<string, typeof shots>();
        for (const shot of shots) {
          const name = wordsFor(shot.step, lang).spaceLabel;
          const list = bySpace.get(name) ?? [];
          list.push(shot);
          bySpace.set(name, list);
        }
        const skipped = steps.filter((st) => !st.pointed && !shots.some((sh) => sh.step.id === st.id));

        return (
          <div className="space-y-4">
            {[...bySpace.entries()].map(([label, list]) => {
              const key = list[0].step.spaceKey;
              const saw = mismatch[key];
              const pan = steps.findIndex((st) => st.spaceKey === key && st.mode === 'pan');
              const pointedHere = list.filter((sh) => sh.step.pointed);
              return (
              <div key={label}>
                <p className="mb-1.5 text-sm font-medium">
                  {label} <span className="text-slate-400">· {list.length}</span>
                </p>
                {/* The scout answered after the room was left: the same notice,
                    here, where it can still be acted on. */}
                {saw && stage === 'review' && (
                  <div className="mb-2 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30" data-testid="late-mismatch">
                    <p className="font-medium text-amber-950 dark:text-amber-100">
                      {copy.lateMismatch(saw === 'none' ? null : aRoom(saw, lang))}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pan >= 0 && (
                        <button type="button" onClick={() => retake(pan)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">
                          {copy.redoPan}
                        </button>
                      )}
                      <button type="button" onClick={() => dropSpace(key)} className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold">
                        {copy.dropSpace(label)}
                      </button>
                    </div>
                  </div>
                )}
                {pointedHere.map((sh) => {
                  const result = pointed[sh.step.id];
                  if (!result) return null;
                  return (
                    <p key={sh.step.id} className="mb-1.5 text-xs text-slate-600 dark:text-slate-300" data-testid="pointed-result">
                      {result.status === 'looking'
                        ? copy.pointLooking
                        : result.status === 'found'
                          ? copy.pointFound(joinList(result.labels, lang))
                          : result.status === 'unknown'
                            ? copy.pointUnknown
                            : copy.pointSaved}
                    </p>
                  );
                })}
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
                        alt={wordsFor(shot.step, lang).title}
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                      <span className="block truncate text-[10px] leading-tight text-slate-500">
                        {wordsFor(shot.step, lang).title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              );
            })}

            {/* "¿Me salté algo?" — the customer knows the house; the script
                does not. Pointing beats describing: the model then sees it. */}
            {stage === 'review' && shots.length > 0 && (
              <div className="rounded-xl border border-dashed p-3">
                {!choosingMissed ? (
                  <button
                    type="button"
                    onClick={() => setChoosingMissed(true)}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300"
                  >
                    <Camera className="h-4 w-4" /> {copy.missedButton}
                  </button>
                ) : (
                  <>
                    <p className="text-sm font-medium">{copy.missedWhere}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[...new Map(shots.map((sh) => [sh.step.spaceKey, sh.step])).values()].map((st) => (
                        <button
                          key={st.spaceKey}
                          type="button"
                          onClick={() =>
                            pointAtMissed({
                              spaceKey: st.spaceKey,
                              roomType: st.roomType,
                              spaceLabel: st.spaceLabel,
                              spaceLabelEn: st.en?.spaceLabel ?? st.spaceLabel,
                            })
                          }
                          className="min-h-[40px] rounded-full border px-3 text-sm"
                        >
                          {wordsFor(st, lang).spaceLabel}
                        </button>
                      ))}
                      <button type="button" onClick={() => pointAtMissed(null)} className="min-h-[40px] rounded-full border px-3 text-sm">
                        {copy.otherSpot}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {skipped.length > 0 && (
              <div className="rounded-xl border border-dashed p-3">
                <p className="text-sm font-medium">{copy.skipped(skipped.length)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {skipped.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => retake(steps.findIndex((x) => x.id === st.id))}
                      className="rounded-full border px-2.5 py-1 text-xs"
                    >
                      + {wordsFor(st, lang).spaceLabel} · {wordsFor(st, lang).title}
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
          {copy.noPhotos}
        </p>
      )}

      {stage === 'review' && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={shots.length === 0}
            onClick={() => (serviceSlug || fixedPlan?.length ? finish(serviceSlug ?? DEPTH_SLUGS[0]) : beginChat())}
            className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
          >
            {copy.continue} <ChevronRight className="h-5 w-5" />
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
              <RotateCcw className="h-4 w-4" /> {copy.startOver}
            </button>
          )}
        </div>
      )}

      {stage === 'depth' && (
        <div className="space-y-2">
          {/* Asked before the depth buttons, because those submit. A field
              underneath a button that ends the flow is a field nobody fills. */}
          <label className="block">
            <span className="font-semibold">{copy.focusQuestion}</span>
            <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{copy.focusHint}</span>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={2}
              maxLength={400}
              className="mt-2 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none dark:bg-white/5"
            />
          </label>

          <h4 className="pt-2 font-semibold">{copy.depthQuestion}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400">{copy.depthIntro}</p>
          {voiceOn && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Mic className="h-3.5 w-3.5" />
              {heard ? copy.heard(heard) : copy.depthVoiceHint}
            </p>
          )}
          {DEPTH_SLUGS.map((slug) => ({ slug, ...copy.depth[slug] })).map((opt) => (
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
