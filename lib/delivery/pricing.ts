import { TARGET_DOLLARS_PER_MINUTE } from './complexity';
import type { JobEstimate, MerchantProfile } from './types';

/**
 * Money.
 *
 * The business model is deliberately narrow: **we do not touch the laundromat's
 * revenue.** They charge their own rate per pound and keep 100% of it. Our only
 * income is the round-trip surcharge the customer pays on top for not having to
 * carry twenty pounds four blocks and sit there for ninety minutes.
 *
 * That choice has two consequences worth understanding before changing it:
 *
 *  - **Customer acquisition cost collapses.** We are not buying consumers, we
 *    are signing laundromats — and they arrive with their customers already.
 *    A 15–30% cut is a hard negotiation with a thin-margin cash business; zero
 *    percent is a thirty-second conversation.
 *  - **Every dollar of margin has to come out of one number.** The surcharge
 *    pays the courier, the processor, and us, in that order. There is no
 *    service revenue to hide a bad route inside, which is exactly why the time
 *    model has to be right.
 *
 * ⚠️ Rates here are starting points for one market. Check them against local
 * minimum-pay rules before launching: several cities (New York among them)
 * regulate courier pay per hour of engaged time, and the calculation is not
 * optional.
 */

// ── The laundromat's side (not ours) ─────────────────────────────────────────

/**
 * Fallback rate when a merchant record does not carry its own. Each laundromat
 * sets its own price — this is a placeholder for estimating, never a price we
 * impose on them.
 */
export const DEFAULT_RATE_PER_POUND = 1.95;
/** Nobody sends out three socks. Most laundromats have a floor; this is ours. */
export const MINIMUM_POUNDS = 10;
/** A standard customer bag, for estimating before anything is weighed. */
export const POUNDS_PER_BAG = 12;
/**
 * How wide the pre-weigh estimate is. Bags vary, so the quote has to — but not
 * so much that it stops being an answer. This width is also what the payment
 * guardrail measures against, so widening it is not free.
 */
export const BAG_ESTIMATE_SPREAD = 0.2;

export function rateFor(merchant?: Pick<MerchantProfile, 'ratePerPound'> | null): number {
  return merchant?.ratePerPound ?? DEFAULT_RATE_PER_POUND;
}

// ── Our side: one surcharge, round trip ──────────────────────────────────────

/**
 * What the customer pays us for the pickup *and* the return. One number, the
 * same for everybody.
 *
 * A per-job price derived from the time model would be more precise, and it is
 * deliberately not used: the customers who need this most are elderly people in
 * fifth-floor walk-ups, and charging them extra for the stairs is both bad
 * business and hard to say out loud. So the complexity model is used on the
 * other side of the transaction — to pay the courier more for the hard job —
 * and the mix absorbs the difference.
 *
 * `contributionFor()` is what keeps that honest: if the mix stops working, it
 * shows up per order instead of at the end of the quarter.
 *
 * ⚠️ **This number is set by the walk-up, not by the easy job.** Run
 * `npm run delivery:sim`: inside an eight-block bubble, a lobby drop costs
 * about 17 minutes of courier time round trip, and a fifth-floor walk-up costs
 * about 27. At $12 the walk-up lands at roughly **zero margin** — it is
 * genuinely unservable at that price, and no amount of batching fixes it,
 * because what makes it expensive is the stairs, not the road. $15 clears both
 * (~$2.90 on the walk-up, ~$5.30 on the lobby drop).
 *
 * Lower it only after the observations say the legs are shorter than modeled.
 */
export const ROUND_TRIP_SURCHARGE = 15;

/** Card processing on our portion. Assumes we absorb the fixed fee. */
export function processingCostFor(amount: number): number {
  return Math.round((amount * 0.029 + 0.3) * 100) / 100;
}

export interface LaundryEstimate {
  bags: number;
  estimatedPounds: number;
  low: number;
  high: number;
  /** The laundromat's estimated share — money that is never ours. */
  washLow: number;
  washHigh: number;
  surcharge: number;
  ratePerPound: number;
  /** What we tell the customer before anything is weighed. */
  summary: string;
}

/**
 * The pre-weigh estimate. Deliberately a range: the price depends on weight,
 * nobody knows the weight yet, and a confident wrong number is how you get a
 * chargeback three days later.
 */
export function estimateLaundry(
  bags: number,
  opts: { merchant?: Pick<MerchantProfile, 'ratePerPound'> | null; surcharge?: number } = {},
): LaundryEstimate {
  const ratePerPound = rateFor(opts.merchant);
  const surcharge = opts.surcharge ?? ROUND_TRIP_SURCHARGE;
  const pounds = Math.max(MINIMUM_POUNDS, bags * POUNDS_PER_BAG);
  const mid = pounds * ratePerPound;

  const washLow = Math.round(mid * (1 - BAG_ESTIMATE_SPREAD) * 100) / 100;
  const washHigh = Math.round(mid * (1 + BAG_ESTIMATE_SPREAD) * 100) / 100;

  return {
    bags,
    estimatedPounds: Math.round(pounds),
    low: Math.round((washLow + surcharge) * 100) / 100,
    high: Math.round((washHigh + surcharge) * 100) / 100,
    washLow,
    washHigh,
    surcharge,
    ratePerPound,
    summary: `${bags} ${bags === 1 ? 'bag' : 'bags'} (~${Math.round(pounds)} lb) — about $${(washLow + surcharge).toFixed(2)}–$${(washHigh + surcharge).toFixed(2)}, including $${surcharge.toFixed(2)} for pickup and delivery. The laundromat sets the wash price; final total is set when it's weighed.`,
  };
}

