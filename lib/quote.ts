import { getService } from './config/services';
import { getCityByName, type SalesTax } from './config/cities';

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
  estimatedHours: string;
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

  let point = base + bedrooms * perBedroom + bathrooms * perBathroom + (sqft / 1000) * perSqftThousand;

  const discount = FREQUENCY_DISCOUNT[input.frequency ?? 'one_time'];
  point = point * (1 - discount);

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
    frequencyDiscountPct: discount * 100,
    currency: 'USD',
  };
}
