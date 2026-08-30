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

/**
 * Two jobs per object, not one.
 *
 * Wiping the front of a fridge and cleaning its shelves are different work by
 * an order of magnitude, and which one happens is decided by the service, not
 * by the appliance. A single number per object cannot express that, so the
 * old table quietly encoded the deep figure and then let the service
 * multiplier scale it — which charged a maintenance clean for work nobody did,
 * and charged a deep clean twice.
 *
 * The split comes from a measured job where, by luck, exactly one appliance
 * was cleaned inside and the rest were wiped down. Same person, same
 * apartment, same afternoon:
 *
 *   microwave, cleaned INSIDE   3.5 min   (old table said 5 — close)
 *   dishwasher, wiped outside   0.7 min   (old table said 5 — 7x over)
 *   fridge door, wiped          1.0 min   (old table said 12 — 12x over)
 *   cabinet, wiped, each        0.6 min   (old table said 4 — 7x over)
 *   oven, not touched at all    0.0 min   (old table charged 14)
 *
 * The one deep-cleaned item was nearly right and every surface-cleaned item
 * was five to twelve times over. That is not a calibration error, it is a
 * missing dimension.
 *
 * `surface` values marked MEASURED come from that job. The rest are estimates
 * pending measurement, set at roughly the same ratio, and should be treated as
 * hypotheses exactly like every other number in this file.
 */
export interface ObjectTimeCost {
  /** Wiping the outside. What a maintenance clean actually does. */
  surface: number;
  /** Cleaning inside, degreasing, moving contents. What a deep clean adds. */
  deep: number;
}

export const OBJECT_TIME_COST: Record<string, ObjectTimeCost> = {
  oven: { surface: 1.5, deep: 14 },
  stove: { surface: 2, deep: 8 },
  refrigerator: { surface: 1.0, deep: 12 }, // surface MEASURED (door)
  fridge: { surface: 1.0, deep: 12 }, // surface MEASURED (door)
  microwave: { surface: 1.0, deep: 3.5 }, // deep MEASURED
  dishwasher: { surface: 0.7, deep: 5 }, // surface MEASURED
  'range hood': { surface: 1.5, deep: 8 },
  bathtub: { surface: 3, deep: 10 },
  shower: { surface: 3, deep: 10 },
  toilet: { surface: 2.5, deep: 6 },
  sink: { surface: 1.5, deep: 4 },
  mirror: { surface: 1.5, deep: 3 },
  window: { surface: 1.5, deep: 4 },
  blinds: { surface: 1.5, deep: 6 },
  carpet: { surface: 3, deep: 8 },
  rug: { surface: 2, deep: 5 },
  sofa: { surface: 2, deep: 6 },
  couch: { surface: 2, deep: 6 },
  mattress: { surface: 1, deep: 5 },
  bed: { surface: 2, deep: 4 },
  'litter box': { surface: 3, deep: 8 },
  'pet bed': { surface: 2, deep: 5 },
  'trash can': { surface: 1, deep: 3 },
  cabinet: { surface: 0.6, deep: 4 }, // surface MEASURED
  'ceiling fan': { surface: 1.5, deep: 5 },
  chandelier: { surface: 2, deep: 6 },
  balcony: { surface: 3, deep: 8 },
};

/**
 * Which services open things up, and which only wipe them down.
 *
 * This replaces asking the service multiplier to express depth. It could not:
 * a multiplier scales everything in the room by the same factor, but going
 * from maintenance to deep does not make the floor take 45% longer — it adds
 * the inside of an oven.
 */
const DEEP_SERVICES = new Set([
  'deep-cleaning',
  'move-in-cleaning',
  'move-out-cleaning',
  'post-construction-cleaning',
]);

export function objectMinutesFor(name: string, serviceSlug: string): number {
  const cost = OBJECT_TIME_COST[name];
  if (!cost) return 0;
  return DEEP_SERVICES.has(serviceSlug) ? cost.deep : cost.surface;
}

export function isDeepService(serviceSlug: string): boolean {
  return DEEP_SERVICES.has(serviceSlug);
}
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

/**
 * How many of a thing may legitimately be counted.
 *
 * A blanket cap existed to stop a hallucinated "47 ovens" inflating a bill,
 * and it was set at 6 for everything. But the things that hallucinate are the
 * things there is normally one of, and the things there are genuinely many of
 * — cabinets, windows, doors — are exactly the ones a real kitchen exceeds.
 * A measured job with ten cabinets was silently priced as six.
 *
 * So the cap is per object: one for the appliances a home has one of, and
 * generous for the countable ones. A second oven still counts as one, which
 * is the correct failure: under-counting an appliance costs a few minutes,
 * while believing in six of them costs the customer their trust.
 */
export const OBJECT_COUNT_CAP: Record<string, number> = {
  cabinet: 20,
  window: 16,
  blinds: 16,
  mirror: 6,
  sink: 4,
  toilet: 6,
  bathtub: 4,
  shower: 4,
  rug: 8,
  carpet: 6,
  sofa: 4,
  couch: 4,
  bed: 6,
  mattress: 6,
  'trash can': 6,
  'ceiling fan': 8,
};

/** Things a home has one of. Anything not listed above gets this. */
export const DEFAULT_OBJECT_COUNT_CAP = 2;

export function countCapFor(name: string): number {
  return OBJECT_COUNT_CAP[name] ?? DEFAULT_OBJECT_COUNT_CAP;
}

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
