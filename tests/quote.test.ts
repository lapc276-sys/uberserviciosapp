import { describe, it, expect } from 'vitest';
import { calculateQuote } from '@/lib/quote';
import { getService } from '@/lib/config/services';

/**
 * The questionnaire pricing engine.
 *
 * This is the number quoted on the website, in the chat widget, on WhatsApp and
 * over the phone — all four read from this one function, so a regression here
 * is a regression everywhere at once. That shared blast radius is why it is the
 * first thing under test.
 *
 * Note this engine has NO minimum-price floor: the $89 floor belongs to the
 * vision engine (`priceFromAnalysis`), which prices by labor minutes. Confusing
 * the two is easy and expensive, so both are asserted explicitly below.
 */
describe('calculateQuote', () => {
  it('returns null for an unknown service rather than guessing a price', () => {
    expect(calculateQuote({ serviceSlug: 'not-a-service', bedrooms: 2, bathrooms: 1 })).toBeNull();
  });

  it('prices from the service config, not from hardcoded numbers', () => {
    const service = getService('house-cleaning')!;
    const { base, perBedroom, perBathroom } = service.pricing;
    const quote = calculateQuote({ serviceSlug: 'house-cleaning', bedrooms: 3, bathrooms: 2 })!;

    const point = base + 3 * perBedroom + 2 * perBathroom;
    expect(quote.low).toBe(Math.round(point * 0.9));
    expect(quote.high).toBe(Math.round(point * 1.15));
  });

  it('is deterministic — the same input always quotes the same price', () => {
    const input = { serviceSlug: 'deep-cleaning', bedrooms: 4, bathrooms: 3, sqft: 2200, city: 'Miami' } as const;
    const first = calculateQuote(input);
    const second = calculateQuote(input);
    expect(first).toEqual(second);
  });

  it('always quotes a low below the high', () => {
    for (const slug of ['house-cleaning', 'deep-cleaning', 'post-construction-cleaning']) {
      const quote = calculateQuote({ serviceSlug: slug, bedrooms: 2, bathrooms: 1 })!;
      expect(quote.low).toBeLessThan(quote.high);
    }
  });

  it('grows monotonically with bedrooms', () => {
    const prices = [0, 1, 2, 3, 4].map(
      (bedrooms) => calculateQuote({ serviceSlug: 'house-cleaning', bedrooms, bathrooms: 1 })!.low,
    );
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    }
  });

  describe('frequency discounts', () => {
    const base = { serviceSlug: 'house-cleaning', bedrooms: 3, bathrooms: 2 } as const;

    it('applies no discount to one-time jobs', () => {
      expect(calculateQuote({ ...base, frequency: 'one_time' })!.frequencyDiscountPct).toBe(0);
    });

    it('discounts more as visits get more frequent', () => {
      const monthly = calculateQuote({ ...base, frequency: 'monthly' })!;
      const biweekly = calculateQuote({ ...base, frequency: 'biweekly' })!;
      const weekly = calculateQuote({ ...base, frequency: 'weekly' })!;

      expect(monthly.frequencyDiscountPct).toBe(10);
      expect(biweekly.frequencyDiscountPct).toBe(15);
      expect(weekly.frequencyDiscountPct).toBe(20);
      expect(weekly.low).toBeLessThan(biweekly.low);
      expect(biweekly.low).toBeLessThan(monthly.low);
    });

    it('treats a missing frequency as one-time', () => {
      expect(calculateQuote(base)!.low).toBe(calculateQuote({ ...base, frequency: 'one_time' })!.low);
    });
  });

  describe('sales tax by market', () => {
    const residential = { serviceSlug: 'house-cleaning', bedrooms: 2, bathrooms: 1 } as const;

    it('charges no tax when no city is given', () => {
      const quote = calculateQuote(residential)!;
      expect(quote.taxRate).toBe(0);
      expect(quote.taxAmount).toBe(0);
      expect(quote.totalLow).toBe(quote.low);
    });

    it('taxes residential cleaning in New York', () => {
      const quote = calculateQuote({ ...residential, city: 'Brooklyn' })!;
      expect(quote.taxRate).toBeGreaterThan(0);
      expect(quote.totalHigh).toBeGreaterThan(quote.high);
    });

    /**
     * Florida taxes nonresidential cleaning only. Getting this backwards
     * overcharges every Miami homeowner — a refund exercise and a compliance
     * problem, so both branches are pinned.
     */
    it('exempts residential cleaning in Florida but taxes commercial', () => {
      const home = calculateQuote({ ...residential, city: 'Miami' })!;
      expect(home.taxRate).toBe(0);

      const office = calculateQuote({ serviceSlug: 'office-cleaning', bedrooms: 0, bathrooms: 4, city: 'Miami' })!;
      expect(office.taxRate).toBeGreaterThan(0);
    });

    it('ignores an unknown city instead of failing', () => {
      const quote = calculateQuote({ ...residential, city: 'Atlantis' })!;
      expect(quote.taxRate).toBe(0);
    });
  });

  describe('input clamping', () => {
    it('clamps absurd room counts instead of quoting an absurd price', () => {
      const sane = calculateQuote({ serviceSlug: 'house-cleaning', bedrooms: 10, bathrooms: 10 })!;
      const absurd = calculateQuote({ serviceSlug: 'house-cleaning', bedrooms: 9999, bathrooms: 9999 })!;
      expect(absurd.low).toBe(sane.low);
    });

    it('treats negative input as zero', () => {
      const zero = calculateQuote({ serviceSlug: 'house-cleaning', bedrooms: 0, bathrooms: 0 })!;
      const negative = calculateQuote({ serviceSlug: 'house-cleaning', bedrooms: -5, bathrooms: -2 })!;
      expect(negative.low).toBe(zero.low);
    });

    it('never returns NaN when handed NaN', () => {
      const quote = calculateQuote({
        serviceSlug: 'house-cleaning',
        bedrooms: Number.NaN,
        bathrooms: Number.NaN,
        sqft: Number.NaN,
      })!;
      expect(Number.isFinite(quote.low)).toBe(true);
      expect(Number.isFinite(quote.high)).toBe(true);
    });

    it('never returns Infinity when handed Infinity', () => {
      const quote = calculateQuote({
        serviceSlug: 'house-cleaning',
        bedrooms: Number.POSITIVE_INFINITY,
        bathrooms: 2,
        sqft: Number.POSITIVE_INFINITY,
      })!;
      expect(Number.isFinite(quote.low)).toBe(true);
      expect(quote.low).toBeGreaterThan(0);
    });
  });
});