export interface FinalPrice {
  total: number;
  /** The laundromat's, in full. */
  wash: number;
  surcharge: number;
}

/** The real bill, once the laundromat puts it on the scale. */
export function finalLaundryPrice(
  pounds: number,
  opts: { merchant?: Pick<MerchantProfile, 'ratePerPound'> | null; extras?: number; surcharge?: number } = {},
): FinalPrice {
  const billable = Math.max(MINIMUM_POUNDS, pounds);
  const surcharge = opts.surcharge ?? ROUND_TRIP_SURCHARGE;
  const wash = Math.round((billable * rateFor(opts.merchant) + (opts.extras ?? 0)) * 100) / 100;
  return { total: Math.round((wash + surcharge) * 100) / 100, wash, surcharge };
}

// ── Courier pay ──────────────────────────────────────────────────────────────

/**
 * No job pays less than this, however short. Getting there costs something.
 *
 * Worth tuning per market: in a dense eight-block bubble a leg runs ~8 minutes,
 * so this floor pays ~$31/hour — above the $25/hour target — and every cent of
 * that overshoot comes straight out of the surcharge margin. It is left high
 * deliberately: over-paying slightly on easy jobs is a much cheaper mistake
 * than a fleet that won't accept short runs.
 */
export const MINIMUM_JOB_PAY = 4.5;

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
 * This is the mechanism that makes hard jobs get taken. A fifth-floor walk-up
 * with a buzzer nobody answers costs more minutes, so it pays more — and no
 * courier has to be persuaded, incentivized or penalized into accepting it.
 *
 * Note this prices ONE leg. A laundry order is two: out to collect, back to
 * deliver. `contributionFor()` accounts for both.
 */
export function courierPayFor(estimate: JobEstimate): number {
  const working = estimate.workingMinutes;
  const waiting = estimate.components.prep_wait;
  const fair = TARGET_DOLLARS_PER_MINUTE * (working + waiting * WAIT_PAY_RATIO);
  return Math.round(Math.max(MINIMUM_JOB_PAY, fair) * 100) / 100;
}

export interface Contribution {
  surcharge: number;
  /** Both legs — collection and return. */
  courierPay: number;
  processing: number;
  /** What survives. Negative means this route costs us money to serve. */
  margin: number;
  marginPct: number;
  healthy: boolean;
}

/**
 * The number that decides whether this business works, per order.
 *
 * A flat surcharge against variable courier pay means some orders lose money —
 * that is a deliberate, priced choice, not an accident. What is not acceptable
 * is not knowing which ones. Feed both legs' pay in and this says plainly
 * whether the route earned its keep.
 */
export function contributionFor(input: {
  pickupPay: number;
  returnPay: number;
  surcharge?: number;
}): Contribution {
  const surcharge = input.surcharge ?? ROUND_TRIP_SURCHARGE;
  const courierPay = Math.round((input.pickupPay + input.returnPay) * 100) / 100;
  const processing = processingCostFor(surcharge);
  const margin = Math.round((surcharge - courierPay - processing) * 100) / 100;

  return {
    surcharge,
    courierPay,
    processing,
    margin,
    marginPct: surcharge > 0 ? Math.round((margin / surcharge) * 100) : 0,
    healthy: margin >= MINIMUM_HEALTHY_MARGIN,
  };
}

/**
 * Below this per order, the route is not worth serving at the current
 * surcharge. The answer is a bigger bubble radius, better batching, or a higher
 * price — never a smaller courier payment.
 */
export const MINIMUM_HEALTHY_MARGIN = 2;

export interface Split {
  /** Total the customer pays. */
  total: number;
  /** To the laundromat, in full. We take nothing from the wash. */
  merchant: number;
  /** To the courier, both legs. */
  courier: number;
  /** What's left for us. Can be negative — better to see it. */
  platform: number;
}

/**
 * Splits one charge. The laundromat's money passes straight through; our margin
 * is whatever survives paying the courier properly out of the surcharge.
 *
 * If that is negative on a route, the answer is to fix the radius or the price
 * — not to underpay the person carrying the bags up five flights.
 */
export function splitOrder(input: { total: number; wash: number; courierPay: number }): Split {
  const merchant = Math.round(input.wash * 100) / 100;
  const surcharge = Math.round((input.total - merchant) * 100) / 100;
  const platform = Math.round((surcharge - input.courierPay - processingCostFor(surcharge)) * 100) / 100;
  return { total: input.total, merchant, courier: input.courierPay, platform };
}
