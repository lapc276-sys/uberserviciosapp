import { prisma, isDbConfigured } from '../db';
import { SOIL_DIMENSIONS, type PropertyAnalysis, type SoilDimension } from './types';

/**
 * Training data capture and model-error reporting.
 *
 * A sample is only useful if it contains a *correction*: what the model said
 * and what the person in the room said it should be. Storing predictions alone
 * teaches nothing.
 */

export interface TrainingSampleInput {
  capturedBy: string;
  serviceSlug: string;
  city?: string;
  propertyType?: string;
  consentName: string;
  consentTraining: boolean;
  frameCount: number;
  predicted: PropertyAnalysis;
  corrected: PropertyAnalysis;
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

export interface TrainingReport {
  samples: number;
  /** Signed minutes error: positive means the model over-estimates time. */
  timeBias: number;
  timeMeanAbsError: number;
  within20Pct: number;
  avgCorrectionMagnitude: number;
  /** Per-dimension error, worst first — tells you what to fix in the prompt. */
  dimensions: DimensionError[];
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
    recent: rows.slice(0, 25).map((r) => r.record),
    source: isDbConfigured ? 'db' : 'memory',
  };
}
