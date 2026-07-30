import { ROOM_TYPES } from './types';
import type { RoomType, SoilDimension, SoilScores, ConditionLevel } from './types';

/**
 * The time model — the calibratable heart of the whole product.
 *
 * No vision model knows that a greasy kitchen takes 52 minutes. These numbers
 * are the current best estimate; they are only trustworthy once corrected
 * against reality. Bookings record `actualMinutes` when a pro finishes, and
 * `/admin/vision` compares predicted vs. actual so these constants can be
 * tuned per market. Treat every number here as a hypothesis, not a fact.
 */

/** Baseline minutes for a standard-condition room of each type. */
export const ROOM_BASE_MINUTES: Record<RoomType, number> = {
  kitchen: 30,
  bathroom: 22,
  bedroom: 15,
  living_room: 20,
  dining_room: 14,
  office: 14,
  laundry: 10,
  garage: 18,
  stairs: 8,
  hallway: 6,
  patio: 15,
  other: 12,
};

/**
 * How much each soil dimension matters, per room type. A greasy kitchen costs
 * far more time than a greasy bedroom; mold in a bathroom is the expensive case.
 * Values are minutes added at a score of 100.
 */
export const DEFAULT_SOIL_WEIGHTS: Record<SoilDimension, number> = {
  dust: 8,
  grease: 6,
  stains: 8,
  clutter: 10,
  hair: 6,
  trash: 6,
  mold: 10,
};

export const ROOM_SOIL_WEIGHTS: Partial<Record<RoomType, Partial<Record<SoilDimension, number>>>> = {
  kitchen: { grease: 26, stains: 14, clutter: 12, trash: 8 },
  bathroom: { mold: 24, stains: 18, hair: 12, grease: 6 },
  bedroom: { clutter: 14, dust: 10, hair: 8 },
  living_room: { clutter: 14, dust: 12, stains: 10, hair: 8 },
  garage: { clutter: 22, dust: 14, trash: 12 },
  patio: { dust: 14, clutter: 12, mold: 10 },
};

/** Objects that reliably add work when present, in minutes each. */
export const OBJECT_TIME_COST: Record<string, number> = {
  oven: 14,
  stove: 8,
  refrigerator: 12,
  fridge: 12,
  microwave: 5,
  dishwasher: 5,
  'range hood': 8,
  bathtub: 10,
  shower: 10,
  toilet: 6,
  sink: 4,
  mirror: 3,
  window: 4,
  blinds: 6,
  carpet: 8,
  rug: 5,
  sofa: 6,
  couch: 6,
  mattress: 5,
  bed: 4,
  'litter box': 8,
  'pet bed': 5,
  'trash can': 3,
  cabinet: 4,
  'ceiling fan': 5,
  chandelier: 6,
  balcony: 8,
};

/** A single job longer than this warrants a second pro, and so on. */
export const MINUTES_PER_PRO = 240;

/**
 * Service multipliers. A deep clean of the same room legitimately takes longer
 * than a standard clean; a move-out adds inside-cabinet work.
 */
export const SERVICE_TIME_MULTIPLIER: Record<string, number> = {
  'house-cleaning': 1,
  'apartment-cleaning': 0.95,
  'deep-cleaning': 1.45,
  'move-in-cleaning': 1.5,
  'move-out-cleaning': 1.55,
  'airbnb-cleaning': 1.05,
  'office-cleaning': 1,
  'commercial-cleaning': 1.1,
  'post-construction-cleaning': 1.9,
};

/**
 * Every tunable number in one object.
 *
 * The constants above are the *starting* values, not the model. Calibration
 * means replacing this object with one fitted to real jobs in a real market —
 * which is why nothing downstream reads the constants directly any more. Pass
 * the params in and the same code prices Miami and Manhattan differently
 * without a deploy.
 */
export interface TimeModelParams {
  roomBaseMinutes: Record<RoomType, number>;
  defaultSoilWeights: Record<SoilDimension, number>;
  roomSoilWeights: Partial<Record<RoomType, Partial<Record<SoilDimension, number>>>>;
  objectTimeCost: Record<string, number>;
  serviceTimeMultiplier: Record<string, number>;
  minutesPerPro: number;
  /**
   * Which estimator prices the job.
   *
   * Defaults to `room` — not because it is better, but because it is the one
   * that has been quoting real work. The task model is finer-grained and more
   * useful in the field, and it is also built entirely from desk estimates.
   * Switching a market to `task` is a deliberate, versioned decision to be made
   * once the pilot has per-task times worth trusting.
   */
  estimator: 'room' | 'task';
}

/** The uncalibrated hypothesis every market starts from. */
export const DEFAULT_TIME_MODEL: TimeModelParams = {
  roomBaseMinutes: ROOM_BASE_MINUTES,
  defaultSoilWeights: DEFAULT_SOIL_WEIGHTS,
  roomSoilWeights: ROOM_SOIL_WEIGHTS,
  objectTimeCost: OBJECT_TIME_COST,
  serviceTimeMultiplier: SERVICE_TIME_MULTIPLIER,
  minutesPerPro: MINUTES_PER_PRO,
  estimator: 'room',
};

