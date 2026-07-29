import { getCityByName } from '../config/cities';
import { getService } from '../config/services';
import type { PropertyAnalysis } from './types';

/**
 * Prices a vision analysis by labor time rather than bedroom count.
 *
 * The confidence band matters commercially: a shaky analysis produces a wider
 * range so the customer is told up front that the final number may move,
 * instead of being surprised on arrival — the surprise is what destroys the
 * trust that made them book from a video in the first place.
 */

/** Blended labor rate per hour, before tax. Tune per market. */
export const HOURLY_RATE_USD = 55;

/** Floor so a tiny job still covers travel and setup. */
export const MINIMUM_JOB_USD = 89;

/** Share of revenue paid to the pro (the rest is platform margin). */
export const PRO_PAYOUT_SHARE = 0.75;

/**
 * Payment processing, charged on the full amount collected — tax included,
 * because the processor takes its cut of the tax we merely pass through.
 * Stripe's standard US card rate.
 */
export const PAYMENT_FEE_PCT = 0.029;
export const PAYMENT_FEE_FIXED_USD = 0.3;

/**
 * Per-job variable technology cost: one vision analysis (~8 frames at a
 * multimodal model), plus the confirmation and reminder SMS and emails that
 * every booking fires.
 *
 * Small per job and easy to wave away — which is exactly why it belongs in the
 * arithmetic. A margin figure that omits the costs a job actually incurs is
 * not a margin figure, and the whole point of computing this in code rather
 * than in a spreadsheet is that it stays honest as volume grows.
 */
export const TECH_COST_PER_JOB_USD = 0.15;

export interface VisionQuote {
  minutes: number;
  hours: number;
  recommendedPros: number;
  /** Pre-tax range. */
  low: number;
  high: number;
  taxRate: number;
  taxAmount: number;
  totalLow: number;
  totalHigh: number;
  taxNote?: string;
  /** What the assigned pro(s) earn, before platform fee. */
  proPayout: number;
  /** Estimated consumables for this job — a real cost, not a rounding error. */
  supplyCost: number;
  /** Card processing on the tax-inclusive total. */
  paymentFee: number;
  /** Vision analysis + transactional SMS/email for this job. */
  techCost: number;
  /** What's left after the pro, supplies, processing and technology. */
  platformMargin: number;
  /** Margin as a share of pre-tax revenue, for comparing jobs of any size. */
  marginPct: number;
  currency: 'USD';
}

const COMMERCIAL_SERVICES = new Set(['office-cleaning', 'commercial-cleaning', 'post-construction-cleaning']);

export function priceFromAnalysis(
  analysis: PropertyAnalysis,
  opts: { serviceSlug: string; city?: string },
): VisionQuote {
  const hours = analysis.totalMinutes / 60;
  const labor = Math.max(MINIMUM_JOB_USD, hours * HOURLY_RATE_USD);

  // Lower confidence widens the band; a confident read quotes tightly.
  const spread = 0.08 + (1 - analysis.confidence) * 0.22;
  const low = Math.round(labor * (1 - spread));
  const high = Math.round(labor * (1 + spread));

  const cityTax = opts.city ? getCityByName(opts.city)?.salesTax : undefined;
  const taxable =
    cityTax && cityTax.appliesTo !== 'none'
      ? cityTax.appliesTo === 'all' || COMMERCIAL_SERVICES.has(opts.serviceSlug)
      : false;
  const taxRate = taxable ? cityTax!.rate : 0;
  const midpoint = (low + high) / 2;
  const taxAmount = Math.round(midpoint * taxRate);

  const proPayout = Math.round(midpoint * PRO_PAYOUT_SHARE);
  // Only consumables count against margin — reusable tools are capital, not
  // a per-job cost, so charging them to every job would understate profit.
  const supplyCost = Math.round(
    (analysis.supplyPlan?.lines ?? [])
      .filter((l) => l.category !== 'tool')
      .reduce((sum, l) => sum + l.estimatedCost, 0),
  );

  // Processing is charged on what the customer actually pays, so tax is in the
  // base even though we never keep it.
  const collected = midpoint * (1 + taxRate);
  const paymentFee = Number((collected * PAYMENT_FEE_PCT + PAYMENT_FEE_FIXED_USD).toFixed(2));
  const techCost = TECH_COST_PER_JOB_USD;

  const platformMargin = Number((midpoint - proPayout - supplyCost - paymentFee - techCost).toFixed(2));

  return {
    minutes: analysis.totalMinutes,
    hours: Number(hours.toFixed(2)),
    recommendedPros: analysis.recommendedPros,
    low,
    high,
    taxRate,
    taxAmount,
    totalLow: Math.round(low * (1 + taxRate)),
    totalHigh: Math.round(high * (1 + taxRate)),
    taxNote: taxRate > 0 ? cityTax?.note : undefined,
    proPayout,
    supplyCost,
    paymentFee,
    techCost,
    platformMargin,
    marginPct: midpoint > 0 ? Number(((platformMargin / midpoint) * 100).toFixed(1)) : 0,
    currency: 'USD',
  };
}

/** Sanity check against the questionnaire quote, to catch model drift. */
export function serviceBaseline(serviceSlug: string): number {
  return getService(serviceSlug)?.pricing.base ?? MINIMUM_JOB_USD;
}
