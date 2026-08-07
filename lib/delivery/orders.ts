import type { CourierState, DeliveryJob, JobEstimate } from './types';
import { estimateJob, estimatePickupLeg, type JobContext } from './time-model';
import { appraise, type JobAppraisal } from './complexity';
import { courierPayFor } from './pricing';
import { planDispatch, type DispatchPlan } from './dispatch';
import { buildingAccessScore, inferElevator } from './buildings';
import { merchantReliability, prepProfile } from './merchants';
import { calibrationReport, idleGapReport } from './metrics';
import {
  getBuilding,
  getMerchant,
  listAccessObservations,
  listBuildings,
  listCounterObservations,
  listCouriers,
  listMerchants,
  listOrders,
  listOutcomes,
  listPrepObservations,
  toCourierState,
  type CourierRecord,
  type DeliveryOrderRecord,
} from './store';

/**
 * The glue between stored orders and the pure engine.
 *
 * Everything in lib/delivery/* below this file is deliberately pure: give it a
 * job, a courier and a context and it returns numbers, with no database and no
 * clock of its own. That is what makes the engine testable, simulatable and
 * arguable. This file is the one place that reaches for real data.
 */

export async function contextForOrder(order: DeliveryOrderRecord): Promise<JobContext | null> {
  const merchant = await getMerchant(order.merchantId);
  if (!merchant) return null;

  const building = order.buildingId ? await getBuilding(order.buildingId) : null;
  const [prepObservations, counterObservations, accessObservations] = await Promise.all([
    listPrepObservations(merchant.id),
    listCounterObservations(merchant.id),
    order.buildingId ? listAccessObservations(order.buildingId) : Promise.resolve([]),
  ]);

  return { merchant, building, prepObservations, counterObservations, accessObservations };
}

/**
 * An order becomes a job the engine can price. Returns null without
 * coordinates — the engine will not pretend to estimate a trip to an address
 * it cannot place.
 */
export function orderToJob(order: DeliveryOrderRecord, payout = 0): DeliveryJob | null {
  if (order.lat == null || order.lng == null) return null;
  return {
    ref: order.ref,
    merchantId: order.merchantId,
    dropoff: {
      location: { lat: order.lat, lng: order.lng },
      buildingId: order.buildingId,
      floor: order.floor,
      handoff: order.handoff,
    },
    payout: payout || order.courierPay || 0,
    placedAt: order.placedAt,
    promisedReadyAt: order.promisedReadyAt,
    items: order.items,
  };
}

export type Leg = 'pickup' | 'return';

export interface PricedJob {
  job: DeliveryJob;
  estimate: JobEstimate;
  appraisal: JobAppraisal;
  /** What this job should pay, derived from the minutes it actually contains. */
  pay: number;
}

/**
 * Prices a job from its own time cost.
 *
 * Two passes, and the reason is worth stating: pay depends on minutes, and
 * dollars-per-minute depends on pay. So estimate the work first with no money
 * attached, derive the fee from those minutes, then re-estimate so every
 * downstream number ($/min, verdict, ranking) reflects what will actually be
 * paid. Circular only if you try to do it in one step.
 */
export function priceJob(
  job: DeliveryJob,
  courier: CourierState,
  ctx: JobContext,
  opts: { now?: Date; leg?: Leg } = {},
): PricedJob {
  const estimator = opts.leg === 'pickup' ? estimatePickupLeg : estimateJob;
  const unpriced = estimator({ ...job, payout: 0 }, courier, ctx, { now: opts.now });
  const pay = courierPayFor(unpriced);
  const priced = { ...job, payout: pay };
  const estimate = estimator(priced, courier, ctx, { now: opts.now });

  return { job: priced, estimate, appraisal: appraise(estimate, pay, job.tip ?? 0), pay };
}

export interface LiveCourier {
  id: string;
  freeInMinutes?: number;
  activeJobs?: number;
  location?: { lat: number; lng: number };
  freeAt?: { lat: number; lng: number };
}

/** Courier records + whatever the dispatcher knows about them right now. */
export async function courierStates(live: LiveCourier[] = []): Promise<CourierState[]> {
  const records: CourierRecord[] = await listCouriers();
  return records
    .filter((r) => r.location || live.some((l) => l.id === r.id && l.location))
    .map((record) => toCourierState(record, live.find((l) => l.id === record.id) ?? {}));
}

