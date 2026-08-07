import type {
  AccessObservation,
  BuildingProfile,
  ElevatorState,
  EntryType,
  HandoffType,
  ParkingDifficulty,
  TravelMode,
} from './types';
import { clamp, confidenceFromSamples, mean, percentile, shrink } from './stats';

/**
 * The building model — the part of delivery cost that distance never sees.
 *
 * Two drops 0.7 miles from the same laundromat are not the same job. One is a
 * lobby desk on a street-level entrance; the other is a 6th floor walk-up with
 * a buzzer nobody answers. That difference is minutes of unpaid work, every
 * single time, forever — and it is invisible to any system that scores jobs by
 * distance.
 *
 * ⚠️ Every constant below is a HYPOTHESIS. They are honest starting estimates,
 * not measurements. `accessFactor()` is what makes them safe to ship: each
 * completed drop produces an observation, and the ratio of observed to modeled
 * time is blended back per building. A building the model gets wrong corrects
 * itself in ~10 deliveries without anyone editing this file.
 */

/** Seconds to get through the front door, by entry type. */
export const ENTRY_SECONDS: Record<EntryType, number> = {
  street: 12,
  gate_code: 35,
  locked_lobby: 42,
  buzzer: 50, // the customer has to answer, and often doesn't
  doorman: 55, // signing in is slower than letting yourself in
  unknown: 38,
};

/**
 * Stairs, carrying something. Loaded climbing is much slower than walking up
 * empty-handed, and it compounds: the fourth flight is not the first.
 */
export const STAIRS_UP_SECONDS = 38;
export const STAIRS_DOWN_SECONDS = 16;
/** Added seconds per flight beyond the second — fatigue, and it is real. */
export const STAIRS_FATIGUE_SECONDS = 6;
/** Each item beyond the first adds carry time per flight. Laundry bags are bulky. */
export const STAIRS_PER_EXTRA_ITEM_SECONDS = 5;

/**
 * Elevators: the wait is the cost, not the ride, and the wait grows with the
 * building. This is why a 20-floor tower is not automatically better than a
 * 5-floor walk-up — it depends entirely on the elevator, which is exactly what
 * the observations settle.
 */
export const ELEVATOR_BASE_WAIT_SECONDS = 32;
export const ELEVATOR_WAIT_PER_BUILDING_FLOOR = 1.6;
export const ELEVATOR_RIDE_SECONDS_PER_FLOOR = 3.5;

/** Lobby and corridor walking. Bigger buildings mean longer hallways. */
export const WALK_BASE_SECONDS = 22;
export const WALK_PER_BUILDING_FLOOR_SECONDS = 1.2;

export const HANDOFF_SECONDS: Record<HandoffType, number> = {
  leave_at_door: 18,
  meet_outside: 32,
  hand_to_customer: 45,
  id_check: 75,
};

/** Seconds to park and get to the door, before any building is involved. */
export const PARKING_SECONDS: Record<ParkingDifficulty, number> = {
  easy: 25,
  moderate: 60,
  hard: 135,
  unknown: 62,
};

/** A bike parks where a car circles the block. This gap decides fleet mix. */
export const PARKING_MODE_FACTOR: Record<TravelMode, number> = {
  walk: 0,
  bike: 0.3,
  ebike: 0.35,
  scooter: 0.5,
  car: 1,
};

export function parkingMinutes(difficulty: ParkingDifficulty, mode: TravelMode): number {
  return (PARKING_SECONDS[difficulty] * PARKING_MODE_FACTOR[mode]) / 60;
}

// ── The access model ─────────────────────────────────────────────────────────

export interface AccessBreakdown {
  /** Seconds through the front door. */
  entry: number;
  /** Seconds of elevator or stairs, round trip — you have to come back down. */
  vertical: number;
  /** Seconds walking inside. */
  walk: number;
  /** Seconds of handoff. */
  handoff: number;
}

export interface AccessEstimate {
  /** Arrive at the address → back at the vehicle, in minutes. */
  minutes: number;
  breakdown: AccessBreakdown;
  /** 0–100, higher is easier. Building-level, handoff excluded. */
  score: number;
  /** What the estimate is built on. */
  basis: 'prior' | 'blended' | 'observed';
  samples: number;
  confidence: number;
  /** Learned multiplier applied to the modeled time (1 = model was right). */
  factor: number;
  /** Measured access times for this building, in minutes. */
  p50: number | null;
  p90: number | null;
  unknowns: string[];
}

