import type { Signature } from './scene';

/**
 * Whether a shot is worth keeping, judged on the phone, and what to say when
 * it is not.
 *
 * A walkthrough that photographs the inside of an unlit oven and moves on has
 * produced a black rectangle the model will score as "clean" — or, told to be
 * careful with dark frames, will score with low confidence and widen the
 * price. Either way the customer never knew anything went wrong. A person
 * holding the camera would have said "está oscuro, enciende la luz". So the
 * app says it.
 *
 * Same rule as the shutter (scene.ts): no model, no network. Every check here
 * is arithmetic on a thumbnail the walkthrough already has, so the bot can
 * answer in the same breath, in a basement with no signal.
 *
 * NONE of the thresholds below were measured on a phone in a real home. What
 * was measured is Chromium's fake test camera, so the tests can prove these
 * never fire on an ordinary frame. They are deliberately loose — a missed
 * "está oscuro" is the behaviour this replaces, a false one is a bot nagging
 * somebody in a lit kitchen — and should be tuned the way scene.ts was, with
 * a phone in hand. If you change one, measure first.
 */

/**
 * The brightest tenth of the frame below this (0–255 luma) means the camera
 * cannot see.
 *
 * The 90th percentile and not the mean, because phones expose automatically:
 * a black stovetop in a lit kitchen gets pushed up to mid-grey and keeps its
 * reflections, while a space with no light stays dark everywhere because
 * there is nothing to expose for. Chromium's fake camera sits at 79–150 and a
 * frame darkened to 12% sits under 20.
 */
export const DARK_P90 = 60;

/**
 * A pan whose consecutive samples (400ms apart) differ by more than this on
 * average is a swing, not a sweep: the frames smear and the spread pick ends
 * up with three unrelated blurs. A slow sweep should run well under it.
 */
export const PAN_TOO_FAST = 0.25;

/**
 * In a pan, a frame softer than this fraction of the pan's median sharpness
 * is dropped before choosing — relative, because absolute sharpness depends on
 * what is being filmed: a white wall is "blurry" at any focus.
 */
export const SOFT_RATIO = 0.5;

/**
 * Everything the bot says about a bad shot.
 *
 * Kept here so the voice test can check them against the shutter commands —
 * a line containing "foto" or "listo" would trigger the next shot through the
 * phone's own microphone.
 */
export const SAY = {
  dark: 'Está muy oscuro y no veo bien. ¿Puedes encender la luz?',
  darkTorch: 'Está oscuro, te enciendo la linterna.',
  steady: 'Sujeta el teléfono quieto un momento.',
  slower: 'Un poco más despacio, por favor.',
} as const;

/** The 90th-percentile luma of a signature, or null with nothing to measure. */
export function brightnessOf(signature: Signature | null): number | null {
  if (!signature || signature.length === 0) return null;
  const sorted = Array.from(signature).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.9)];
}

/** True only when the camera plainly cannot see. Unknown is not dark. */
export function isTooDark(signature: Signature | null): boolean {
  const p90 = brightnessOf(signature);
  return p90 !== null && p90 < DARK_P90;
}

/** Average of the last three sample-to-sample differences of a pan. */
export function panTooFast(deltas: number[]): boolean {
  const recent = deltas.slice(-3);
  if (recent.length < 3) return false;
  return recent.reduce((a, b) => a + b, 0) / recent.length > PAN_TOO_FAST;
}

/** A small grayscale copy of the frame, for judging focus. */
export const SHARP_WIDTH = 128;
export const SHARP_HEIGHT = 96;

export function grayOf(source: CanvasImageSource, width: number, height: number): Uint8Array | null {
  if (!width || !height || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SHARP_WIDTH;
  canvas.height = SHARP_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, SHARP_WIDTH, SHARP_HEIGHT);
  const { data } = ctx.getImageData(0, 0, SHARP_WIDTH, SHARP_HEIGHT);
  const out = new Uint8Array(SHARP_WIDTH * SHARP_HEIGHT);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return out;
}

/**
 * Mean absolute Laplacian: how much fine edge the frame has.
 *
 * Only ever compared with frames of the same pan. A smeared frame of a room
 * has less edge than a still frame of the same room; a frame of a white wall
 * has less than a frame of a bookshelf, and that says nothing about focus.
 */
export function sharpnessOf(gray: Uint8Array | null, width = SHARP_WIDTH, height = SHARP_HEIGHT): number {
  if (!gray || gray.length !== width * height) return 0;
  let sum = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      sum += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * The pan frames worth choosing between: lit before dark, sharp before soft,
 * and never fewer than the pan was supposed to keep.
 *
 * Order is preserved, because the spread pick that runs next starts from the
 * first frame and a pan's first frame is where the sweep began.
 */
export function usablePanFrames<T extends { dark: boolean; sharpness: number }>(candidates: T[], want: number): T[] {
  if (candidates.length <= want) return candidates;

  const lit = candidates.filter((c) => !c.dark);
  const pool = lit.length >= want ? lit : candidates;

  const sorted = pool.map((c) => c.sharpness).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const sharp = pool.filter((c) => c.sharpness >= median * SOFT_RATIO);
  if (sharp.length >= want) return sharp;

  // Too few pass: keep the sharpest `want`, still in sweep order.
  const cutoff = [...pool].sort((a, b) => b.sharpness - a.sharpness)[want - 1].sharpness;
  return pool.filter((c) => c.sharpness >= cutoff).slice(0, Math.max(want, 1));
}
