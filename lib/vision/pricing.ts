import { getCityByName } from '../config/cities';
import { getService } from '../config/services';
import type { TenantPricing } from '../tenants/types';
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
  /**
   * The labor cost of the job. On the marketplace that is the pro's payout;
   * for a licensed tenant it is what their own cleaner costs them. Same
   * number, same place in the P&L, so it stays one field.
   */
  proPayout: number;
  /** Estimated consumables for this job — a real cost, not a rounding error. */
  supplyCost: number;
  /** What's left after paying the labor and the supplies. */
  platformMargin: number;
  /** ISO 4217. Not fixed to USD — the engine is sold outside the US. */
  currency: string;
}

const COMMERCIAL_SERVICES = new Set(['office-cleaning', 'commercial-cleaning', 'post-construction-cleaning']);

export function priceFromAnalysis(
  analysis: PropertyAnalysis,
  opts: {
    serviceSlug: string;
    city?: string;
    /**
     * A licensing tenant's own commercial settings. Absent, the marketplace
     * defaults apply: our rate, US city sales tax, and the pro payout share.
     * Present, the tenant's rate, currency and tax rule replace all three —
     * a company in Manchester has no business being quoted NYC sales tax.
     */
    pricing?: TenantPricing;
  },
): VisionQuote {
  const p = opts.pricing;
  const hourlyRate = p?.hourlyRate ?? HOURLY_RATE_USD;
  const minimumJob = p?.minimumJob ?? MINIMUM_JOB_USD;

  const hours = analysis.totalMinutes / 60;
  const labor = Math.max(minimumJob, hours * hourlyRate);

  // Lower confidence widens the band; a confident read quotes tightly.
  const spread = 0.08 + (1 - analysis.confidence) * 0.22;
  const low = Math.round(labor * (1 - spread));
  const high = Math.round(labor * (1 + spread));

  const midpoint = (low + high) / 2;

  let taxRate = 0;
  let taxNote: string | undefined;
  if (p) {
    const applies =
      p.taxAppliesTo === 'all' || (p.taxAppliesTo === 'commercial' && COMMERCIAL_SERVICES.has(opts.serviceSlug));
    taxRate = applies ? p.taxRate : 0;
    taxNote = taxRate > 0 ? p.taxNote : undefined;
  } else {
    const cityTax = opts.city ? getCityByName(opts.city)?.salesTax : undefined;
    const taxable =
      cityTax && cityTax.appliesTo !== 'none'
        ? cityTax.appliesTo === 'all' || COMMERCIAL_SERVICES.has(opts.serviceSlug)
        : false;
    taxRate = taxable ? cityTax!.rate : 0;
    taxNote = taxRate > 0 ? cityTax?.note : undefined;
  }

  const taxAmount = Math.round(midpoint * taxRate);

  // A tenant knows what their own crew costs per hour, so their labor cost is
  // computed from hours worked, not from a revenue share they don't pay.
  const proPayout = p
    ? Math.round(hours * p.laborCostRate)
    : Math.round(midpoint * PRO_PAYOUT_SHARE);
  // Only consumables count against margin — reusable tools are capital, not
  // a per-job cost, so charging them to every job would understate profit.
  const supplyCost = Math.round(
    (analysis.supplyPlan?.lines ?? [])
      .filter((l) => l.category !== 'tool')
      .reduce((sum, l) => sum + l.estimatedCost, 0),
  );

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
    taxNote,
    proPayout,
    supplyCost,
    platformMargin: Math.round(midpoint - proPayout - supplyCost),
    currency: p?.currency ?? 'USD',
  };
}

/** Sanity check against the questionnaire quote, to catch model drift. */
export function serviceBaseline(serviceSlug: string): number {
  return getService(serviceSlug)?.pricing.base ?? MINIMUM_JOB_USD;
}
