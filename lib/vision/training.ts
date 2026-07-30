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

/**
 * One chore, timed.
 *
 * The high-value record in the whole pilot. A job total tells you the estimate
 * was wrong; this tells you that degreasing the stovetop takes triple what the
 * catalog claims, which is a fixable fact about one constant.
 */
export interface TaskActual {
  taskId: string;
  /** Index into the corrected analysis' rooms, so the soil context is known. */
  roomIndex: number;
  /** Minutes actually spent. Omitted when the task was skipped. */
  minutes?: number;
  /** The task did not apply or was not done — itself a useful correction. */
  skipped?: boolean;
}

export interface TrainingSampleInput extends OperatorContext {
  /** Partial by design — a few timed chores beat none. */
  taskActuals?: TaskActual[];
  capturedBy: string;
  serviceSlug: string;
  /** The market this sample is priced against. */
  city?: string;
  /** Where it was actually filmed, when that differs from the market. */
  captureOrigin?: string;
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
      captureOrigin: input.captureOrigin,
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
      taskActuals: input.taskActuals?.length ? (input.taskActuals as unknown as object) : undefined,
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
    recent: rows.slice(0, 25).map((r) => r.record),
    source: isDbConfigured ? 'db' : 'memory',
  };
}
