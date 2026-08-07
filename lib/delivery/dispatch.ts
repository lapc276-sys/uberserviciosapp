import type { CourierState, DeliveryJob, JobEstimate } from './types';
import { estimateJob, type JobContext } from './time-model';
import { readyInMinutes } from './merchants';
import { TARGET_DOLLARS_PER_MINUTE, appraise, type JobAppraisal } from './complexity';
import { clamp, round1 } from './stats';

/**
 * Assignment.
 *
 * The industry default is "who is closest". That is the wrong question, and it
 * is wrong in a specific, expensive way: the closest courier is often the one
 * who then stands in a laundromat for twelve minutes because the order isn't
 * ready, while a courier two minutes further out finishes their current drop
 * exactly when the order comes off the counter.
 *
 * So this ranks by what the platform actually needs to maximize — dollars per
 * minute of the courier's engaged time — with the customer's wait weighted
 * alongside it, and it is willing to say *not yet*: holding an offer until the
 * order is nearly ready is frequently the highest-value move available.
 */

export interface DispatchCandidate {
  courier: CourierState;
  estimate: JobEstimate;
  appraisal: JobAppraisal;
  /** Minutes from now until the customer has the order. */
  deliverAtMinutes: number;
  /**
   * The unpaid space between finishing the last job and doing productive work
   * on this one: riding to the pickup, then standing there. The metric the
   * whole engine exists to shrink.
   */
  idleGapMinutes: number;
  repositionMinutes: number;
  waitMinutes: number;
  score: number;
  /** Why this courier ranked where they did, in words. */
  rationale: string;
}

export interface DispatchOptions {
  now?: Date;
  /** Weighting between courier productivity and customer speed. */
  weights?: Partial<DispatchWeights>;
  /** Consider couriers who will not be free for a while. */
  maxFreeInMinutes?: number;
}

export interface DispatchWeights {
  productivity: number;
  speed: number;
  /** Small nudge toward couriers with fewer jobs in hand — fleet health. */
  fairness: number;
}

export const DEFAULT_WEIGHTS: DispatchWeights = { productivity: 0.55, speed: 0.35, fairness: 0.1 };

export function rankCouriers(
  job: DeliveryJob,
  couriers: CourierState[],
  ctx: JobContext,
  opts: DispatchOptions = {},
): DispatchCandidate[] {
  const now = opts.now ?? new Date();
  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const maxFreeIn = opts.maxFreeInMinutes ?? 25;

  const raw = couriers
    .filter((c) => c.freeInMinutes <= maxFreeIn)
    .map((courier) => {
      const estimate = estimateJob(job, courier, ctx, { now });
      const repositionMinutes = estimate.components.to_merchant + estimate.components.merchant_park;
      const waitMinutes = estimate.components.prep_wait;
      return {
        courier,
        estimate,
        appraisal: appraise(estimate, job.payout, job.tip),
        deliverAtMinutes: estimate.deliverAtMinutes,
        idleGapMinutes: round1(repositionMinutes + waitMinutes),
        repositionMinutes: round1(repositionMinutes),
        waitMinutes: round1(waitMinutes),
        score: 0,
        rationale: '',
      } satisfies DispatchCandidate;
    });

  if (raw.length === 0) return [];

  const fastest = Math.min(...raw.map((c) => c.deliverAtMinutes));
  const maxJobs = Math.max(1, ...raw.map((c) => c.courier.activeJobs));

  for (const c of raw) {
    // Productivity, expressed against the target rather than against the field,
    // so a whole field of bad options still scores badly.
    const productivity = clamp(c.estimate.dollarsPerMinute / TARGET_DOLLARS_PER_MINUTE, 0, 1.5) / 1.5;
    // Speed is relative: 10 minutes slower than the best option scores zero.
    const speed = clamp(1 - (c.deliverAtMinutes - fastest) / 10, 0, 1);
    const fairness = 1 - c.courier.activeJobs / (maxJobs + 1);

    c.score = Math.round(
      (weights.productivity * productivity + weights.speed * speed + weights.fairness * fairness) * 1000,
    ) / 10;

    const bits = [`$${c.estimate.dollarsPerMinute}/min`, `delivers in ${Math.round(c.deliverAtMinutes)} min`];
    if (c.waitMinutes >= 3) bits.push(`${Math.round(c.waitMinutes)} min standing at the counter`);
    if (c.courier.freeInMinutes > 0) bits.push(`free in ${Math.round(c.courier.freeInMinutes)} min`);
    c.rationale = bits.join(' · ');
  }

  return raw.sort((a, b) => b.score - a.score);
}

export interface HoldDecision {
  hold: boolean;
  /** Minutes to wait before offering. */
  holdForMinutes: number;
  reason: string;
}

/**
 * Should the offer go out at all yet?
 *
 * If every available courier would arrive long before the order is ready, the
 * offer is not worth sending: it converts a courier's productive minutes into
 * standing time and locks them out of work they could have finished first.
 * Waiting costs nothing as long as we still leave time to get there.
 */
export function shouldHoldOffer(
  job: DeliveryJob,
  candidates: DispatchCandidate[],
  ctx: JobContext,
  opts: { now?: Date; toleratedWaitMinutes?: number } = {},
): HoldDecision {
  const now = opts.now ?? new Date();
  const tolerated = opts.toleratedWaitMinutes ?? 4;

  if (candidates.length === 0) {
    return { hold: false, reason: 'no couriers available — offer anyway so the order is not stranded', holdForMinutes: 0 };
  }

  const best = candidates[0];
  if (best.waitMinutes <= tolerated) {
    return { hold: false, reason: `best courier arrives ${round1(best.waitMinutes)} min early — within tolerance`, holdForMinutes: 0 };
  }

  const ready = readyInMinutes(ctx.merchant, job, ctx.prepObservations, now);
  const holdFor = round1(Math.max(0, best.waitMinutes - tolerated));
  return {
    hold: true,
    holdForMinutes: holdFor,
    reason: `order ready in ${round1(ready.minutes)} min; offering now buys ${round1(best.waitMinutes)} min of standing time`,
  };
}

export interface DispatchPlan {
  job: DeliveryJob;
  candidates: DispatchCandidate[];
  hold: HoldDecision;
  /** The courier to offer to first, if we are offering now. */
  best: DispatchCandidate | null;
  /** Underpaid jobs get flagged rather than quietly pushed at couriers. */
  payWarning: string | null;
}

export function planDispatch(
  job: DeliveryJob,
  couriers: CourierState[],
  ctx: JobContext,
  opts: DispatchOptions = {},
): DispatchPlan {
  const candidates = rankCouriers(job, couriers, ctx, opts);
  const hold = shouldHoldOffer(job, candidates, ctx, { now: opts.now });
  const best = candidates[0] ?? null;

  // A job nobody should take is a dispatch problem, not a courier problem.
  const payWarning =
    best && best.appraisal.verdict === 'poor'
      ? `This job pays $${(job.payout + (job.tip ?? 0)).toFixed(2)} for ${best.estimate.totalMinutes} min of work ($${best.estimate.dollarsPerMinute}/min). Fair pay for its real cost is about $${best.appraisal.fairPay.toFixed(2)}.`
      : null;

  return { job, candidates, hold, best, payWarning };
}
