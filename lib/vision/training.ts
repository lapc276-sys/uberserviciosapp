import { prisma, isDbConfigured } from '../db';
import { SOIL_DIMENSIONS, type PropertyAnalysis, type SoilDimension } from './types';

/**
 * Training data capture and model-error reporting.
 *
 * A sample is only useful if it contains a *correction*: what the model said
 * and what the person in the room said it should be. Storing predictions alone
 * teaches nothing.
 */

/**
 * Operator context — the variance pure vision can never explain.
 * The same room at the same soil level is not the same job on someone's
 * fourth stop of the day as it is on their first.
 */
export interface OperatorContext {
  jobSequence?: number;
  hoursWorkedToday?: number;
  crewSize?: number;
  startHour?: number;
}

export interface TrainingSampleInput extends OperatorContext {
  capturedBy: string;
  serviceSlug: string;
  city?: string;
  propertyType?: string;
  consentName: string;
  consentTraining: boolean;
  frameCount: number;
  predicted: PropertyAnalysis;
  corrected: PropertyAnalysis;
  afterAnalysis?: PropertyAnalysis;
  qualityScore?: number;
  actualMinutes: number;
  notes?: string;
}

export interface TrainingSampleRecord {
  id: string;
  capturedBy: string;
  serviceSlug: string;
  city: string | null;
  predictedMinutes: number;
  actualMinutes: number;
  correctionMagnitude: number;
  frameCount: number;
  jobSequence: number | null;
  hoursWorkedToday: number | null;
  crewSize: number;
  qualityScore: number | null;
  createdAt: string;
}

const memorySamples: (TrainingSampleRecord & { predicted: PropertyAnalysis; corrected: PropertyAnalysis })[] = [];

/**
 * Average absolute soil-score change the human made, across every matched
 * room and dimension. High values mean the model is badly off; near-zero over
 * many samples means it's earned trust.
 */
export function correctionMagnitude(predicted: PropertyAnalysis, corrected: PropertyAnalysis): number {
  let total = 0;
  let count = 0;
  const rooms = Math.min(predicted.rooms.length, corrected.rooms.length);
  for (let i = 0; i < rooms; i++) {
    for (const dim of SOIL_DIMENSIONS) {
      total += Math.abs((predicted.rooms[i].soil[dim] ?? 0) - (corrected.rooms[i].soil[dim] ?? 0));
      count += 1;
    }
  }
  return count === 0 ? 0 : Number((total / count).toFixed(2));
}

export async function saveTrainingSample(input: TrainingSampleInput): Promise<string> {
  const magnitude = correctionMagnitude(input.predicted, input.corrected);
  const record: TrainingSampleRecord = {
    id: `tr_${Date.now().toString(36)}`,
    capturedBy: input.capturedBy,
    serviceSlug: input.serviceSlug,
    city: input.city ?? null,
    predictedMinutes: input.predicted.totalMinutes,
    actualMinutes: input.actualMinutes,
    correctionMagnitude: magnitude,
    frameCount: input.frameCount,
    jobSequence: input.jobSequence ?? null,
    hoursWorkedToday: input.hoursWorkedToday ?? null,
    crewSize: input.crewSize ?? 1,
    qualityScore: input.qualityScore ?? null,
    createdAt: new Date().toISOString(),
  };

  if (!isDbConfigured || !prisma) {
    memorySamples.unshift({ ...record, predicted: input.predicted, corrected: input.corrected });
    return record.id;
  }

  const row = await prisma.trainingSample.create({
    data: {
      capturedBy: input.capturedBy,
      serviceSlug: input.serviceSlug,
      city: input.city,
      propertyType: input.propertyType ?? 'residential',
      consentName: input.consentName,
      consentAt: new Date(),
      consentTraining: input.consentTraining,
      frameCount: input.frameCount,
      predicted: input.predicted as unknown as object,
      corrected: input.corrected as unknown as object,
      predictedMinutes: input.predicted.totalMinutes,
      actualMinutes: input.actualMinutes,
      correctionMagnitude: magnitude,
      jobSequence: input.jobSequence,
      hoursWorkedToday: input.hoursWorkedToday,
      crewSize: input.crewSize ?? 1,
      startHour: input.startHour,
      totalAreaSqft: totalArea(input.corrected) || null,
      afterAnalysis: input.afterAnalysis as unknown as object | undefined,
      qualityScore: input.qualityScore,
      notes: input.notes,
    },
  });
  return row.id;
}

export interface DimensionError {
  dimension: SoilDimension;
  /** Signed mean error: positive means the model over-scores this dimension. */
  bias: number;
  meanAbsError: number;
  samples: number;
}

export interface FatigueBucket {
  label: string;
  samples: number;
  /** Mean signed minutes error. Negative means the job ran longer than predicted. */
  timeBias: number;
  /** Actual minutes as a percentage of predicted. Over 100 = slower than predicted. */
  actualVsPredictedPct: number;
}

/**
 * Groups samples by how far into the worker's day the job was.
 *
 * If later jobs consistently run longer than predicted, fatigue is real and
 * belongs in the time model. This is the cheapest way to test that hypothesis
 * — it needs a handful of samples, not a training run.
 */
