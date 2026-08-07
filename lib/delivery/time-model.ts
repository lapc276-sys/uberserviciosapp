import type {
  AccessObservation,
  BuildingProfile,
  ComponentMinutes,
  CounterObservation,
  CourierState,
  DeliveryJob,
  JobEstimate,
  MerchantProfile,
  PrepObservation,
} from './types';
import { estimateTravelMinutes } from './geo';
import { estimateAccess, parkingMinutes } from './buildings';
import { predictCounterMinutes, readyInMinutes } from './merchants';
import { clamp, round1 } from './stats';

/**
 * The time model — the engine's core.
 *
 * It answers a different question than a maps API. Not "how long is the trip?"
 * but "how long is the whole job?", decomposed into the ten components a
 * courier actually spends their day on:
 *
 *   travel to merchant → prep wait → park → counter → line haul → park
 *   → building entry → elevator/stairs → walk → handoff
 *
 * Once the job is decomposed, three things become possible that are not
 * possible otherwise: pay can be tied to real work instead of distance,
 * batching becomes arithmetic instead of a rule of thumb, and dispatch can
 * compare jobs by dollars-per-minute rather than by proximity.
 *
 * ⚠️ Like the cleaning time model in lib/vision/model.ts, the constants that
 * feed this are hypotheses until observations correct them. Every completed
 * delivery writes back prep, counter and access times; `lib/delivery/metrics`
 * reports where the model is wrong.
 */

/** Everything the engine needs to know about a job's context. */
export interface JobContext {
  merchant: MerchantProfile;
  building: BuildingProfile | null;
  prepObservations: PrepObservation[];
  counterObservations: CounterObservation[];
  accessObservations: AccessObservation[];
}

export interface EstimateOptions {
  now?: Date;
  /** Extra orders collected on the same merchant visit (batching). */
  extraOrdersAtMerchant?: number;
  /**
   * Readiness (minutes from now) of the other orders being collected on this
   * same visit. A batch cannot leave until the slowest of them is ready, and
   * pretending otherwise is how batching quietly destroys an hour.
   */
  alsoWaitForMinutes?: number[];
  /**
   * Set when this drop follows another drop rather than the merchant — the
   * line haul is then measured from the previous customer.
   */
  originOverride?: { lat: number; lng: number };
  /** Skip merchant legs entirely (second drop of a batch). */
  skipMerchantLegs?: boolean;
}

const EMPTY_COMPONENTS: ComponentMinutes = {
  to_merchant: 0,
  prep_wait: 0,
  merchant_park: 0,
  merchant_counter: 0,
  line_haul: 0,
  dropoff_park: 0,
  building_entry: 0,
  vertical: 0,
  walk: 0,
  handoff: 0,
};

