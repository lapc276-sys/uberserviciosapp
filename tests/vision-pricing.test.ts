import { describe, it, expect } from 'vitest';
import { buildAnalysis } from '@/lib/vision/estimate';
import {
  priceFromAnalysis,
  HOURLY_RATE_USD,
  MINIMUM_JOB_USD,
  PRO_PAYOUT_SHARE,
  PAYMENT_FEE_PCT,
  PAYMENT_FEE_FIXED_USD,
  TECH_COST_PER_JOB_USD,
} from '@/lib/vision/pricing';
import { ROOM_BASE_MINUTES, SERVICE_TIME_MULTIPLIER } from '@/lib/vision/model';
import { EMPTY_SOIL, type RawRoomObservation, type SoilScores } from '@/lib/vision/types';

/**
 * The vision pricing path: observations → minutes → dollars.
 *
 * These tests pin the *shape* of the model — that grease costs more in a
 * kitchen than a bedroom, that confidence widens the band, that the arithmetic
 * balances — not the specific constants. The constants are an uncalibrated
 * hypothesis and are expected to move once field data arrives; asserting their
 * exact values would make every calibration a test failure.
 */

function room(type: RawRoomObservation['type'], soil: Partial<SoilScores> = {}, confidence = 0.9): RawRoomObservation {
  return { type, confidence, objects: [], soil: { ...EMPTY_SOIL, ...soil } };
}

const analyze = (rooms: RawRoomObservation[], serviceSlug = 'house-cleaning') =>
  buildAnalysis(rooms, { serviceSlug, source: 'vision-llm' });

describe('buildAnalysis — the time model', () => {
  it('charges the configured base minutes for a spotless room', () => {
    const analysis = analyze([room('bedroom')]);
    expect(analysis.rooms[0].estimatedMinutes).toBe(ROOM_BASE_MINUTES.bedroom);
  });

  it('adds time as soil rises', () => {
    const clean = analyze([room('kitchen')]).totalMinutes;
    const dirty = analyze([room('kitchen', { grease: 100 })]).totalMinutes;
    expect(dirty).toBeGreaterThan(clean);
  });

  /**
   * The central premise of the room-specific weights: the same grease score
   * must not cost the same time everywhere, or the whole per-room weighting is
   * decoration.
   */
  it('weights grease far more heavily in a kitchen than a bedroom', () => {
    const kitchenCost = analyze([room('kitchen', { grease: 100 })]).totalMinutes - ROOM_BASE_MINUTES.kitchen;
    const bedroomCost = analyze([room('bedroom', { grease: 100 })]).totalMinutes - ROOM_BASE_MINUTES.bedroom;
    expect(kitchenCost).toBeGreaterThan(bedroomCost * 2);
  });

  it('weights mold most heavily in a bathroom', () => {
    const bathroom = analyze([room('bathroom', { mold: 100 })]).totalMinutes - ROOM_BASE_MINUTES.bathroom;
    const bedroom = analyze([room('bedroom', { mold: 100 })]).totalMinutes - ROOM_BASE_MINUTES.bedroom;
    expect(bathroom).toBeGreaterThan(bedroom);
  });

  it('discounts object time by detection confidence, so a shaky guess cannot inflate the bill', () => {
    const sure = buildAnalysis(
      [{ type: 'kitchen', confidence: 0.9, soil: EMPTY_SOIL, objects: [{ name: 'oven', count: 1, confidence: 1 }] }],
      { serviceSlug: 'house-cleaning', source: 'vision-llm' },
    );
    const unsure = buildAnalysis(
      [{ type: 'kitchen', confidence: 0.9, soil: EMPTY_SOIL, objects: [{ name: 'oven', count: 1, confidence: 0.3 }] }],
      { serviceSlug: 'house-cleaning', source: 'vision-llm' },
    );
    expect(unsure.totalMinutes).toBeLessThan(sure.totalMinutes);
  });

  it('ignores objects it has no time cost for', () => {
    const withUnknown = buildAnalysis(
      [
        {
          type: 'bedroom',
          confidence: 0.9,
          soil: EMPTY_SOIL,
          objects: [{ name: 'houseplant named kevin', count: 3, confidence: 1 }],
        },
      ],
      { serviceSlug: 'house-cleaning', source: 'vision-llm' },
    );
    expect(withUnknown.totalMinutes).toBe(ROOM_BASE_MINUTES.bedroom);
  });

  it('scales total time by the service multiplier', () => {
    const standard = analyze([room('kitchen'), room('bathroom')], 'house-cleaning').totalMinutes;
    const deep = analyze([room('kitchen'), room('bathroom')], 'deep-cleaning').totalMinutes;
    expect(deep).toBeGreaterThan(standard);
    expect(deep / standard).toBeCloseTo(SERVICE_TIME_MULTIPLIER['deep-cleaning'], 1);
  });

  it('labels repeated rooms so a customer can tell them apart', () => {
    const analysis = analyze([room('bedroom'), room('bedroom'), room('kitchen')]);
    const labels = analysis.rooms.map((r) => r.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels.filter((l) => l.startsWith('Bedroom'))).toHaveLength(2);
  });

  it('clamps out-of-range soil scores instead of trusting the model', () => {
    const analysis = analyze([room('kitchen', { grease: 9000, dust: -50 } as Partial<SoilScores>)]);
    expect(analysis.rooms[0].soil.grease).toBe(100);
    expect(analysis.rooms[0].soil.dust).toBe(0);
  });

  it('recommends more than one pro for a very long job', () => {
    const many = Array.from({ length: 12 }, () => room('bedroom', { clutter: 90, dust: 80 }));
    expect(analyze(many).recommendedPros).toBeGreaterThan(1);
  });

  it('produces a worse condition rating as soil rises', () => {
    const clean = analyze([room('living_room')]).condition;
    const filthy = analyze([
      room('living_room', { dust: 95, stains: 95, clutter: 95, trash: 90, hair: 90 }),
    ]).condition;
    expect(clean).not.toBe(filthy);
    expect(['poor', 'very_poor']).toContain(filthy);
  });
});

