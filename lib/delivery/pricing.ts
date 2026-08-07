import { TARGET_DOLLARS_PER_MINUTE } from './complexity';
import type { JobEstimate } from './types';

/**
 * Pricing for delivery work — and specifically, courier pay derived from the
 * time model rather than from distance.
 *
 * This is the whole argument of the engine turned into money. If a job is
 * scored by miles, a 6th-floor walk-up with a 15-minute prep wait pays the same
 * as a lobby drop half a mile away, couriers learn to cherry-pick, and the hard
 * jobs rot in the queue. If the job is scored by its *real* minutes, the hard
 * job pays more, gets taken, and nobody has to be persuaded to do it.
 *
 * ⚠️ Rates below are starting points for one market. Check them against local
 * minimum-pay rules before launching: several cities (New York among them)
 * regulate minimum courier pay per hour of engaged time, and the calculation is
 * not optional.
 */

// ── Laundry: the first vertical ──────────────────────────────────────────────

/** Wash & fold, per pound. The service itself — the laundromat's revenue. */
export const WASH_FOLD_PER_POUND = 1.95;
/** Nobody sends out three socks. */
export const MINIMUM_POUNDS = 10;
/** A standard customer bag, for estimating before anything is weighed. */
export const POUNDS_PER_BAG = 12;
/**
 * How wide the pre-weigh estimate is. Bags vary, so the quote has to — but not
 * so much that it stops being an answer. This width is also what the payment
 * guardrail measures against, so widening it is not free.
 */
export const BAG_ESTIMATE_SPREAD = 0.2;
/** Pickup + return trip, charged to the customer. */
export const DELIVERY_FEE = 6.99;
/** Platform's share of the laundry subtotal. The laundromat keeps the rest. */
export const PLATFORM_SERVICE_FEE_PCT = 0.15;

export interface LaundryEstimate {
  bags: number;
  estimatedPounds: number;
  low: number;
  high: number;
  deliveryFee: number;
  /** What we tell the customer before anything is weighed. */
  summary: string;
}

/**
 * The pre-weigh estimate. Deliberately a range: the price depends on weight,
 * nobody knows the weight yet, and a confident wrong number is how you get a
 * chargeback three days later.
 */
export function estimateLaundry(bags: number): LaundryEstimate {
  const pounds = Math.max(MINIMUM_POUNDS, bags * POUNDS_PER_BAG);
  const mid = pounds * WASH_FOLD_PER_POUND;
  const low = Math.round((mid * (1 - BAG_ESTIMATE_SPREAD) + DELIVERY_FEE) * 100) / 100;
  const high = Math.round((mid * (1 + BAG_ESTIMATE_SPREAD) + DELIVERY_FEE) * 100) / 100;

  return {
    bags,
    estimatedPounds: Math.round(pounds),
    low,
    high,
    deliveryFee: DELIVERY_FEE,
    summary: `${bags} ${bags === 1 ? 'bag' : 'bags'} (~${Math.round(pounds)} lb) — about $${low.toFixed(2)}–$${high.toFixed(2)} including pickup and delivery. Final price is set when it's weighed.`,
  };
}

/** The real bill, once the laundromat puts it on the scale. */
export function finalLaundryPrice(pounds: number, extras = 0): number {
  const billable = Math.max(MINIMUM_POUNDS, pounds);
  return Math.round((billable * WASH_FOLD_PER_POUND + DELIVERY_FEE + extras) * 100) / 100;
}

// ── Courier pay ──────────────────────────────────────────────────────────────

/** No job pays less than this, however short. Getting there costs something. */
export const MINIMUM_JOB_PAY = 4.5;
/** Each extra order on a batched pickup. Less than a solo job, more than zero. */
export const BATCH_ADDITIONAL_PAY = 3.25;

/**
 * Waiting is paid, at a lower rate than working.
 *
 * Paying nothing for prep wait is how platforms end up with orders nobody will
 * touch — the courier absorbs the merchant's lateness. Paying full rate is the
 * opposite failure: a slow merchant becomes a lottery ticket, and the platform
 * buys standing time it should have designed away by holding the offer instead.
 */
export const WAIT_PAY_RATIO = 0.6;

/**
 * What a job should pay, from the minutes it actually contains.
 *
 * This is the mechanism that makes hard jobs get taken. A 6th-floor walk-up
 * with a buzzer nobody answers costs more minutes, so it pays more — and no
 * courier has to be persuaded, incentivized or penalized into accepting it.
 */
export function courierPayFor(estimate: JobEstimate): number {
  const working = estimate.workingMinutes;
  const waiting = estimate.components.prep_wait;
  const fair = TARGET_DOLLARS_PER_MINUTE * (working + waiting * WAIT_PAY_RATIO);
  return Math.round(Math.max(MINIMUM_JOB_PAY, fair) * 100) / 100;
}

export interface Split {
  /** Total the customer pays. */
  total: number;
  /** To the laundromat, for the service. */
  merchant: number;
  /** To the courier. */
  courier: number;
  /** What's left for the platform. Can be negative — better to see it. */
  platform: number;
}

/**
 * Splits one order three ways. Platform margin is whatever survives paying the
 * merchant and the courier properly, and if that is negative on a route, the
 * answer is to fix the pricing or refuse the route — not to underpay the
 * person carrying the bags up six flights.
 */
export function splitOrder(input: {
  total: number;
  serviceSubtotal: number;
  courierPay: number;
}): Split {
  const merchant = Math.round(input.serviceSubtotal * (1 - PLATFORM_SERVICE_FEE_PCT) * 100) / 100;
  const platform = Math.round((input.total - merchant - input.courierPay) * 100) / 100;
  return { total: input.total, merchant, courier: input.courierPay, platform };
}
