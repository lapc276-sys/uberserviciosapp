/**
 * Small statistics helpers shared by every learned model in the engine.
 *
 * The important one is `shrink`. Every model here starts as a prior and gets
 * corrected by observations, and the failure mode of naive averaging is that
 * one weird Tuesday rewrites a building. Shrinkage says: the prior is worth N
 * observations, so it takes real evidence to move it.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Linear-interpolated percentile. `p` is 0–1. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Blends a prior with observed samples.
 *
 * `strength` is how many observations the prior is worth. With 0 samples you
 * get the prior; with 50 you get essentially the data. This is what lets the
 * engine ship on day one with guesses and converge on truth without a
 * migration or a retrain.
 */
export function shrink(prior: number, samples: number[], strength = 5): number {
  if (samples.length === 0) return prior;
  const sum = samples.reduce((s, x) => s + x, 0);
  return (prior * strength + sum) / (strength + samples.length);
}

/**
 * How much to trust a blended estimate, 0–1. Saturating: the 50th observation
 * adds far less than the 5th.
 */
export function confidenceFromSamples(n: number, strength = 5): number {
  if (n <= 0) return 0;
  return n / (n + strength);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Minutes → "4:07" for anything a human reads. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
