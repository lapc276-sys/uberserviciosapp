import type { CourierState, DeliveryJob, JobEstimate } from './types';
import { estimateJob, type JobContext } from './time-model';
import { readyInMinutes, merchantReliability } from './merchants';
import { directionAlignment, routeMiles } from './geo';
import { round1 } from './stats';

/**
 * Batching — the double order — decided by arithmetic instead of policy.
 *
 * Banning doubles throws away the single largest efficiency gain in delivery:
 * two orders leaving the same counter, going the same way, share a pickup that
 * costs the same whether you carry one bag or two. Allowing them blindly is
 * worse: a second order in the opposite direction turns two good jobs into two
 * late ones and an angry courier.
 *
 * So the rule is neither. Simulate both routes, price them in minutes, and
 * accept only when the batch wins on all three parties at once:
 *
 *   1. the courier earns more per minute than doing the best job alone,
 *   2. the second customer waits no more than a stated maximum,
 *   3. the platform actually saves meaningful time.
 *
 * Every rejection comes back with the number that caused it, so the rule can be
 * argued with — by an operator, or by the courier who just got skipped.
 */

export interface BatchGuards {
  /** How much later the second customer may be served vs. a solo delivery. */
  maxAddedWaitMinutes: number;
  /** Minimum time the batch must save over doing both jobs one after the other. */
  minMinutesSaved: number;
  /** Batch $/min must be at least this multiple of the best solo $/min. */
  minEfficiencyRatio: number;
  /** Angle between the two drops as seen from the merchant. */
  maxDirectionSpreadDegrees: number;
  /** Direction only matters once the drops are genuinely apart. */
  directionFreeRadiusMiles: number;
  /** Orders must become ready within this window of each other. */
  maxReadySpreadMinutes: number;
  /** Don't batch at a merchant that can't hold a schedule. */
  minMerchantReliability: number;
  /** Hard cap on orders in hand. */
  maxActiveJobs: number;
  /** Cross-merchant batching is off until same-merchant batching is proven. */
  allowCrossMerchant: boolean;
}

export const DEFAULT_GUARDS: BatchGuards = {
  maxAddedWaitMinutes: 10,
  minMinutesSaved: 4,
  minEfficiencyRatio: 1.0,
  maxDirectionSpreadDegrees: 75,
  directionFreeRadiusMiles: 0.5,
  maxReadySpreadMinutes: 8,
  minMerchantReliability: 40,
  maxActiveJobs: 2,
  allowCrossMerchant: false,
};

export interface BatchLeg {
  ref: string;
  estimate: JobEstimate;
  /** Minutes from now until this customer has their order. */
  deliverAtMinutes: number;
  /** Minutes later than if this customer had been served alone, right now. */
  addedWaitMinutes: number;
}

export interface BatchRoute {
  order: [string, string];
  legs: [BatchLeg, BatchLeg];
  totalMinutes: number;
  dollarsPerMinute: number;
}

export interface BatchDecision {
  batch: boolean;
  /** The better of the two orderings, whether or not it was accepted. */
  route: BatchRoute | null;
  /** Doing them one after the other, returning to the merchant in between. */
  sequentialMinutes: number;
  minutesSaved: number;
  /** Best single job on its own — the bar the batch has to clear. */
  soloDollarsPerMinute: number;
  efficiencyRatio: number;
  /** Every check, passed or failed, with the number behind it. */
  checks: { key: string; label: string; passed: boolean; detail: string }[];
  reason: string;
}

export interface BatchCandidate {
  job: DeliveryJob;
  ctx: JobContext;
}