export function estimateJob(
  job: DeliveryJob,
  courier: CourierState,
  ctx: JobContext,
  opts: EstimateOptions = {},
): JobEstimate {
  const now = opts.now ?? new Date();
  const hour = now.getHours();
  const pace = courier.paceFactor || 1;
  const origin = opts.originOverride ?? courier.freeAt ?? courier.location;
  const components: ComponentMinutes = { ...EMPTY_COMPONENTS };
  const unknowns: string[] = [];

  // ── Getting to the pickup ──────────────────────────────────────────────────
  if (!opts.skipMerchantLegs) {
    components.to_merchant = estimateTravelMinutes(origin, ctx.merchant.location, courier.mode, {
      hour,
      paceFactor: pace,
    });
    components.merchant_park = parkingMinutes(ctx.merchant.parking, courier.mode) * pace;

    // ── Waiting on the merchant ──────────────────────────────────────────────
    // The courier only waits for whatever is left when they walk in, which is
    // exactly why dispatching *later* can be worth more than dispatching the
    // closest courier now.
    const ready = readyInMinutes(ctx.merchant, job, ctx.prepObservations, now);
    const arriveAt = courier.freeInMinutes + components.to_merchant + components.merchant_park;
    const readyForAll = Math.max(ready.minutes, ...(opts.alsoWaitForMinutes ?? []));
    components.prep_wait = Math.max(0, readyForAll - arriveAt);
    if (ready.prediction.basis === 'quoted') unknowns.push('prep time unmeasured (using merchant’s own estimate)');

    const counter = predictCounterMinutes(ctx.merchant, ctx.counterObservations);
    components.merchant_counter =
      (counter.minutes + (opts.extraOrdersAtMerchant ?? 0) * COUNTER_EXTRA_ORDER_MINUTES) * pace;
    if (counter.samples === 0) unknowns.push('counter time unmeasured');
  }

  // ── The ride out ───────────────────────────────────────────────────────────
  const lineHaulOrigin = opts.skipMerchantLegs ? origin : ctx.merchant.location;
  components.line_haul = estimateTravelMinutes(lineHaulOrigin, job.dropoff.location, courier.mode, {
    hour,
    paceFactor: pace,
  });

  // ── The part distance never sees ───────────────────────────────────────────
  const dropParking = job.dropoff.parking ?? ctx.building?.parking ?? 'unknown';
  components.dropoff_park = parkingMinutes(dropParking, courier.mode) * pace;

  const access = estimateAccess(
    { building: ctx.building, floor: job.dropoff.floor, handoff: job.dropoff.handoff, items: job.items },
    ctx.accessObservations,
  );
  components.building_entry = (access.breakdown.entry / 60) * pace;
  components.vertical = (access.breakdown.vertical / 60) * pace;
  components.walk = (access.breakdown.walk / 60) * pace;
  components.handoff = (access.breakdown.handoff / 60) * pace;
  unknowns.push(...access.unknowns);

  const totalMinutes = Object.values(components).reduce((s, m) => s + m, 0);
  const workingMinutes = totalMinutes - components.prep_wait;
  const money = job.payout + (job.tip ?? 0);

  return {
    ref: job.ref,
    components: roundComponents(components),
    totalMinutes: round1(totalMinutes),
    workingMinutes: round1(workingMinutes),
    dollarsPerMinute: totalMinutes > 0 ? Math.round((money / totalMinutes) * 100) / 100 : 0,
    confidence: round2(confidenceOf(components, ctx, access.confidence)),
    unknowns: [...new Set(unknowns)],
    deliverAtMinutes: round1(courier.freeInMinutes + totalMinutes),
  };
}

/** Each additional order picked up on the same visit. */
export const COUNTER_EXTRA_ORDER_MINUTES = 0.8;

/**
 * The reverse leg: collect from the customer, deliver to the merchant.
 *
 * Laundry runs both ways — someone has to go get the bags before anyone washes
 * them — and the outbound leg is the expensive one, because the building access
 * cost lands on the pickup instead of the drop. Same ten components, roles
 * swapped: no prep wait (nothing is being prepared), and the counter time is
 * spent handing the bags over rather than collecting them.
 *
 * Modeling this as its own function rather than a flag keeps the component
 * vocabulary identical, so complexity scores, pay and calibration all work on
 * pickups without a single special case downstream.
 */
