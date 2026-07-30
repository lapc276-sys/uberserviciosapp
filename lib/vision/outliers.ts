/**
 * Guarding the calibration set.
 *
 * Calibration is only as good as the `actualMinutes` it learns from, and those
 * numbers come from a person with wet gloves at the end of a long job. They
 * will sometimes be a fat-fingered 480 for a bathroom, a job interrupted for an
 * hour by a talkative customer, or a shift where two people worked but only one
 * was counted.
 *
 * A handful of those poisons a bias figure, and the damage is invisible: the
 * suggestion arrives with the same confident wording it would have had on clean
 * data. So samples are classified before they count, and the rejected ones are
 * shown rather than quietly dropped — a growing pile of them is itself a
 * finding, usually that the capture flow is confusing somebody.
 */

export type SampleVerdict = 'ok' | 'implausible' | 'ran_long' | 'ran_short';

export interface ScoredSample {
  predictedMinutes: number;
  actualMinutes: number;
  /** Optional context, carried through so the admin can show what was rejected. */
  ref?: string;
  city?: string | null;
}

export interface ClassifiedSample extends ScoredSample {
  verdict: SampleVerdict;
  /** actual / predicted. 1 is a perfect call. */
  ratio: number;
  reason?: string;
}

/**
 * No cleaning visit is under five minutes or over twelve hours of one person's
 * work. Outside that, the number is a data-entry error, not a long day.
 */
const MIN_PLAUSIBLE_MINUTES = 5;
const MAX_PLAUSIBLE_MINUTES = 720;

/**
 * How far from the estimate a job may land and still teach us something.
 *
 * Wide on purpose. The model is uncalibrated, so being 2× off is exactly the
 * error we are trying to measure and must not discard. Past 3×, the likelier
 * explanation is that something happened to the job — a second crew member, an
 * interruption, a miscount — and including it would move the factor more than
 * a hundred honest samples.
 */
const MAX_RATIO = 3;
const MIN_RATIO = 1 / 3;

export function classifySample(sample: ScoredSample): ClassifiedSample {
  const { predictedMinutes, actualMinutes } = sample;
  const ratio = predictedMinutes > 0 ? actualMinutes / predictedMinutes : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(actualMinutes) || actualMinutes < MIN_PLAUSIBLE_MINUTES) {
    return { ...sample, ratio, verdict: 'implausible', reason: `Under ${MIN_PLAUSIBLE_MINUTES} minutes` };
  }
  if (actualMinutes > MAX_PLAUSIBLE_MINUTES) {
    return {
      ...sample,
      ratio,
      verdict: 'implausible',
      reason: `Over ${MAX_PLAUSIBLE_MINUTES / 60} hours for one person`,
    };
  }
  if (!Number.isFinite(ratio) || predictedMinutes <= 0) {
    return { ...sample, ratio, verdict: 'implausible', reason: 'No prediction to compare against' };
  }
  if (ratio > MAX_RATIO) {
    return { ...sample, ratio, verdict: 'ran_long', reason: `Took ${ratio.toFixed(1)}× the estimate` };
  }
  if (ratio < MIN_RATIO) {
    return { ...sample, ratio, verdict: 'ran_short', reason: `Took ${ratio.toFixed(2)}× the estimate` };
  }

  return { ...sample, ratio, verdict: 'ok' };
}

export interface CalibrationSet {
  used: ClassifiedSample[];
  excluded: ClassifiedSample[];
  predictedTotal: number;
  actualTotal: number;
  /**
   * Size-weighted factor over the clean set.
   *
   * Weighted rather than a median of ratios because a six-hour job that ran an
   * hour over is a bigger fact about the model than a twenty-minute job that
   * ran ten minutes over — and the outlier filter above is what makes weighting
   * safe, since one bad row can no longer dominate the sum.
   */
  factor: number;
  /** Share of samples thrown out, 0–100. A high number is its own warning. */
  exclusionRate: number;
}

export function buildCalibrationSet(samples: ScoredSample[]): CalibrationSet {
  const classified = samples.map(classifySample);
  const used = classified.filter((s) => s.verdict === 'ok');
  const excluded = classified.filter((s) => s.verdict !== 'ok');

  const predictedTotal = used.reduce((sum, s) => sum + s.predictedMinutes, 0);
  const actualTotal = used.reduce((sum, s) => sum + s.actualMinutes, 0);

  return {
    used,
    excluded,
    predictedTotal,
    actualTotal,
    factor: predictedTotal > 0 ? Number((actualTotal / predictedTotal).toFixed(3)) : 1,
    exclusionRate: classified.length ? Math.round((excluded.length / classified.length) * 100) : 0,
  };
}

/**
 * Whether the rejected pile is big enough to distrust the capture flow itself.
 *
 * If a third of what comes back is unusable, the problem is not a few careless
 * entries — it is that the pilot is asking the wrong question, or asking it at
 * the wrong moment. Calibrating harder will not fix that.
 */
export const EXCLUSION_RATE_ALARM = 25;

export function exclusionWarning(set: CalibrationSet): string | null {
  if (set.excluded.length === 0) return null;
  if (set.exclusionRate >= EXCLUSION_RATE_ALARM) {
    return `${set.exclusionRate}% of recorded times were unusable (${set.excluded.length} of ${set.used.length + set.excluded.length}). That is high enough to suspect the capture flow rather than the people using it — check how actual minutes are being entered before trusting any calibration.`;
  }
  return `${set.excluded.length} sample${set.excluded.length === 1 ? '' : 's'} excluded as implausible or far outside the estimate.`;
}
