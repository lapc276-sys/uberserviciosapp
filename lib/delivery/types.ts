/**
 * Domain model for the delivery optimization engine.
 *
 * The premise: a delivery is not a line on a map. It is a sequence of
 * *components* — travel, waiting on the merchant, parking, walking into a
 * building, waiting for an elevator, the handoff — and most of the cost lives
 * in the components a distance calculation never sees. A 0.7-mile drop to a
 * 6th floor walk-up with a 20-minute prep wait is a worse job than a 2-mile
 * drop to a lobby desk, and only a model that decomposes the work can say so.
 *
 * Everything here is vertical-agnostic. `merchant` is a laundromat today and a
 * restaurant, pharmacy or grocer tomorrow — the time model does not care.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** How the courier moves. Speed, parking cost and stair tolerance all differ. */
export const TRAVEL_MODES = ['walk', 'bike', 'ebike', 'scooter', 'car'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/**
 * Elevator presence is `unknown` until the operation learns it. That is the
 * point: the engine must be useful on day one with no building data, and get
 * sharper every time a courier completes a drop.
 */
export type ElevatorState = 'yes' | 'no' | 'unknown';

export const ENTRY_TYPES = ['street', 'buzzer', 'locked_lobby', 'gate_code', 'doorman', 'unknown'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const PARKING_DIFFICULTY = ['easy', 'moderate', 'hard', 'unknown'] as const;
export type ParkingDifficulty = (typeof PARKING_DIFFICULTY)[number];

export const HANDOFF_TYPES = ['leave_at_door', 'meet_outside', 'hand_to_customer', 'id_check'] as const;
export type HandoffType = (typeof HANDOFF_TYPES)[number];

export const HANDOFF_LABELS: Record<HandoffType, string> = {
  leave_at_door: 'Leave at door',
  meet_outside: 'Meet outside',
  hand_to_customer: 'Hand to customer',
  id_check: 'ID check',
};

/**
 * A physical building the operation delivers into.
 *
 * Structure (floors, elevator, entry) gives the prior. `accessFactor` is what
 * the operation *learned*: the ratio between what actually happened and what
 * the model predicted, so a building that is quietly awful gets more time
 * budgeted without anyone editing a constant.
 */
export interface BuildingProfile {
  id: string;
  label: string;
  location: LatLng;
  /** Floors in the building (not the delivery's floor). Null when unknown. */
  floors: number | null;
  elevator: ElevatorState;
  entry: EntryType;
  parking: ParkingDifficulty;
  notes?: string | null;
}

/**
 * One measured trip from "arrived at the address" to "back at the vehicle".
 *
 * This is the ground truth for building access, and it is a byproduct of doing
 * the job — the courier's app already knows when they arrived and when they
 * started moving again.
 */
export interface AccessObservation {
  buildingId: string;
  /** Which floor this drop went to. Access cost is floor-dependent. */
  floor: number | null;
  /** Arrive-at-address → back-at-vehicle, in seconds. */
  seconds: number;
  /** Reported by the courier when known; used to resolve `elevator: unknown`. */
  usedElevator: boolean | null;
  at: string; // ISO timestamp
}

/** A merchant: laundromat, restaurant, pharmacy — anywhere an order is picked up. */
export interface MerchantProfile {
  id: string;
  name: string;
  vertical: string; // 'laundry' | 'restaurant' | ...
  location: LatLng;
  parking: ParkingDifficulty;
  /**
   * What the merchant *claims* prep takes. A starting prior only — merchants
   * are optimistic, and the model replaces this with measured reality.
   */
  quotedPrepMinutes: number;
  /** Counter time (in the door → order in hand → out) when nothing is learned. */
  quotedCounterMinutes?: number;
  /**
   * The laundromat's own price per pound. Theirs to set, and they keep all of
   * it — we only add the delivery surcharge on top. See lib/delivery/pricing.
   */
  ratePerPound?: number;
  /** Stripe Connect account the service revenue is transferred to. */
  stripeAccountId?: string | null;
}

/** Measured prep: order placed → order actually ready. */
export interface PrepObservation {
  merchantId: string;
  /** 0 = Sunday. Bucketed because Friday 8pm is a different restaurant. */
  weekday: number;
  hour: number;
  minutes: number;
  at: string;
}

/** Measured counter time: courier walks in → walks out with the order. */
export interface CounterObservation {
  merchantId: string;
  seconds: number;
  at: string;
}

/** Where the order is going. */
export interface Dropoff {
  location: LatLng;
  buildingId?: string | null;
  /** 1 = ground floor. Null when the customer never told us. */
  floor: number | null;
  handoff: HandoffType;
  /** Street parking difficulty at the drop, if known separately from the building. */
  parking?: ParkingDifficulty;
}

/**
 * A job as the engine sees it: what it pays, where it comes from, where it goes.
 * Deliberately separate from the persisted order record so the engine can be
 * run on hypotheticals (simulation, batching what-ifs) with no database.
 */
export interface DeliveryJob {
  ref: string;
  merchantId: string;
  dropoff: Dropoff;
  /** Courier pay for this job in dollars, excluding tip. */
  payout: number;
  /** Expected tip in dollars. Kept separate — it is not guaranteed money. */
  tip?: number;
  placedAt: string; // ISO
  /** Merchant's promise, when they give one. The model still predicts its own. */
  promisedReadyAt?: string | null;
  /** Bags, boxes, items — drives carry time on stairs. */
  items?: number;
}

/** A courier and what they are doing right now. */
export interface CourierState {
  id: string;
  name: string;
  mode: TravelMode;
  /** Where they are now. */
  location: LatLng;
  /**
   * Minutes until they finish current work. 0 = free now. This is what makes
   * dispatch able to hand out the next job *before* the current one ends —
   * the whole point of shrinking the idle gap.
   */
  freeInMinutes: number;
  /** Where they will be when free. Defaults to `location`. */
  freeAt?: LatLng;
  /**
   * Personal pace multiplier: 0.9 means this courier consistently beats the
   * model by 10%. Learned from their own completed jobs.
   */
  paceFactor: number;
  /** Jobs currently in hand. Used to cap batching. */
  activeJobs: number;
  phone?: string | null;
}

/** The components a delivery decomposes into. Order matters — it is the timeline. */
export const TIME_COMPONENTS = [
  'to_merchant',
  'prep_wait',
  'merchant_park',
  'merchant_counter',
  'line_haul',
  'dropoff_park',
  'building_entry',
  'vertical',
  'walk',
  'handoff',
] as const;

export type TimeComponent = (typeof TIME_COMPONENTS)[number];

export const COMPONENT_LABELS: Record<TimeComponent, string> = {
  to_merchant: 'Travel to merchant',
  prep_wait: 'Waiting on prep',
  merchant_park: 'Parking at merchant',
  merchant_counter: 'Inside the merchant',
  line_haul: 'Travel to customer',
  dropoff_park: 'Parking at drop',
  building_entry: 'Building entry',
  vertical: 'Elevator / stairs',
  walk: 'Walking inside',
  handoff: 'Handoff',
};

export type ComponentMinutes = Record<TimeComponent, number>;

/** A full estimate for one job, with every number it is built from exposed. */
export interface JobEstimate {
  ref: string;
  components: ComponentMinutes;
  /** Everything, including time spent standing still waiting on the merchant. */
  totalMinutes: number;
  /**
   * Total minus prep wait. The difference between the two is the number that
   * tells you whether a job is expensive or merely long.
   */
  workingMinutes: number;
  /** Courier pay ÷ total minutes — the only productivity number that matters. */
  dollarsPerMinute: number;
  /** 0–1. How much of this estimate is measured vs. assumed. */
  confidence: number;
  /** Plain-language list of what the engine still does not know. */
  unknowns: string[];
  /** When the courier is predicted to hand the order over. */
  deliverAtMinutes: number;
}
