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
const DEFAULT_SOIL_WEIGHTS: Record<SoilDimension, number> = {
  dust: 8,
  grease: 6,
  stains: 8,
  clutter: 10,
  hair: 6,
  trash: 6,
  mold: 10,
};

const ROOM_SOIL_WEIGHTS: Partial<Record<RoomType, Partial<Record<SoilDimension, number>>>> = {
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

/**
 * Things that predict work the camera did not catch.
 *
 * A baby bottle takes no time to clean. What it tells you is that there is an
 * infant in the house, and a home with an infant generates mess between the
 * video and the visit in a way an empty apartment does not. A dog bowl says
 * the same about hair: a floor can photograph clean and still shed a bag of it
 * into a vacuum, because the frame caught the half of the room the dog was not
 * lying on.
 *
 * So these are not priced as objects. They raise a FLOOR under one soil
 * dimension — the estimate refuses to believe hair is near zero in a house
 * with a dog — and they only ever raise it. A room the model already scored
 * above the floor is left exactly as observed, which keeps the signal from
 * stacking on top of evidence that already accounts for it.
 *
 * The honest framing for a customer: "we saw a dog bowl, so we budgeted for
 * pet hair even though your floor looked clean in the video."
 */
export interface HouseholdSignal {
  /** Object names, lowercase, as the model reports them. */
  match: string[];
  dimension: SoilDimension;
  /** The 0-100 value this dimension cannot fall below once the signal fires. */
  floor: number;
  /** Shown to the pro so the number is explainable, not magic. */
  label: string;
}

export const HOUSEHOLD_SIGNALS: HouseholdSignal[] = [
  {
    match: ['baby bottle', 'bottle warmer', 'high chair', 'crib', 'cot', 'changing table', 'playpen', 'stroller', 'diaper', 'baby toys'],
    dimension: 'stains',
    floor: 35,
    label: 'bebé en casa',
  },
  {
    match: ['dog bowl', 'cat bowl', 'pet bowl', 'pet food', 'dog food', 'cat food', 'dog bed', 'pet bed', 'litter box', 'pet crate', 'leash', 'scratching post', 'dog', 'cat'],
    dimension: 'hair',
    floor: 40,
    label: 'mascota',
  },
  {
    match: ['toys', 'toy box', 'kids toys', 'play mat'],
    dimension: 'clutter',
    floor: 35,
    label: 'niños pequeños',
  },
  {
    match: ['ashtray', 'cigarettes', 'cigarette'],
    dimension: 'stains',
    floor: 30,
    label: 'se fuma dentro',
  },
  {
    match: ['moving boxes', 'cardboard boxes', 'packing boxes'],
    dimension: 'dust',
    floor: 30,
    label: 'mudanza en curso',
  },
];

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

export function soilWeightsFor(room: RoomType): Record<SoilDimension, number> {
  return { ...DEFAULT_SOIL_WEIGHTS, ...(ROOM_SOIL_WEIGHTS[room] ?? {}) };
}

/** Weighted soil average (0–100), used for the human-readable condition. */
export function soilIndex(soil: SoilScores, room: RoomType): number {
  const weights = soilWeightsFor(room);
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
