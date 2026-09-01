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
  // ── Cocina ────────────────────────────────────────────────────────────────
  oven: { surface: 1.5, deep: 14 },
  stove: { surface: 2, deep: 8 },
  cooktop: { surface: 2, deep: 8 },
  'range hood': { surface: 1.5, deep: 8 },
  refrigerator: { surface: 1.0, deep: 12 }, // surface MEASURED (door)
  fridge: { surface: 1.0, deep: 12 }, // surface MEASURED (door)
  freezer: { surface: 1.0, deep: 10 },
  microwave: { surface: 1.0, deep: 3.5 }, // deep MEASURED
  dishwasher: { surface: 0.7, deep: 5 }, // surface MEASURED
  sink: { surface: 1.5, deep: 4 },
  faucet: { surface: 0.5, deep: 1.5 },
  backsplash: { surface: 1.5, deep: 5 },
  cabinet: { surface: 0.6, deep: 4 }, // surface MEASURED
  drawer: { surface: 0.5, deep: 3 },
  pantry: { surface: 2, deep: 10 },
  countertop: { surface: 2, deep: 4 },
  'kitchen island': { surface: 2, deep: 5 },
  toaster: { surface: 0.5, deep: 1.5 },
  'toaster oven': { surface: 0.8, deep: 4 },
  'coffee maker': { surface: 0.6, deep: 2.5 },
  kettle: { surface: 0.4, deep: 1 },
  blender: { surface: 0.5, deep: 2 },
  'air fryer': { surface: 0.8, deep: 4 },
  'stand mixer': { surface: 0.6, deep: 2 },
  'rice cooker': { surface: 0.5, deep: 2 },
  'slow cooker': { surface: 0.5, deep: 2 },
  'dish rack': { surface: 0.8, deep: 2 },
  'knife block': { surface: 0.4, deep: 1.5 },
  'utensil holder': { surface: 0.4, deep: 1.5 },
  'spice rack': { surface: 0.6, deep: 2 },
  'water dispenser': { surface: 0.6, deep: 2 },
  'wine rack': { surface: 0.6, deep: 2 },
  'trash can': { surface: 1, deep: 3 },
  'recycling bin': { surface: 0.8, deep: 2.5 },

  // ── Baño ──────────────────────────────────────────────────────────────────
  toilet: { surface: 2.5, deep: 6 },
  bidet: { surface: 1.5, deep: 4 },
  bathtub: { surface: 3, deep: 10 },
  shower: { surface: 3, deep: 10 },
  'shower door': { surface: 1.5, deep: 5 },
  'shower curtain': { surface: 1, deep: 3 },
  vanity: { surface: 1.5, deep: 4 },
  'medicine cabinet': { surface: 1, deep: 4 },
  'towel rack': { surface: 0.5, deep: 1.5 },
  'bath mat': { surface: 0.5, deep: 1.5 },
  'exhaust fan': { surface: 1, deep: 3 },

  // ── Habitación ────────────────────────────────────────────────────────────
  bed: { surface: 2, deep: 4 },
  'bunk bed': { surface: 2.5, deep: 5 },
  mattress: { surface: 1, deep: 5 },
  headboard: { surface: 0.8, deep: 2 },
  nightstand: { surface: 0.8, deep: 2 },
  dresser: { surface: 1.5, deep: 4 },
  wardrobe: { surface: 1.5, deep: 6 },
  closet: { surface: 1.5, deep: 8 },
  desk: { surface: 1, deep: 3 },
  crib: { surface: 1.5, deep: 4 },

  // ── Sala y comedor ────────────────────────────────────────────────────────
  sofa: { surface: 2, deep: 6 },
  couch: { surface: 2, deep: 6 },
  armchair: { surface: 1.2, deep: 3 },
  'coffee table': { surface: 1, deep: 2.5 },
  'side table': { surface: 0.6, deep: 1.5 },
  'dining table': { surface: 1.5, deep: 3 },
  'dining chair': { surface: 0.6, deep: 1.5 },
  sideboard: { surface: 1.2, deep: 3 },
  bookshelf: { surface: 2, deep: 6 },
  tv: { surface: 1, deep: 2 },
  'tv stand': { surface: 1, deep: 2.5 },
  fireplace: { surface: 2, deep: 6 },
  piano: { surface: 1.5, deep: 4 },
  'picture frame': { surface: 0.4, deep: 1 },
  plant: { surface: 0.5, deep: 1.5 },

  // ── Suelos y textiles ─────────────────────────────────────────────────────
  carpet: { surface: 3, deep: 8 },
  rug: { surface: 2, deep: 5 },
  curtains: { surface: 1.5, deep: 5 },
  blinds: { surface: 1.5, deep: 6 },

  // ── Lavadero ──────────────────────────────────────────────────────────────
  'washing machine': { surface: 1, deep: 5 },
  dryer: { surface: 1, deep: 5 },
  'laundry sink': { surface: 1.2, deep: 3 },
  'ironing board': { surface: 0.5, deep: 1.5 },
  'laundry basket': { surface: 0.5, deep: 1.5 },

  // ── Toda la casa ──────────────────────────────────────────────────────────
  window: { surface: 1.5, deep: 4 },
  'window sill': { surface: 0.5, deep: 1.5 },
  door: { surface: 0.8, deep: 2 },
  baseboard: { surface: 1.5, deep: 5 },
  mirror: { surface: 1.5, deep: 3 },
  'ceiling fan': { surface: 1.5, deep: 5 },
  chandelier: { surface: 2, deep: 6 },
  'light fixture': { surface: 0.8, deep: 2 },
  'air vent': { surface: 0.6, deep: 2 },
  radiator: { surface: 1, deep: 3 },
  handrail: { surface: 0.6, deep: 1.5 },
  balcony: { surface: 3, deep: 8 },

  // ── Mascotas y bebés ──────────────────────────────────────────────────────
  'litter box': { surface: 3, deep: 8 },
  'pet bed': { surface: 2, deep: 5 },
  'pet crate': { surface: 1.5, deep: 4 },
  'high chair': { surface: 1, deep: 3 },
  stroller: { surface: 1, deep: 3 },
  playpen: { surface: 1.5, deep: 4 },
};

/**
 * A ceiling on what objects may contribute to one room.
 *
 * The table above is deliberately long, and a long table has a failure mode a
 * short one does not: a model asked to inventory a kitchen will list thirty
 * things it can see, and thirty half-minute items silently become fifteen
 * minutes nobody is going to spend.
 *
 * This is a sanity rail, not a corrective. It is scaled off the room base
 * because a kitchen and a hallway do not carry the same plausible object load,
 * and it is set loose enough that a genuine deep clean is never clipped —
 * catching the absurd, not the merely generous.
 *
 * KNOWN OVERLAP, unresolved on purpose: `countertop` and `backsplash` are in
 * the table, and ROOM_BASE_MINUTES almost certainly also covers wiping
 * counters. Which of the two should own that time depends on whether the base
 * is "the room's surfaces" or "the cost of being in the room at all" —
 * overhead, walking, setting up, moving furniture. A stopwatch run of one job
 * measured 6.1 minutes of counters against a 30-minute base, which says the
 * base is mostly overhead, but a stopwatch by design never times the overhead
 * it would need to prove that. It takes a door-to-door total to settle, and
 * guessing in the meantime would bake the guess into every quote.
 */
export const MAX_OBJECT_MINUTES_MULTIPLE = 2.5;
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