export function estimatePickupLeg(
  job: DeliveryJob,
  courier: CourierState,
  ctx: JobContext,
  opts: EstimateOptions = {},
): JobEstimate {
  const now = opts.now ?? new Date();
  const hour = now.getHours();
  const pace = courier.paceFactor || 1;
  const origin = opts.originOverride ?? courier.freeAt ?? courier.location;
  const components: ComponentMinutes = { ...EMPTY_COMPONENTS };
  const unknowns: string[] = [];

  // Out to the customer, and into their building.
  components.to_merchant = estimateTravelMinutes(origin, job.dropoff.location, courier.mode, {
    hour,
    paceFactor: pace,
  });
  const customerParking = job.dropoff.parking ?? ctx.building?.parking ?? 'unknown';
  components.merchant_park = parkingMinutes(customerParking, courier.mode) * pace;

  const access = estimateAccess(
    { building: ctx.building, floor: job.dropoff.floor, handoff: job.dropoff.handoff, items: job.items },
    ctx.accessObservations,
  );
  components.building_entry = (access.breakdown.entry / 60) * pace;
  components.vertical = (access.breakdown.vertical / 60) * pace;
  components.walk = (access.breakdown.walk / 60) * pace;
  components.handoff = (access.breakdown.handoff / 60) * pace;
  unknowns.push(...access.unknowns);

  // Back to the merchant, and in through the counter.
  components.line_haul = estimateTravelMinutes(job.dropoff.location, ctx.merchant.location, courier.mode, {
    hour,
    paceFactor: pace,
  });
  components.dropoff_park = parkingMinutes(ctx.merchant.parking, courier.mode) * pace;

  const counter = predictCounterMinutes(ctx.merchant, ctx.counterObservations);
  components.merchant_counter =
    (counter.minutes + (opts.extraOrdersAtMerchant ?? 0) * COUNTER_EXTRA_ORDER_MINUTES) * pace;
  if (counter.samples === 0) unknowns.push('counter time unmeasured');

  const totalMinutes = Object.values(components).reduce((s, m) => s + m, 0);
  const money = job.payout + (job.tip ?? 0);

  return {
    ref: job.ref,
    components: roundComponents(components),
    totalMinutes: round1(totalMinutes),
    workingMinutes: round1(totalMinutes),
    dollarsPerMinute: totalMinutes > 0 ? Math.round((money / totalMinutes) * 100) / 100 : 0,
    confidence: round2(confidenceOf(components, ctx, access.confidence)),
    unknowns: [...new Set(unknowns)],
    deliverAtMinutes: round1(courier.freeInMinutes + totalMinutes),
  };
}

/**
 * Confidence is time-weighted: being unsure about a 30-second walk barely
 * matters; being unsure about a 20-minute prep wait matters enormously.
 */
function confidenceOf(components: ComponentMinutes, ctx: JobContext, accessConfidence: number): number {
  const total = Object.values(components).reduce((s, m) => s + m, 0) || 1;

  // Travel is the best-understood component even without local data.
  const travelShare = (components.to_merchant + components.line_haul) / total;
  const prepShare = (components.prep_wait + components.merchant_counter) / total;
  const accessShare = (components.building_entry + components.vertical + components.walk + components.handoff) / total;
  const parkShare = (components.merchant_park + components.dropoff_park) / total;

  const prepSamples = ctx.prepObservations.filter((o) => o.merchantId === ctx.merchant.id).length;
  const prepConfidence = prepSamples / (prepSamples + 8);

  return clamp(travelShare * 0.8 + prepShare * prepConfidence + accessShare * accessConfidence + parkShare * 0.5, 0, 1);
}

function roundComponents(c: ComponentMinutes): ComponentMinutes {
  const out = { ...c };
  for (const key of Object.keys(out) as (keyof ComponentMinutes)[]) out[key] = round1(out[key]);
  return out;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** A readable timeline for the courier app and the admin view. */
export interface TimelineStep {
  label: string;
  minutes: number;
  /** Minutes from now when this step ends. */
  atMinutes: number;
}

export function timeline(estimate: JobEstimate, startsInMinutes = 0): TimelineStep[] {
  const steps: TimelineStep[] = [];
  let cursor = startsInMinutes;
  const labels: Record<keyof ComponentMinutes, string> = {
    to_merchant: 'Ride to merchant',
    prep_wait: 'Wait for the order',
    merchant_park: 'Park',
    merchant_counter: 'Pick up inside',
    line_haul: 'Ride to customer',
    dropoff_park: 'Park at the drop',
    building_entry: 'Get into the building',
    vertical: 'Elevator / stairs',
    walk: 'Walk to the door',
    handoff: 'Hand it over',
  };
  for (const key of Object.keys(labels) as (keyof ComponentMinutes)[]) {
    const minutes = estimate.components[key];
    if (minutes <= 0) continue;
    cursor += minutes;
    steps.push({ label: labels[key], minutes, atMinutes: round1(cursor) });
  }
  return steps;
}