export function fatigueBuckets(records: TrainingSampleRecord[]): FatigueBucket[] {
  const buckets: { label: string; match: (r: TrainingSampleRecord) => boolean }[] = [
    { label: '1st job of day', match: (r) => r.jobSequence === 1 },
    { label: '2nd job', match: (r) => r.jobSequence === 2 },
    { label: '3rd job', match: (r) => r.jobSequence === 3 },
    { label: '4th or later', match: (r) => (r.jobSequence ?? 0) >= 4 },
  ];

  return buckets
    .map(({ label, match }) => {
      const inBucket = records.filter((r) => match(r) && r.actualMinutes > 0 && r.predictedMinutes > 0);
      if (inBucket.length === 0) return { label, samples: 0, timeBias: 0, actualVsPredictedPct: 0 };
      const bias = inBucket.reduce((s, r) => s + (r.predictedMinutes - r.actualMinutes), 0) / inBucket.length;
      const ratio =
        inBucket.reduce((s, r) => s + r.actualMinutes / r.predictedMinutes, 0) / inBucket.length;
      return {
        label,
        samples: inBucket.length,
        timeBias: Math.round(bias),
        actualVsPredictedPct: Math.round(ratio * 100),
      };
    })
    .filter((b) => b.samples > 0);
}

export interface AreaAnalysis {
  /** Samples that recorded a measured area. */
  samples: number;
  /** Below this, the numbers below are noise and are labelled as such. */
  sufficient: boolean;
  totalSqftMean: number;
  /** Minutes of labor per square foot — the ISSA-style production rate. */
  minutesPerSqft: number;
  /**
   * How much that rate varies between jobs, as a percentage of its own mean.
   * Low means area alone predicts time well; high means condition dominates.
   */
  minutesPerSqftVariationPct: number;
  /** Correlation of measured area with actual minutes, -1 to 1. */
  areaVsActualR: number;
  /** Correlation of our soil-driven prediction with actual minutes, -1 to 1. */
  predictedVsActualR: number;
  /** Plain-language reading of the two correlations above. */
  verdict: string;
}

/** Pearson correlation. Returns 0 when undefined (constant input, n < 2). */
function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : Number((num / den).toFixed(2));
}

function totalArea(analysis: PropertyAnalysis): number {
  return analysis.rooms.reduce((sum, r) => sum + (r.areaSqft ?? 0), 0);
}

/**
 * Tests, against real jobs, whether floor area predicts cleaning time better
 * than our condition-based model does.
 *
 * This exists because the answer decides what to build next, and it is not
 * knowable from an armchair. The commercial cleaning industry bids by square
 * feet per hour, which is evidence area matters; our model bets on soil level
 * instead. One of those is more right for residential deep cleans, and 30 jobs
 * will say which — far cheaper than building 3D measurement on a hunch and
 * discovering afterwards that it moved nothing.
 *
 * `sufficient` is not decoration. A correlation over eight samples will look
 * decisive and mean nothing, and acting on it is the expensive mistake this
 * whole function is meant to prevent.
 */
const MIN_AREA_SAMPLES = 20;

export function areaAnalysis(
  rows: { corrected: PropertyAnalysis; record: TrainingSampleRecord }[],
): AreaAnalysis {
  const usable = rows.filter((r) => totalArea(r.corrected) > 0 && r.record.actualMinutes > 0);
  const empty: AreaAnalysis = {
    samples: usable.length,
    sufficient: false,
    totalSqftMean: 0,
    minutesPerSqft: 0,
    minutesPerSqftVariationPct: 0,
    areaVsActualR: 0,
    predictedVsActualR: 0,
    verdict: `No measured areas yet. Record room sizes on ${MIN_AREA_SAMPLES} jobs and this will answer whether area or condition drives your times.`,
  };
  if (usable.length === 0) return empty;

  const areas = usable.map((r) => totalArea(r.corrected));
  const actuals = usable.map((r) => r.record.actualMinutes);
  const predicted = usable.map((r) => r.record.predictedMinutes);
  const rates = usable.map((r, i) => actuals[i] / areas[i]);

  const meanArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  const meanRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((s, r) => s + (r - meanRate) ** 2, 0) / rates.length);
  const variation = meanRate === 0 ? 0 : (sd / meanRate) * 100;

  const areaR = correlation(areas, actuals);
  const predR = correlation(predicted, actuals);
  const sufficient = usable.length >= MIN_AREA_SAMPLES;

  let verdict: string;
  if (!sufficient) {
    verdict = `Only ${usable.length} of ${MIN_AREA_SAMPLES} jobs measured. These numbers are not yet meaningful — do not act on them.`;
  } else if (areaR > predR + 0.15) {
    verdict =
      'Area predicts your times better than the condition model does. Worth investing in measuring it properly, and worth adding an area term to the estimator.';
  } else if (predR > areaR + 0.15) {
    verdict =
      'The condition model beats raw area. Automatic measurement would not pay for itself — keep improving the soil scoring instead.';
  } else {
    verdict =
      'Area and condition predict about equally well. The likely win is combining them: an area-based base time scaled by a condition factor.';
  }

  return {
    samples: usable.length,
    sufficient,
    totalSqftMean: Math.round(meanArea),
    minutesPerSqft: Number(meanRate.toFixed(3)),
    minutesPerSqftVariationPct: Math.round(variation),
    areaVsActualR: areaR,
    predictedVsActualR: predR,
    verdict,
  };
}

