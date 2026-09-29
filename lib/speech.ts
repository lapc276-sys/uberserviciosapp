/**
 * Browser speech: recognition in, synthesis out.
 *
 * Both live here rather than inside a component because two features already
 * need them — hands-free score correction and the guided walkthrough — and a
 * second copy of the vendor-prefix shim is a second place to get it wrong.
 *
 * Everything degrades to nothing. A browser without speech is a browser where
 * the buttons still work, which is the whole design constraint: voice is how
 * someone with wet gloves drives the app, never the only way anyone can.
 */

/** The API is prefixed on Safari and absent in some browsers. */
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

export function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function speechSupported(): boolean {
  return getRecognition() !== null;
}

export function synthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * When the phone expects to stop talking.
 *
 * The walkthrough listens and speaks at once, and a phone's speaker feeds its
 * own microphone. Without this the app hears itself: six instructions begin
 * with "Ahora" and every confirmation says "Listo, ya puedes cerrarlo" — all
 * words that mean "take the shot". The step fired while reading its own
 * instruction, pointed at wherever the camera happened to be.
 *
 * A deadline rather than a boolean, because `onend` does not fire reliably on
 * every browser and a stuck flag would kill voice control for the rest of the
 * walkthrough. The worst case here is that the guard expires slightly early.
 */
let speakingUntil = 0;

/** Roughly how long an utterance takes, so the guard clears itself. */
function spokenDurationMs(text: string, rate: number): number {
  // ~13 characters a second at rate 1, plus a margin for the tail of the
  // sound reaching the microphone.
  return (text.length / 13 / rate) * 1000 + 600;
}

/** True while the phone is talking, so the recogniser can ignore itself. */
export function isSpeaking(): boolean {
  return Date.now() < speakingUntil;
}

/**
 * Says something out loud in Spanish.
 *
 * The guided walkthrough depends on this: the phone is held up facing a room,
 * so the person cannot read the next instruction off the screen while they
 * are pointing the camera at an oven. Hearing it is the only way the
 * instruction arrives.
 *
 * Queued speech is cancelled first. Instructions supersede each other — an
 * old one still playing when you have already moved on is worse than silence.
 */
export function speak(text: string, { rate = 0.95 }: { rate?: number } = {}): void {
  if (!synthesisSupported()) return;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-US';
    utterance.rate = rate;

    speakingUntil = Date.now() + spokenDurationMs(text, rate);
    // Clear early when the browser tells us, late by the estimate otherwise.
    utterance.onend = () => {
      speakingUntil = Date.now() + 250;
    };
    utterance.onerror = () => {
      speakingUntil = 0;
    };

    // Pick a Spanish voice when the platform has one. Without this, some
    // Android builds read Spanish text with an English voice, which is close
    // to unintelligible.
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.lang?.toLowerCase().startsWith('es'));
    if (voice) utterance.voice = voice;

    window.speechSynthesis.speak(utterance);
  } catch {
    // Synthesis is a convenience; a failure here must never stop the capture.
  }
}

export function stopSpeaking(): void {
  speakingUntil = 0;
  if (!synthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing to do — see above.
  }
}