export interface AccessInput {
  building: BuildingProfile | null;
  /** The delivery's floor. 1 = ground. */
  floor: number | null;
  handoff: HandoffType;
  /** Bags/boxes being carried. Only matters on stairs. */
  items?: number;
}

const UNKNOWN_FLOOR_ASSUMPTION = 2;
const UNKNOWN_BUILDING_FLOORS = 3;

/** Round-trip vertical seconds for one delivery. */
function verticalSeconds(
  floor: number,
  buildingFloors: number,
  elevator: ElevatorState,
  items: number,
): number {
  const flights = Math.max(0, floor - 1);
  if (flights === 0) return 0;

  // Unknown elevator: assume by building height. Tall buildings almost always
  // have one; a 3-story walk-up usually doesn't. Wrong sometimes — which is
  // why `unknowns` reports it and the first observation resolves it.
  const hasElevator = elevator === 'yes' || (elevator === 'unknown' && buildingFloors >= 5);

  if (hasElevator) {
    const wait = ELEVATOR_BASE_WAIT_SECONDS + buildingFloors * ELEVATOR_WAIT_PER_BUILDING_FLOOR;
    const ride = flights * ELEVATOR_RIDE_SECONDS_PER_FLOOR;
    return (wait + ride) * 2; // up and back down
  }

  let up = 0;
  for (let i = 1; i <= flights; i++) {
    up += STAIRS_UP_SECONDS + Math.max(0, i - 2) * STAIRS_FATIGUE_SECONDS;
    up += Math.max(0, items - 1) * STAIRS_PER_EXTRA_ITEM_SECONDS;
  }
  return up + flights * STAIRS_DOWN_SECONDS;
}

/**
 * The learned correction for a building: observed ÷ modeled, blended toward 1.
 *
 * Normalising to a *ratio* rather than averaging raw seconds is what makes
 * observations from different floors comparable — a 2nd-floor drop and a
 * 9th-floor drop in the same tower both tell you whether the model runs fast
 * or slow for that address.
 */
export function accessFactor(building: BuildingProfile, observations: AccessObservation[]): number {
  const ratios = observations
    .map((o) => {
      const modeled = modeledAccessSeconds(building, o.floor);
      return modeled > 0 ? o.seconds / modeled : null;
    })
    .filter((r): r is number => r !== null && Number.isFinite(r) && r > 0.2 && r < 5);

  return shrink(1, ratios, 4);
}

/** Modeled access seconds excluding handoff — the comparable quantity. */
function modeledAccessSeconds(building: BuildingProfile | null, floor: number | null): number {
  const buildingFloors = building?.floors ?? UNKNOWN_BUILDING_FLOORS;
  const unit = floor ?? Math.min(UNKNOWN_FLOOR_ASSUMPTION, buildingFloors);
  const entry = ENTRY_SECONDS[building?.entry ?? 'unknown'];
  const vertical = verticalSeconds(unit, buildingFloors, building?.elevator ?? 'unknown', 1);
  const walk = WALK_BASE_SECONDS + buildingFloors * WALK_PER_BUILDING_FLOOR_SECONDS;
  return entry + vertical + walk;
}

export function estimateAccess(input: AccessInput, observations: AccessObservation[] = []): AccessEstimate {
  const { building, floor, handoff } = input;
  const items = Math.max(1, input.items ?? 1);
  const unknowns: string[] = [];

  const buildingFloors = building?.floors ?? UNKNOWN_BUILDING_FLOORS;
  if (!building) unknowns.push('building not identified');
  else if (building.floors === null) unknowns.push('floor count unknown');

  const unit = floor ?? Math.min(UNKNOWN_FLOOR_ASSUMPTION, buildingFloors);
  if (floor === null) unknowns.push('delivery floor unknown');

  const elevator = building?.elevator ?? 'unknown';
  if (elevator === 'unknown' && unit > 1) unknowns.push('elevator unknown');

  const entry = ENTRY_SECONDS[building?.entry ?? 'unknown'];
  if (!building || building.entry === 'unknown') unknowns.push('entry type unknown');

  const vertical = verticalSeconds(unit, buildingFloors, elevator, items);
  const walk = WALK_BASE_SECONDS + buildingFloors * WALK_PER_BUILDING_FLOOR_SECONDS;

  const factor = building ? accessFactor(building, observations) : 1;
  const breakdown: AccessBreakdown = {
    entry: entry * factor,
    vertical: vertical * factor,
    walk: walk * factor,
    handoff: HANDOFF_SECONDS[handoff],
  };

  const totalSeconds = breakdown.entry + breakdown.vertical + breakdown.walk + breakdown.handoff;
  const measured = observations.map((o) => o.seconds / 60);
  const samples = observations.length;

  return {
    minutes: totalSeconds / 60,
    breakdown,
    score: accessScoreFromSeconds(breakdown.entry + breakdown.vertical + breakdown.walk),
    basis: samples === 0 ? 'prior' : samples >= 12 ? 'observed' : 'blended',
    samples,
    confidence: confidenceFromSamples(samples, 4),
    factor,
    p50: samples ? percentile(measured, 0.5) : null,
    p90: samples ? percentile(measured, 0.9) : null,
    unknowns,
  };
}

