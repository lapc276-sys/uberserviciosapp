import { getService } from './config/services';

export interface QuoteInput {
  serviceSlug: string;
  bedrooms: number;
  bathrooms: number;
  sqft?: number;
  frequency?: 'one_time' | 'weekly' | 'biweekly' | 'monthly';
}

export interface QuoteResult {
  service: string;
  low: number;
  high: number;
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

/**
 * Deterministic pricing engine shared by the booking flow, the /api/quote
 * endpoint and the chatbot, so every channel quotes identical prices.
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

  return {
    service: service.name,
    low: Math.round(point * 0.9),
    high: Math.round(point * 1.15),
    estimatedHours: service.pricing.estimatedHours,
    frequencyDiscountPct: discount * 100,
    currency: 'USD',
  };
}