export interface OrderPlan {
  order: DeliveryOrderRecord;
  priced: PricedJob;
  plan: DispatchPlan;
}

export async function planForOrder(
  order: DeliveryOrderRecord,
  live: LiveCourier[] = [],
  opts: { now?: Date; leg?: Leg } = {},
): Promise<OrderPlan | null> {
  const ctx = await contextForOrder(order);
  const job = orderToJob(order);
  if (!ctx || !job) return null;

  const couriers = await courierStates(live);
  if (couriers.length === 0) return null;

  // Price against the median courier so the fee doesn't depend on who happens
  // to be nearby — a job's cost is a property of the job, not of the fleet.
  const priced = priceJob(job, couriers[0], ctx, opts);
  const plan = planDispatch(priced.job, couriers, ctx, { now: opts.now });

  return { order, priced, plan };
}

// ── The admin view ───────────────────────────────────────────────────────────

export interface BuildingInsight {
  id: string;
  label: string;
  floors: number | null;
  elevator: string;
  accessScore: number;
  samples: number;
  p50Minutes: number | null;
  p90Minutes: number | null;
  /** Set when timings disagree with what the record says. */
  inference: { elevator: string; confidence: number; reason: string } | null;
}

export interface MerchantInsight {
  id: string;
  name: string;
  reliability: number;
  prepSamples: number;
  busiestHour: { hour: number; minutes: number } | null;
  quotedPrepMinutes: number;
  measuredPrepMinutes: number | null;
}

export interface DeliveryOverview {
  orders: DeliveryOrderRecord[];
  buildings: BuildingInsight[];
  merchants: MerchantInsight[];
  idleGap: ReturnType<typeof idleGapReport>;
  calibration: ReturnType<typeof calibrationReport>;
}

export async function deliveryOverview(): Promise<DeliveryOverview> {
  const [orders, buildings, merchants, outcomes, accessObs, prepObs] = await Promise.all([
    listOrders({ limit: 50 }),
    listBuildings(),
    listMerchants(),
    listOutcomes(),
    listAccessObservations(),
    listPrepObservations(),
  ]);

  const buildingInsights: BuildingInsight[] = buildings.map((b) => {
    const mine = accessObs.filter((o) => o.buildingId === b.id);
    const sorted = mine.map((o) => o.seconds / 60).sort((x, y) => x - y);
    const inference = b.elevator === 'unknown' ? inferElevator(b, mine) : null;
    return {
      id: b.id,
      label: b.label,
      floors: b.floors,
      elevator: b.elevator,
      accessScore: buildingAccessScore(b, mine),
      samples: mine.length,
      p50Minutes: sorted.length ? round1(sorted[Math.floor((sorted.length - 1) * 0.5)]) : null,
      p90Minutes: sorted.length ? round1(sorted[Math.floor((sorted.length - 1) * 0.9)]) : null,
      inference:
        inference && inference.confidence > 0
          ? { elevator: inference.elevator, confidence: Math.round(inference.confidence * 100) / 100, reason: inference.reason }
          : null,
    };
  });

  const merchantInsights: MerchantInsight[] = merchants.map((m) => {
    const profile = prepProfile(m.id, prepObs);
    const mine = prepObs.filter((o) => o.merchantId === m.id);
    const busiest = [...profile].sort((a, b) => b.minutes - a.minutes)[0] ?? null;
    return {
      id: m.id,
      name: m.name,
      reliability: merchantReliability(m.id, prepObs),
      prepSamples: mine.length,
      busiestHour: busiest ? { hour: busiest.hour, minutes: busiest.minutes } : null,
      quotedPrepMinutes: m.quotedPrepMinutes,
      measuredPrepMinutes: mine.length ? round1(mine.reduce((s, o) => s + o.minutes, 0) / mine.length) : null,
    };
  });

  return {
    orders,
    buildings: buildingInsights,
    merchants: merchantInsights,
    idleGap: idleGapReport(outcomes),
    calibration: calibrationReport(outcomes),
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