export interface TrainingReport {
  samples: number;
  /** Signed minutes error: positive means the model over-estimates time. */
  timeBias: number;
  timeMeanAbsError: number;
  within20Pct: number;
  avgCorrectionMagnitude: number;
  /** Per-dimension error, worst first — tells you what to fix in the prompt. */
  dimensions: DimensionError[];
  fatigue: FatigueBucket[];
  /** Mean quality score across samples that captured an after-walkthrough. */
  avgQualityScore: number;
  qualitySamples: number;
  /** Does floor area predict time better than our condition model? */
  area: AreaAnalysis;
  recent: TrainingSampleRecord[];
  source: 'db' | 'memory';
}

export async function getTrainingReport(): Promise<TrainingReport> {
  let rows: { predicted: PropertyAnalysis; corrected: PropertyAnalysis; record: TrainingSampleRecord }[];

  if (!isDbConfigured || !prisma) {
    rows = memorySamples.slice(0, 300).map((s) => ({ predicted: s.predicted, corrected: s.corrected, record: s }));
  } else {
    const found = await prisma.trainingSample.findMany({ take: 300, orderBy: { createdAt: 'desc' } });
    rows = found.map((r) => ({
      predicted: r.predicted as unknown as PropertyAnalysis,
      corrected: r.corrected as unknown as PropertyAnalysis,
      record: {
        id: r.id,
        capturedBy: r.capturedBy,
        serviceSlug: r.serviceSlug,
        city: r.city,
        predictedMinutes: r.predictedMinutes,
        actualMinutes: r.actualMinutes,
        correctionMagnitude: r.correctionMagnitude,
        frameCount: r.frameCount,
        jobSequence: r.jobSequence,
        hoursWorkedToday: r.hoursWorkedToday,
        crewSize: r.crewSize,
        qualityScore: r.qualityScore,
        createdAt: r.createdAt.toISOString(),
      },
    }));
  }

  const totals: Record<SoilDimension, { signed: number; abs: number; n: number }> = Object.fromEntries(
    SOIL_DIMENSIONS.map((d) => [d, { signed: 0, abs: 0, n: 0 }]),
  ) as Record<SoilDimension, { signed: number; abs: number; n: number }>;

  for (const { predicted, corrected } of rows) {
    const roomCount = Math.min(predicted.rooms.length, corrected.rooms.length);
    for (let i = 0; i < roomCount; i++) {
      for (const dim of SOIL_DIMENSIONS) {
        const delta = (predicted.rooms[i].soil[dim] ?? 0) - (corrected.rooms[i].soil[dim] ?? 0);
        totals[dim].signed += delta;
        totals[dim].abs += Math.abs(delta);
        totals[dim].n += 1;
      }
    }
  }

  const withTime = rows.filter((r) => r.record.actualMinutes > 0);
  const timeBias = withTime.length
    ? withTime.reduce((s, r) => s + (r.record.predictedMinutes - r.record.actualMinutes), 0) / withTime.length
    : 0;
  const timeAbs = withTime.length
    ? withTime.reduce((s, r) => s + Math.abs(r.record.predictedMinutes - r.record.actualMinutes), 0) / withTime.length
    : 0;
  const withQuality = rows.filter((r) => typeof r.record.qualityScore === 'number');
  const close = withTime.filter(
    (r) => Math.abs(r.record.predictedMinutes - r.record.actualMinutes) / r.record.actualMinutes <= 0.2,
  ).length;

  return {
    samples: rows.length,
    timeBias: Math.round(timeBias),
    timeMeanAbsError: Math.round(timeAbs),
    within20Pct: withTime.length ? Math.round((close / withTime.length) * 100) : 0,
    avgCorrectionMagnitude: rows.length
      ? Number((rows.reduce((s, r) => s + r.record.correctionMagnitude, 0) / rows.length).toFixed(1))
      : 0,
    dimensions: SOIL_DIMENSIONS.map((dimension) => ({
      dimension,
      bias: totals[dimension].n ? Number((totals[dimension].signed / totals[dimension].n).toFixed(1)) : 0,
      meanAbsError: totals[dimension].n ? Number((totals[dimension].abs / totals[dimension].n).toFixed(1)) : 0,
      samples: totals[dimension].n,
    })).sort((a, b) => b.meanAbsError - a.meanAbsError),
    fatigue: fatigueBuckets(rows.map((r) => r.record)),
    avgQualityScore: withQuality.length
      ? Math.round(withQuality.reduce((s, r) => s + (r.record.qualityScore ?? 0), 0) / withQuality.length)
      : 0,
    qualitySamples: withQuality.length,
    area: areaAnalysis(rows),
    recent: rows.slice(0, 25).map((r) => r.record),
    source: isDbConfigured ? 'db' : 'memory',
  };
}
