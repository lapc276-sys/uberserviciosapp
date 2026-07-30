import type { SupplyPlan } from './supplies';
import type { TaskLine } from './tasks';

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

export interface RoomAnalysis {
  type: RoomType;
  /** Human label, disambiguated when repeated ("Bedroom 2"). */
  label: string;
  confidence: number;
  objects: DetectedObject[];
  soil: SoilScores;
  condition: ConditionLevel;
  /** Minutes of cleaning work, computed by the estimator (not the model). */
  estimatedMinutes: number;
  /**
   * The chores this room actually needs, each with its own minutes.
   * This is what the pro sees as a checklist and what the pilot times
   * individually — a total that is wrong tells you nothing about why.
   */
  tasks: TaskLine[];
  notes?: string;
}

export interface PropertyAnalysis {
  rooms: RoomAnalysis[];
  /** The authoritative estimate, produced by whichever estimator is active. */
  totalMinutes: number;
  /**
   * What each estimator says, kept side by side.
   *
   * The room model is the one that has been quoting real jobs; the task model
   * is finer-grained but built entirely on desk estimates. Publishing both lets
   * `/admin/vision` show the gap between them as field data arrives, so the
   * switch is made on evidence instead of on faith in the newer code.
   */
  estimatorMinutes: { room: number; task: number };
  /** Which one produced `totalMinutes`. */
  estimator: 'room' | 'task';
  /** Crew size the job warrants, so a long job isn't a 9-hour solo shift. */
  recommendedPros: number;
  /** Product names only — the detailed plan lives in `supplyPlan`. */
  suppliesNeeded: string[];
  /** Quantities, costs, PPE and never-mix warnings. See lib/vision/supplies.ts. */
  supplyPlan?: SupplyPlan;
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
  soil: SoilScores;
  notes?: string;
}

export interface AnalyzerInput {
  /** Data URLs or https URLs of frames sampled from the walkthrough video. */
  frames: string[];
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