export function evaluateBatch(
  a: BatchCandidate,
  b: BatchCandidate,
  courier: CourierState,
  opts: { now?: Date; guards?: Partial<BatchGuards> } = {},
): BatchDecision {
  const guards = { ...DEFAULT_GUARDS, ...opts.guards };
  const now = opts.now ?? new Date();
  const checks: BatchDecision['checks'] = [];

  const sameMerchant = a.job.merchantId === b.job.merchantId;
  checks.push({
    key: 'same_merchant',
    label: 'Same pickup',
    passed: sameMerchant || guards.allowCrossMerchant,
    detail: sameMerchant ? a.ctx.merchant.name : `${a.ctx.merchant.name} vs ${b.ctx.merchant.name}`,
  });

  // ── Solo baselines: what each job is worth on its own ──────────────────────
  const soloA = estimateJob(a.job, courier, a.ctx, { now });
  const soloB = estimateJob(b.job, courier, b.ctx, { now });
  const soloDpm = Math.max(soloA.dollarsPerMinute, soloB.dollarsPerMinute);

  // Doing both back-to-back, riding back to the merchant in between.
  const bAfterA = estimateJob(b.job, courier, b.ctx, { now, originOverride: a.job.dropoff.location });
  const sequentialMinutes = round1(soloA.totalMinutes + bAfterA.totalMinutes);

  // ── Readiness: a batch waits for its slowest order ─────────────────────────
  const readyA = readyInMinutes(a.ctx.merchant, a.job, a.ctx.prepObservations, now).minutes;
  const readyB = readyInMinutes(b.ctx.merchant, b.job, b.ctx.prepObservations, now).minutes;
  const readySpread = Math.abs(readyA - readyB);
  checks.push({
    key: 'ready_together',
    label: 'Ready at the same time',
    passed: readySpread <= guards.maxReadySpreadMinutes,
    detail: `${round1(readySpread)} min apart (max ${guards.maxReadySpreadMinutes})`,
  });

  // ── Direction: the cheap test that kills most bad batches ──────────────────
  const separation = routeMiles(a.job.dropoff.location, b.job.dropoff.location);
  const spread = directionAlignment(a.ctx.merchant.location, a.job.dropoff.location, b.job.dropoff.location);
  const directionOk = separation <= guards.directionFreeRadiusMiles || spread <= guards.maxDirectionSpreadDegrees;
  checks.push({
    key: 'direction',
    label: 'Same direction',
    passed: directionOk,
    detail: `${Math.round(spread)}° apart, drops ${round1(separation)} mi from each other`,
  });

  const reliability = merchantReliability(a.job.merchantId, a.ctx.prepObservations);
  checks.push({
    key: 'reliability',
    label: 'Merchant keeps its promises',
    passed: reliability >= guards.minMerchantReliability,
    detail: `reliability ${reliability}/100 (min ${guards.minMerchantReliability})`,
  });

  checks.push({
    key: 'capacity',
    label: 'Courier has room',
    passed: courier.activeJobs + 2 <= guards.maxActiveJobs + 1,
    detail: `${courier.activeJobs} in hand, cap ${guards.maxActiveJobs}`,
  });

  // ── Simulate both orderings and keep the better one ────────────────────────
  const routes = [simulateRoute(a, b, courier, now, soloA, soloB), simulateRoute(b, a, courier, now, soloB, soloA)];
  const route = routes.sort(
    (x, y) => x.totalMinutes - y.totalMinutes || maxAddedWait(x) - maxAddedWait(y),
  )[0];

  const minutesSaved = round1(sequentialMinutes - route.totalMinutes);
  const efficiencyRatio = soloDpm > 0 ? Math.round((route.dollarsPerMinute / soloDpm) * 100) / 100 : 0;
  const worstAddedWait = maxAddedWait(route);

  checks.push({
    key: 'second_customer',
    label: 'Second customer not punished',
    passed: worstAddedWait <= guards.maxAddedWaitMinutes,
    detail: `+${round1(worstAddedWait)} min vs. solo (max ${guards.maxAddedWaitMinutes})`,
  });
  checks.push({
    key: 'time_saved',
    label: 'Batch actually saves time',
    passed: minutesSaved >= guards.minMinutesSaved,
    detail: `${minutesSaved} min saved vs. ${sequentialMinutes} min sequential (min ${guards.minMinutesSaved})`,
  });
  checks.push({
    key: 'courier_earns_more',
    label: 'Courier earns more per minute',
    passed: efficiencyRatio >= guards.minEfficiencyRatio,
    detail: `$${route.dollarsPerMinute}/min batched vs $${soloDpm}/min solo (${efficiencyRatio}×)`,
  });

  const failed = checks.filter((c) => !c.passed);
  return {
    batch: failed.length === 0,
    route,
    sequentialMinutes,
    minutesSaved,
    soloDollarsPerMinute: soloDpm,
    efficiencyRatio,
    checks,
    reason:
      failed.length === 0
        ? `Batch: ${minutesSaved} min saved, courier at $${route.dollarsPerMinute}/min, second customer +${round1(worstAddedWait)} min`
        : failed.map((c) => `${c.label} — ${c.detail}`).join('; '),
  };
}

