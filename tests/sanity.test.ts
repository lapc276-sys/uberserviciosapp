import { describe, it, expect } from 'vitest';
import { sanityCheckEstimate, SANITY_HIGH_RATIO, SANITY_LOW_RATIO } from '@/lib/vision/sanity';
import { buildAnalysis } from '@/lib/vision/estimate';
import { calculateQuote } from '@/lib/quote';
import { EMPTY_SOIL, type RawRoomObservation, type RoomType } from '@/lib/vision/types';

const home = (types: RoomType[]): RawRoomObservation[] =>
  types.map((type) => ({ type, confidence: 0.9, soil: { ...EMPTY_SOIL }, objects: [] }));

const analysisOf = (types: RoomType[]) =>
  buildAnalysis(home(types), { serviceSlug: 'house-cleaning', source: 'vision-llm' });

/** The questionnaire's own midpoint for the same home, for building test cases. */
function reference(bedrooms: number, bathrooms: number): number {
  const q = calculateQuote({ serviceSlug: 'house-cleaning', bedrooms, bathrooms })!;
  return (q.low + q.high) / 2;
}

describe('sanityCheckEstimate', () => {
  const twoBedTwoBath: RoomType[] = ['kitchen', 'living_room', 'bedroom', 'bedroom', 'bathroom', 'bathroom'];
  const analysis = analysisOf(twoBedTwoBath);
  const mid = reference(2, 2);

  const check = (low: number, high: number, rooms = analysis) =>
    sanityCheckEstimate(rooms, { serviceSlug: 'house-cleaning', low, high });

  it('accepts an estimate in the same neighbourhood as the questionnaire', () => {
    const result = check(mid * 0.9, mid * 1.1);
    expect(result.ok).toBe(true);
    expect(result.warningEs).toBeNull();
  });

  /**
   * The questionnaire cannot see that a kitchen is coated in grease, so a
   * genuinely filthy home *should* price well above it. That gap is the product
   * working, and flagging it would train everyone to ignore the warning.
   */
  it('accepts a filthy home pricing well above the questionnaire', () => {
    expect(check(mid * 2, mid * 2.2).ok).toBe(true);
  });

  /**
   * The failure this exists for: a dark or misread walkthrough graded every
   * room as filthy and quoted nine hours for a small apartment. It does not
   * error — it produces a confident number, which is worse.
   */
  it('flags an estimate several times the questionnaire', () => {
    const result = check(mid * SANITY_HIGH_RATIO * 1.3, mid * SANITY_HIGH_RATIO * 1.5);
    expect(result.ok).toBe(false);
    expect(result.warningEs).toMatch(/más alto de lo normal/i);
    expect(result.warning).toMatch(/higher than usual/i);
  });

  it('flags an estimate far below the questionnaire, which usually means rooms were missed', () => {
    const result = check(mid * SANITY_LOW_RATIO * 0.5, mid * SANITY_LOW_RATIO * 0.6);
    expect(result.ok).toBe(false);
    expect(result.warningEs).toMatch(/más bajo de lo normal/i);
  });

  it('reports the reference and the ratio, so the admin can see why', () => {
    const result = check(mid * 4, mid * 4);
    expect(result.reference).toBeGreaterThan(0);
    expect(result.ratio).toBeGreaterThan(SANITY_HIGH_RATIO);
  });

  it('warns in both languages or neither', () => {
    const flagged = check(mid * 5, mid * 5);
    expect(Boolean(flagged.warningEs)).toBe(Boolean(flagged.warning));
    const fine = check(mid, mid);
    expect(fine.warningEs).toBeNull();
    expect(fine.warning).toBeNull();
  });

  describe('when there is nothing to compare against', () => {
    /**
     * A garage-only or patio-only job is legitimately outside what the
     * questionnaire models. Inventing a reference for it would produce a
     * warning on a perfectly good quote.
     */
    it('stays quiet with no bedrooms or bathrooms', () => {
      const garage = analysisOf(['garage', 'patio']);
      const result = sanityCheckEstimate(garage, { serviceSlug: 'house-cleaning', low: 9999, high: 99999 });
      expect(result.ok).toBe(true);
      expect(result.warningEs).toBeNull();
      expect(result.reference).toBeNull();
    });

    it('stays quiet for a service the questionnaire does not know', () => {
      const result = sanityCheckEstimate(analysis, { serviceSlug: 'not-a-service', low: 99999, high: 99999 });
      expect(result.ok).toBe(true);
      expect(result.reference).toBeNull();
    });
  });

  it('counts bedrooms and bathrooms from the rooms actually walked', () => {
    const small = sanityCheckEstimate(analysisOf(['kitchen', 'bedroom', 'bathroom']), {
      serviceSlug: 'house-cleaning',
      low: 100,
      high: 100,
    });
    const large = sanityCheckEstimate(analysisOf(['kitchen', 'bedroom', 'bedroom', 'bedroom', 'bathroom', 'bathroom']), {
      serviceSlug: 'house-cleaning',
      low: 100,
      high: 100,
    });
    expect(large.reference!).toBeGreaterThan(small.reference!);
  });

  it('leaves room between the two thresholds', () => {
    expect(SANITY_LOW_RATIO).toBeLessThan(1);
    expect(SANITY_HIGH_RATIO).toBeGreaterThan(1);
  });
});
