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
  platformMargin: number;
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
    platformMargin: Math.round(midpoint - proPayout),
    currency: 'USD',
  };
}

/** Sanity check against the questionnaire quote, to catch model drift. */
export function serviceBaseline(serviceSlug: string): number {
  return getService(serviceSlug)?.pricing.base ?? MINIMUM_JOB_USD;
}