/**
 * Access score, 0–100, higher is easier.
 *
 * A pure restatement of expected access seconds on a scale a dispatcher can
 * read at a glance: ~1.5 min is a 100, 4 min is ~55, 9 min is ~17.
 */
export function accessScoreFromSeconds(seconds: number): number {
  const minutes = seconds / 60;
  const score = 100 * Math.exp(-0.24 * Math.max(0, minutes - 1.5));
  return Math.round(clamp(score, 0, 100));
}

/**
 * The building's own score, independent of which apartment ordered: the
 * expected access cost averaged over every floor in it. This is the number
 * that belongs on a building record.
 */
export function buildingAccessScore(building: BuildingProfile, observations: AccessObservation[] = []): number {
  const floors = building.floors ?? UNKNOWN_BUILDING_FLOORS;
  const factor = accessFactor(building, observations);
  const perFloor: number[] = [];
  for (let f = 1; f <= floors; f++) {
    perFloor.push(modeledAccessSeconds(building, f) * factor);
  }
  return accessScoreFromSeconds(mean(perFloor));
}

// ── Learning what nobody told us ─────────────────────────────────────────────

export interface ElevatorInference {
  elevator: ElevatorState;
  confidence: number;
  /** Observations that could discriminate (i.e. above the ground floor). */
  usable: number;
  reason: string;
}

/**
 * Resolves `elevator: unknown` from timing alone.
 *
 * A courier who reports it directly is best, but most won't. Failing that: a
 * 6th-floor drop that took 90 seconds did not use the stairs. Comparing each
 * observation against both models and counting which fits better recovers the
 * answer from data the operation already collects.
 */
export function inferElevator(
  building: BuildingProfile,
  observations: AccessObservation[],
): ElevatorInference {
  const reported = observations.filter((o) => o.usedElevator !== null);
  if (reported.length >= 2) {
    const yes = reported.filter((o) => o.usedElevator).length;
    const ratio = yes / reported.length;
    if (ratio >= 0.7) return { elevator: 'yes', confidence: confidenceFromSamples(reported.length, 2), usable: reported.length, reason: 'couriers reported using it' };
    if (ratio <= 0.3) return { elevator: 'no', confidence: confidenceFromSamples(reported.length, 2), usable: reported.length, reason: 'couriers reported stairs' };
  }

  const floors = building.floors ?? UNKNOWN_BUILDING_FLOORS;
  const fixed = ENTRY_SECONDS[building.entry] + WALK_BASE_SECONDS + floors * WALK_PER_BUILDING_FLOOR_SECONDS;

  // Only drops above the 2nd floor separate the two models meaningfully.
  const usable = observations.filter((o) => (o.floor ?? 0) >= 3);
  if (usable.length < 3) {
    return { elevator: building.elevator, confidence: 0, usable: usable.length, reason: 'not enough high-floor deliveries yet' };
  }

  let elevatorFit = 0;
  let stairsFit = 0;
  for (const o of usable) {
    const withElevator = fixed + verticalSeconds(o.floor!, floors, 'yes', 1);
    const withStairs = fixed + verticalSeconds(o.floor!, floors, 'no', 1);
    if (Math.abs(o.seconds - withElevator) <= Math.abs(o.seconds - withStairs)) elevatorFit++;
    else stairsFit++;
  }

  const total = elevatorFit + stairsFit;
  const winner = elevatorFit > stairsFit ? 'yes' : 'no';
  const agreement = Math.max(elevatorFit, stairsFit) / total;
  return {
    elevator: agreement >= 0.7 ? (winner as ElevatorState) : building.elevator,
    confidence: agreement >= 0.7 ? agreement * confidenceFromSamples(total, 3) : 0,
    usable: total,
    reason:
      agreement >= 0.7
        ? `${Math.max(elevatorFit, stairsFit)}/${total} high-floor drops match the ${winner === 'yes' ? 'elevator' : 'stairs'} model`
        : 'timings are inconclusive',
  };
}
