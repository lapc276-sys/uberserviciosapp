import { getService } from './config/services';
import { getCityByName, type SalesTax } from './config/cities';
// The same rate the vision path prices with, so both channels agree on what
// an hour of labour is worth and a duration can be recovered from a price.
import { HOURLY_RATE_USD } from './vision/pricing';
import { MINUTES_PER_PRO } from './vision/model';

export interface QuoteInput {
  serviceSlug: string;
  bedrooms: number;
  bathrooms: number;
  sqft?: number;
  frequency?: 'one_time' | 'weekly' | 'biweekly' | 'monthly';
  /** City display name — determines sales tax. */
  city?: string;
}

export interface QuoteResult {
  service: string;
  /** Pre-tax range. */
  low: number;
  high: number;
  /** Sales tax on the midpoint, and the tax-inclusive range. */
  taxRate: number;
  taxAmount: number;
  totalLow: number;
  totalHigh: number;
  taxNote?: string;
  /** Human range from the catalogue, e.g. "3–5 hrs". Same for every property. */
  estimatedHours: string;
  /**
   * Labor minutes this specific job implies.
   *
   * Derived from the price rather than read from the catalogue, because the
   * catalogue string is per service: a one-bed flat and a five-bed house both
   * say "3–5 hrs". The price already scales with bedrooms, bathrooms and area,
   * so dividing it by the hourly rate recovers a duration that scales too.
   *
   * Computed before the frequency discount on purpose — a weekly customer pays
   * 20% less, but the cleaner still works the same hours, and this number is
   * what tells them whether the job is worth taking.
   */
  estimatedMinutes: number;
  /**
   * People the job warrants. `estimatedMinutes` is labour time, not wall-clock:
   * a 9-hour estimate is three people for three hours, and showing it to one
   * cleaner as their day would be a lie they only discover on arrival.
   */
  recommendedPros: number;
  frequencyDiscountPct: number;
  currency: 'USD';
}

const FREQUENCY_DISCOUNT: Record<NonNullable<QuoteInput['frequency']>, number> = {
  one_time: 0,
  monthly: 0.1,
  biweekly: 0.15,
  weekly: 0.2,
};

/** Commercial-scope services, for states that only tax nonresidential cleaning. */
const COMMERCIAL_SERVICES = new Set(['office-cleaning', 'commercial-cleaning', 'post-construction-cleaning']);

function effectiveTaxRate(tax: SalesTax | undefined, serviceSlug: string): number {
  if (!tax || tax.appliesTo === 'none') return 0;
  if (tax.appliesTo === 'all') return tax.rate;
  return COMMERCIAL_SERVICES.has(serviceSlug) ? tax.rate : 0;
}

/**
 * Deterministic pricing engine shared by the booking flow, the /api/quote
 * endpoint and the assistant, so every channel quotes identical prices.
 * Sales tax is applied per market — see lib/config/cities.ts.
 */
export function calculateQuote(input: QuoteInput): QuoteResult | null {
  const service = getService(input.serviceSlug);
  if (!service) return null;

  const { base, perBedroom, perBathroom, perSqftThousand } = service.pricing;
  const bedrooms = Math.max(0, Math.min(input.bedrooms || 0, 10));
  const bathrooms = Math.max(0, Math.min(input.bathrooms || 0, 10));
  const sqft = Math.max(0, Math.min(input.sqft || 0, 20000));

  const grossPoint = base + bedrooms * perBedroom + bathrooms * perBathroom + (sqft / 1000) * perSqftThousand;

  const discount = FREQUENCY_DISCOUNT[input.frequency ?? 'one_time'];
  const point = grossPoint * (1 - discount);

  // Rounded to five minutes: the inputs are a questionnaire, and quoting
  // "137 minutes" would imply a precision this path does not have.
  const estimatedMinutes = Math.max(60, Math.round((grossPoint / HOURLY_RATE_USD) * 60 / 5) * 5);

  const low = Math.round(point * 0.9);
  const high = Math.round(point * 1.15);

  const cityTax = input.city ? getCityByName(input.city)?.salesTax : undefined;
  const taxRate = effectiveTaxRate(cityTax, input.serviceSlug);
  const taxAmount = Math.round(((low + high) / 2) * taxRate);

  return {
    service: service.name,
    low,
    high,
    taxRate,
    taxAmount,
    totalLow: Math.round(low * (1 + taxRate)),
    totalHigh: Math.round(high * (1 + taxRate)),
    taxNote: taxRate > 0 ? cityTax?.note : undefined,
    estimatedHours: service.pricing.estimatedHours,
    estimatedMinutes,
    recommendedPros: Math.max(1, Math.ceil(estimatedMinutes / MINUTES_PER_PRO)),
    frequencyDiscountPct: discount * 100,
    currency: 'USD',
  };
}