function maxAddedWait(route: BatchRoute): number {
  return Math.max(route.legs[0].addedWaitMinutes, route.legs[1].addedWaitMinutes);
}

/**
 * One ordering of a two-stop route: shared pickup, then drop, then drop.
 * The second leg starts from the first customer's door, not the merchant —
 * that shared line haul is where the savings live.
 */
function simulateRoute(
  first: BatchCandidate,
  second: BatchCandidate,
  courier: CourierState,
  now: Date,
  soloFirst: JobEstimate,
  soloSecond: JobEstimate,
): BatchRoute {
  const readySecond = readyInMinutes(second.ctx.merchant, second.job, second.ctx.prepObservations, now).minutes;

  const firstEst = estimateJob(first.job, courier, first.ctx, {
    now,
    extraOrdersAtMerchant: 1,
    alsoWaitForMinutes: [readySecond],
  });
  const secondEst = estimateJob(second.job, courier, second.ctx, {
    now,
    skipMerchantLegs: true,
    originOverride: first.job.dropoff.location,
  });

  const firstDeliverAt = round1(courier.freeInMinutes + firstEst.totalMinutes);
  const secondDeliverAt = round1(firstDeliverAt + secondEst.totalMinutes);
  const totalMinutes = round1(firstEst.totalMinutes + secondEst.totalMinutes);
  const money =
    first.job.payout + (first.job.tip ?? 0) + second.job.payout + (second.job.tip ?? 0);

  return {
    order: [first.job.ref, second.job.ref],
    legs: [
      {
        ref: first.job.ref,
        estimate: firstEst,
        deliverAtMinutes: firstDeliverAt,
        addedWaitMinutes: round1(firstDeliverAt - soloFirst.deliverAtMinutes),
      },
      {
        ref: second.job.ref,
        estimate: secondEst,
        deliverAtMinutes: secondDeliverAt,
        addedWaitMinutes: round1(secondDeliverAt - soloSecond.deliverAtMinutes),
      },
    ],
    totalMinutes,
    dollarsPerMinute: totalMinutes > 0 ? Math.round((money / totalMinutes) * 100) / 100 : 0,
  };
}

/**
 * Given one job in hand and a pool of open orders, find the best legal partner.
 * Returns null when nothing clears the guards — the common and correct answer.
 */
export function bestBatchPartner(
  held: BatchCandidate,
  pool: BatchCandidate[],
  courier: CourierState,
  opts: { now?: Date; guards?: Partial<BatchGuards> } = {},
): { partner: BatchCandidate; decision: BatchDecision } | null {
  const viable = pool
    .filter((c) => c.job.ref !== held.job.ref)
    .map((partner) => ({ partner, decision: evaluateBatch(held, partner, courier, opts) }))
    .filter((r) => r.decision.batch)
    .sort((x, y) => (y.decision.route?.dollarsPerMinute ?? 0) - (x.decision.route?.dollarsPerMinute ?? 0));

  return viable[0] ?? null;
}
