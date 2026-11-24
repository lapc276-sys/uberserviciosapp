import type { SupplyPlan } from './supplies';
import type { CrewPlan } from './plan';

/**
 * Domain model for AI property analysis.
 *
 * Deliberately provider-agnostic: the analyzer interface below is what the
 * rest of the app depends on, so a hosted vision LLM today can be swapped for
 * a self-hosted YOLO/SAM service later without touching any caller.
 */

export const ROOM_TYPES = [
  'kitchen',
  'bathroom',
  'bedroom',
  'living_room',
  'dining_room',
  'office',
  'laundry',
  'garage',
  'stairs',
  'hallway',
  'patio',
  'other',
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

/**
 * The same names in Spanish, for everything the crew reads — the work plan
 * and the notes. One table, so the plan and the notes cannot name the same
 * room two different ways.
 */
export const ROOM_LABELS_ES: Record<RoomType, string> = {
  kitchen: 'Cocina',
  bathroom: 'Baño',
  bedroom: 'Dormitorio',
  living_room: 'Sala',
  dining_room: 'Comedor',
  office: 'Oficina',
  laundry: 'Lavadero',
  garage: 'Garaje',
  stairs: 'Escaleras',
  hallway: 'Pasillo',
  patio: 'Patio',
  other: 'Otro espacio',
};

export const ROOM_LABELS: Record<RoomType, string> = {
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  bedroom: 'Bedroom',
  living_room: 'Living room',
  dining_room: 'Dining room',
  office: 'Office',
  laundry: 'Laundry',
  garage: 'Garage',
  stairs: 'Stairs',
  hallway: 'Hallway',
  patio: 'Patio',
  other: 'Other space',
};

/** Each dimension is 0–100, where 0 is spotless. */
export const SOIL_DIMENSIONS = ['dust', 'grease', 'stains', 'clutter', 'hair', 'trash', 'mold'] as const;
export type SoilDimension = (typeof SOIL_DIMENSIONS)[number];
export type SoilScores = Record<SoilDimension, number>;

export const CONDITION_LEVELS = ['excellent', 'good', 'fair', 'poor', 'very_poor'] as const;
export type ConditionLevel = (typeof CONDITION_LEVELS)[number];

export const CONDITION_LABELS: Record<ConditionLevel, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  very_poor: 'Very poor',
};

export interface DetectedObject {
  /** Free-form label, e.g. "oven", "sofa", "litter box". */
  name: string;
  count: number;
  /** 0–1. Low-confidence detections are shown but not priced aggressively. */
  confidence: number;
}

/**
 * A surface the room is made of — see lib/vision/materials.ts.
 *
 * Separate from `DetectedObject` because it answers a different question: an
 * object is something to clean, a material is how it has to be cleaned and
 * what must not touch it.
 */
export interface DetectedMaterial {
  /** A key of MATERIALS. Anything else is discarded on the way in. */
  name: string;
  /** 0–1. Warned about when weak, billed only when firm. */
  confidence: number;
}

/**
 * What the customer asked the crew to clean with, from the walkthrough's
 * closing chat. Never changes the price; `eco` changes what the crew plan may
 * spray, so the plan cannot order the bleach the customer said no to.
 */
export const PRODUCT_PREFERENCES = ['standard', 'eco', 'unscented', 'own'] as const;
export type ProductPreference = (typeof PRODUCT_PREFERENCES)[number];

/**
 * Something visibly broken — see lib/vision/damage.ts.
 *
 * Never priced. It becomes a question to the customer ("¿quieres que te
 * contactemos para arreglarlo?") and a note to the crew that it was already
 * like that before they arrived.
 */
export interface DetectedDamage {
  /** A key of DAMAGE. Anything else is discarded on the way in. */
  kind: string;
  /** 0–1. Asked about only when firm; noted for the crew when weaker. */
  confidence: number;
}

/**
 * Things to put away in a room, counted — see lib/vision/tidying.ts.
 *
 * Counts rather than a score because a score saturates: "messy" and "you
 * cannot see the floor" both read near 100, and the second is an hour.
 */