export function soilWeightsFor(
  room: RoomType,
  params: TimeModelParams = DEFAULT_TIME_MODEL,
): Record<SoilDimension, number> {
  return { ...params.defaultSoilWeights, ...(params.roomSoilWeights[room] ?? {}) };
}

/** Weighted soil average (0–100), used for the human-readable condition. */
export function soilIndex(
  soil: SoilScores,
  room: RoomType,
  params: TimeModelParams = DEFAULT_TIME_MODEL,
): number {
  const weights = soilWeightsFor(room, params);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const weighted = (Object.keys(weights) as SoilDimension[]).reduce(
    (sum, key) => sum + (soil[key] ?? 0) * weights[key],
    0,
  );
  return totalWeight === 0 ? 0 : weighted / totalWeight;
}

export function conditionFromIndex(index: number): ConditionLevel {
  if (index < 12) return 'excellent';
  if (index < 28) return 'good';
  if (index < 48) return 'fair';
  if (index < 70) return 'poor';
  return 'very_poor';
}

/**
 * Merges a stored (possibly partial, possibly hand-edited) config over the
 * defaults, clamping anything nonsensical.
 *
 * This exists because the whole point of moving the model into the database is
 * that a human can edit it at 11pm to fix a market — and a typo there must
 * degrade to "the default for that one field", never to a zero-minute job or a
 * NaN price. A stored config is untrusted input like any other.
 */
export function mergeTimeModel(stored: unknown): TimeModelParams {
  const raw = (stored ?? {}) as Partial<Record<keyof TimeModelParams, unknown>>;

  const positive = (value: unknown, fallback: number, max: number): number => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, max);
  };

  const numberMap = <K extends string>(
    value: unknown,
    defaults: Record<K, number>,
    max: number,
  ): Record<K, number> => {
    const out = { ...defaults };
    if (value && typeof value === 'object') {
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        // Unknown keys are kept: a market may legitimately learn that
        // "espresso machine" costs time before the catalog knows it.
        const fallback = (defaults as Record<string, number>)[key] ?? 0;
        (out as Record<string, number>)[key] = positive(raw, fallback, max);
      }
    }
    return out;
  };

  const roomSoilWeights: TimeModelParams['roomSoilWeights'] = {};
  const storedRoomWeights = raw.roomSoilWeights;
  if (storedRoomWeights && typeof storedRoomWeights === 'object') {
    for (const [room, weights] of Object.entries(storedRoomWeights as Record<string, unknown>)) {
      if (!(ROOM_TYPES as readonly string[]).includes(room)) continue;
      const base = ROOM_SOIL_WEIGHTS[room as RoomType] ?? {};
      roomSoilWeights[room as RoomType] = numberMap(weights, base as Record<SoilDimension, number>, 120);
    }
  }

  return {
    roomBaseMinutes: numberMap(raw.roomBaseMinutes, ROOM_BASE_MINUTES, 240),
    defaultSoilWeights: numberMap(raw.defaultSoilWeights, DEFAULT_SOIL_WEIGHTS, 120),
    roomSoilWeights: { ...ROOM_SOIL_WEIGHTS, ...roomSoilWeights },
    objectTimeCost: numberMap(raw.objectTimeCost, OBJECT_TIME_COST, 120),
    serviceTimeMultiplier: numberMap(raw.serviceTimeMultiplier, SERVICE_TIME_MULTIPLIER, 5),
    minutesPerPro: positive(raw.minutesPerPro, MINUTES_PER_PRO, 960) || MINUTES_PER_PRO,
    estimator: raw.estimator === 'task' ? 'task' : 'room',
  };
}

/**
 * Scales a model by a single factor.
 *
 * The first useful calibration is almost always "we are uniformly 18% fast" —
 * a global bias correction, not a per-weight refit. Fitting individual soil
 * weights needs far more samples than a young operation has, and pretending
 * otherwise produces confident nonsense.
 */
export function scaleTimeModel(params: TimeModelParams, factor: number): TimeModelParams {
  const f = Math.max(0.5, Math.min(factor, 2));
  const scale = (map: Record<string, number>) =>
    Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Number((v * f).toFixed(2))]));

  return {
    ...params,
    roomBaseMinutes: scale(params.roomBaseMinutes) as Record<RoomType, number>,
    defaultSoilWeights: scale(params.defaultSoilWeights) as Record<SoilDimension, number>,
    roomSoilWeights: Object.fromEntries(
      Object.entries(params.roomSoilWeights).map(([room, weights]) => [room, scale(weights as Record<string, number>)]),
    ) as TimeModelParams['roomSoilWeights'],
    objectTimeCost: scale(params.objectTimeCost),
  };
}
