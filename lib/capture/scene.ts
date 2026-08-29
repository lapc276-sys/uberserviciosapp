/**
 * Noticing that the view changed, and then settled.
 *
 * The walkthrough has to catch the moment someone opens a fridge without
 * anyone pressing anything. The obvious way is to ask a vision model "is the
 * fridge open yet?" every second — which is a network round trip per check, on
 * a phone with one bar, in someone else's kitchen. A hundred of those per
 * walkthrough is slow, costs real money, and adds a hundred chances to fail
 * mid-job.
 *
 * The cheap way turns out to be enough. Opening a fridge door changes most of
 * the frame; holding the phone still afterwards changes almost none of it. So
 * we watch for a large change followed by stillness, and shoot on the
 * stillness. No model, no network, about a millisecond of work per sample.
 *
 * It does not know what a fridge is. It doesn't need to — the guide already
 * said "abre la nevera", so the next big change in front of the camera is the
 * fridge opening. Interpreting the picture is the model's job, at the end,
 * once.
 */

/**
 * Frames are compared as tiny grayscale thumbnails.
 *
 * 32×32 is small enough that the comparison is free and large enough that a
 * door swinging open is unmistakable. Going finer would mostly measure sensor
 * noise and the hand shake of someone holding a phone at arm's length.
 */
const GRID = 32;

export type Signature = Uint8Array;

/** Reduces whatever is on a canvas to a comparable 32×32 grayscale signature. */
export function signatureOf(source: CanvasImageSource, width: number, height: number): Signature | null {
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, GRID, GRID);
  const { data } = ctx.getImageData(0, 0, GRID, GRID);

  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    // Rec. 601 luma. Colour would make the comparison sensitive to white
    // balance drift, which every phone camera does constantly.
    out[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return out;
}

/** Mean absolute difference, 0 (identical) to 1 (opposite). */
export function difference(a: Signature | null, b: Signature | null): number {
  if (!a || !b || a.length !== b.length) return 1;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / (a.length * 255);
}

/**
 * Thresholds, in units of `difference`.
 *
 * Measured against handheld video rather than chosen for roundness: a phone
 * held as still as a person can hold it still drifts around 0.01–0.02, walking
 * to the next counter runs 0.10 and up, and a fridge door opening is well past
 * that. STILL sits above the shake so stillness is actually reachable, and
 * MOVED sits below a real move so intent is not missed.
 */
export const STILL = 0.035;
export const MOVED = 0.09;

export type WatchPhase = 'waiting' | 'moving' | 'settling';

/**
 * Tracks one step's worth of "they moved, then they held it steady".
 *
 * Deliberately a small state machine rather than a threshold test, because
 * "the picture is not changing" is true both before someone starts moving and
 * after they finish. Only the second one is the shot.
 */
export class SettleWatcher {
  private phase: WatchPhase = 'waiting';
  private last: Signature | null = null;
  private stillFrames = 0;

  constructor(
    /** Consecutive still samples required before calling it settled. */
    private readonly stillNeeded = 2,
  ) {}

  get state(): WatchPhase {
    return this.phase;
  }

  /** Feeds one sample. Returns true on the frame worth keeping. */
  push(signature: Signature | null): boolean {
    const delta = difference(this.last, signature);
    this.last = signature;

    // The very first sample has nothing to compare against.
    if (delta === 1 && this.phase === 'waiting') return false;

    if (this.phase === 'waiting') {
      if (delta >= MOVED) this.phase = 'moving';
      return false;
    }

    if (delta >= MOVED) {
      // Still moving — reset any stillness we had started counting.
      this.phase = 'moving';
      this.stillFrames = 0;
      return false;
    }

    if (delta <= STILL) {
      this.phase = 'settling';
      this.stillFrames += 1;
      if (this.stillFrames >= this.stillNeeded) {
        this.reset();
        return true;
      }
    }

    return false;
  }

  reset(): void {
    this.phase = 'waiting';
    this.stillFrames = 0;
    this.last = null;
  }
}

/**
 * Picks the most different frames from a pan, so a sweep across a kitchen
 * yields coverage rather than three photographs of the same cupboard.
 *
 * Greedy farthest-point selection: keep the first, then repeatedly take
 * whichever remaining frame is least similar to everything kept so far.
 */
export function spreadPick(
  candidates: { frame: string; signature: Signature | null }[],
  want: number,
): string[] {
  if (candidates.length <= want) return candidates.map((c) => c.frame);

  const kept = [candidates[0]];
  const pool = candidates.slice(1);

  while (kept.length < want && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < pool.length; i++) {
      // Distance to the nearest already-kept frame; maximise it.
      const score = Math.min(...kept.map((k) => difference(k.signature, pool[i].signature)));
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    kept.push(pool[bestIndex]);
    pool.splice(bestIndex, 1);
  }

  return kept.map((c) => c.frame);
}