export interface TidyingCounts {
  /** On floors and counters, to be moved so they can be cleaned at all. */
  toClear: number;
  /** Of those, how many belong in a different room. Never more than toClear. */
  elsewhere: number;
  /** Dishes, pots and pans waiting to be washed. */
  dishes: number;
}

export interface RoomAnalysis {
  type: RoomType;
  /** Human label, disambiguated when repeated ("Bedroom 2"). */
  label: string;
  confidence: number;
  objects: DetectedObject[];
  /** Surfaces that changed the method, already filtered to known ones. */
  materials?: DetectedMaterial[];
  /** What had to be put away, when the analyzer counted it. */
  tidying?: TidyingCounts;
  /** Broken before anyone arrived, for the crew. Never part of the price. */
  damage?: DetectedDamage[];
  soil: SoilScores;
  condition: ConditionLevel;
  /** Minutes of cleaning work, computed by the estimator (not the model). */
  estimatedMinutes: number;
  /**
   * Floor area in square feet, when someone measured it.
   *
   * Never inferred from the footage — monocular video has no scale reference,
   * so a guessed area would be a confident-looking number with nothing behind
   * it. Absent until a human enters it, which is the honest state.
   */
  areaSqft?: number;
  notes?: string;
}

export interface PropertyAnalysis {
  rooms: RoomAnalysis[];
  totalMinutes: number;
  /** Crew size the job warrants, so a long job isn't a 9-hour solo shift. */
  recommendedPros: number;
  /** Product names only — the detailed plan lives in `supplyPlan`. */
  suppliesNeeded: string[];
  /** Quantities, costs, PPE and never-mix warnings. See lib/vision/supplies.ts. */
  supplyPlan?: SupplyPlan;
  /**
   * The order to do the job in, for the person doing it. See lib/vision/plan.ts.
   * Never feeds the price: its minutes sum to `totalMinutes` exactly.
   */
  crewPlan?: CrewPlan;
  condition: ConditionLevel;
  /** 0–1 overall confidence; drives how wide the quoted range is. */
  confidence: number;
  /** Which engine produced this — surfaced in the admin for auditing. */
  source: 'vision-llm' | 'heuristic';
  warnings: string[];
}

/** What a vision model is asked to return, before the estimator runs. */
export interface RawRoomObservation {
  type: RoomType;
  confidence: number;
  objects: DetectedObject[];
  /** Absent from analyzers that do not look for surfaces. */
  materials?: DetectedMaterial[];
  /**
   * Absent from analyzers that do not count. Without it the room falls back to
   * the clutter score, exactly as before counting existed.
   */
  tidying?: TidyingCounts;
  /** Absent from analyzers that do not look for it. */
  damage?: DetectedDamage[];
  soil: SoilScores;
  notes?: string;
}

export interface AnalyzerInput {
  /** Data URLs or https URLs of frames sampled from the walkthrough video. */
  frames: string[];
  /**
   * What each frame was aimed at, parallel to `frames`, when the walkthrough
   * was guided rather than sampled blindly.
   *
   * This is the difference between a model inferring which room a photo
   * belongs to and being told. Inference is where double-counted rooms come
   * from: four angles of one bathroom read as two bathrooms, and the estimate
   * doubles. Absent for unguided uploads, where guessing is all there is.
   */
  captions?: string[];
  /** What the customer asked us to look at. Context, never instruction. */
  focus?: string;
  serviceSlug: string;
}

/**
 * Swappable analysis backend. Implementations must never throw — return
 * observations or an empty list so the caller can fall back.
 */
export interface VisionAnalyzer {
  readonly name: PropertyAnalysis['source'];
  analyze(input: AnalyzerInput): Promise<{ rooms: RawRoomObservation[]; warnings: string[] }>;
}

export const EMPTY_SOIL: SoilScores = {
  dust: 0,
  grease: 0,
  stains: 0,
  clutter: 0,
  hair: 0,
  trash: 0,
  mold: 0,
};