describe('priceFromAnalysis', () => {
  const smallJob = analyze([room('bathroom')]);
  const bigJob = analyze([
    room('kitchen', { grease: 80, stains: 60 }),
    room('bathroom', { mold: 70 }),
    room('bedroom', { clutter: 50 }),
    room('living_room', { dust: 60 }),
  ]);

  it('never quotes below the job minimum', () => {
    const quote = priceFromAnalysis(smallJob, { serviceSlug: 'house-cleaning' });
    // The band is centered on the minimum; the midpoint is what must hold.
    expect((quote.low + quote.high) / 2).toBeGreaterThanOrEqual(MINIMUM_JOB_USD);
  });

  it('prices long jobs at the hourly rate', () => {
    const quote = priceFromAnalysis(bigJob, { serviceSlug: 'house-cleaning' });
    const expected = (bigJob.totalMinutes / 60) * HOURLY_RATE_USD;
    expect((quote.low + quote.high) / 2).toBeCloseTo(expected, 0);
  });

  /**
   * The commercial point of the confidence band: a bad walkthrough must quote a
   * wider range, not a confidently wrong number.
   */
  it('widens the band when confidence is low', () => {
    const confident = priceFromAnalysis({ ...bigJob, confidence: 0.95 }, { serviceSlug: 'house-cleaning' });
    const shaky = priceFromAnalysis({ ...bigJob, confidence: 0.2 }, { serviceSlug: 'house-cleaning' });
    expect(shaky.high - shaky.low).toBeGreaterThan(confident.high - confident.low);
  });

  it('is deterministic', () => {
    const opts = { serviceSlug: 'house-cleaning', city: 'Brooklyn' };
    expect(priceFromAnalysis(bigJob, opts)).toEqual(priceFromAnalysis(bigJob, opts));
  });

  it('applies market sales tax on top of the pre-tax range', () => {
    const untaxed = priceFromAnalysis(bigJob, { serviceSlug: 'house-cleaning' });
    const ny = priceFromAnalysis(bigJob, { serviceSlug: 'house-cleaning', city: 'Manhattan' });
    expect(untaxed.taxRate).toBe(0);
    expect(ny.taxRate).toBeGreaterThan(0);
    expect(ny.totalHigh).toBeGreaterThan(ny.high);
  });

  describe('margin arithmetic', () => {
    const quote = priceFromAnalysis(bigJob, { serviceSlug: 'house-cleaning', city: 'Brooklyn' });
    const midpoint = (quote.low + quote.high) / 2;

    it('pays the pro the configured share', () => {
      expect(quote.proPayout).toBe(Math.round(midpoint * PRO_PAYOUT_SHARE));
    });

    it('charges processing on the tax-inclusive total, since the processor takes its cut of tax too', () => {
      const collected = midpoint * (1 + quote.taxRate);
      expect(quote.paymentFee).toBeCloseTo(collected * PAYMENT_FEE_PCT + PAYMENT_FEE_FIXED_USD, 2);
    });

    it('counts the per-job technology cost', () => {
      expect(quote.techCost).toBe(TECH_COST_PER_JOB_USD);
    });

    /** The whole reason for computing margin in code: it has to actually balance. */
    it('balances: margin equals revenue minus every cost', () => {
      const costs = quote.proPayout + quote.supplyCost + quote.paymentFee + quote.techCost;
      expect(quote.platformMargin).toBeCloseTo(midpoint - costs, 2);
    });

    it('reports a margin lower than the naive 25% left after the pro', () => {
      expect(quote.marginPct).toBeLessThan((1 - PRO_PAYOUT_SHARE) * 100);
      expect(quote.marginPct).toBeGreaterThan(0);
    });

    it('excludes reusable tools from supply cost — they are capital, not per-job', () => {
      const toolLines = (bigJob.supplyPlan?.lines ?? []).filter((l) => l.category === 'tool');
      const consumables = (bigJob.supplyPlan?.lines ?? [])
        .filter((l) => l.category !== 'tool')
        .reduce((sum, l) => sum + l.estimatedCost, 0);
      expect(toolLines.length).toBeGreaterThan(0);
      expect(quote.supplyCost).toBe(Math.round(consumables));
    });
  });
});
