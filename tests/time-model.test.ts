import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIME_MODEL,
  ROOM_BASE_MINUTES,
  mergeTimeModel,
  scaleTimeModel,
  soilWeightsFor,
} from '@/lib/vision/model';
import { suggestCalibration, marketFor, MIN_SAMPLES_FOR_CONFIDENCE } from '@/lib/vision/time-model-store';
import { buildAnalysis } from '@/lib/vision/estimate';
import { EMPTY_SOIL, type RawRoomObservation } from '@/lib/vision/types';

const room = (type: RawRoomObservation['type'], soil = {}): RawRoomObservation => ({
  type,
  confidence: 0.9,
  objects: [],
  soil: { ...EMPTY_SOIL, ...soil },
});

/**
 * A stored config is untrusted input.
 *
 * The reason calibration lives in the database is that a human can fix a market
 * at 11pm without a deploy — which is exactly the situation where a typo gets
 * saved. Every one of these cases is a way a bad edit could otherwise reach the
 * pricing path.
 */
describe('mergeTimeModel', () => {
  it('returns the defaults for an empty config', () => {
    expect(mergeTimeModel({})).toEqual(DEFAULT_TIME_MODEL);
  });

  it('survives null and garbage instead of throwing on the money path', () => {
    expect(mergeTimeModel(null).roomBaseMinutes.kitchen).toBe(ROOM_BASE_MINUTES.kitchen);
    expect(mergeTimeModel('nonsense').minutesPerPro).toBe(DEFAULT_TIME_MODEL.minutesPerPro);
    expect(mergeTimeModel(42).roomBaseMinutes.bathroom).toBe(ROOM_BASE_MINUTES.bathroom);
  });

  it('applies the fields that are present and defaults the rest', () => {
    const merged = mergeTimeModel({ roomBaseMinutes: { kitchen: 45 } });
    expect(merged.roomBaseMinutes.kitchen).toBe(45);
    expect(merged.roomBaseMinutes.bathroom).toBe(ROOM_BASE_MINUTES.bathroom);
  });

  it('falls back per field, so one bad value cannot zero out a room', () => {
    const merged = mergeTimeModel({ roomBaseMinutes: { kitchen: -10, bathroom: 'thirty' } });
    expect(merged.roomBaseMinutes.kitchen).toBe(ROOM_BASE_MINUTES.kitchen);
    expect(merged.roomBaseMinutes.bathroom).toBe(ROOM_BASE_MINUTES.bathroom);
  });

  it('rejects NaN and Infinity', () => {
    const merged = mergeTimeModel({
      roomBaseMinutes: { kitchen: Number.NaN, bedroom: Number.POSITIVE_INFINITY },
    });
    expect(merged.roomBaseMinutes.kitchen).toBe(ROOM_BASE_MINUTES.kitchen);
    expect(Number.isFinite(merged.roomBaseMinutes.bedroom)).toBe(true);
  });

  it('caps absurd values rather than quoting a 40-hour bedroom', () => {
    expect(mergeTimeModel({ roomBaseMinutes: { bedroom: 99999 } }).roomBaseMinutes.bedroom).toBeLessThanOrEqual(240);
  });

  it('ignores unknown room types in the weight table', () => {
    const merged = mergeTimeModel({ roomSoilWeights: { dungeon: { mold: 90 } } });
    expect(merged.roomSoilWeights).not.toHaveProperty('dungeon');
  });

  it('keeps unknown object names, since a market can learn one before the catalog does', () => {
    const merged = mergeTimeModel({ objectTimeCost: { 'espresso machine': 7 } });
    expect(merged.objectTimeCost['espresso machine']).toBe(7);
    expect(merged.objectTimeCost.oven).toBe(DEFAULT_TIME_MODEL.objectTimeCost.oven);
  });

  it('merges room weights over the defaults rather than replacing the table', () => {
    const merged = mergeTimeModel({ roomSoilWeights: { kitchen: { grease: 40 } } });
    expect(soilWeightsFor('kitchen', merged).grease).toBe(40);
    // The bathroom's own weights must survive an edit that only touched kitchens.
    expect(soilWeightsFor('bathroom', merged).mold).toBe(soilWeightsFor('bathroom').mold);
  });

  it('never yields a zero minutesPerPro, which would divide by zero downstream', () => {
    expect(mergeTimeModel({ minutesPerPro: 0 }).minutesPerPro).toBeGreaterThan(0);
  });
});

describe('scaleTimeModel', () => {
  it('scales every duration by the factor', () => {
    const scaled = scaleTimeModel(DEFAULT_TIME_MODEL, 1.2);
    expect(scaled.roomBaseMinutes.kitchen).toBeCloseTo(ROOM_BASE_MINUTES.kitchen * 1.2, 1);
    expect(soilWeightsFor('kitchen', scaled).grease).toBeCloseTo(soilWeightsFor('kitchen').grease * 1.2, 1);
  });

  it('is a no-op at factor 1', () => {
    expect(scaleTimeModel(DEFAULT_TIME_MODEL, 1).roomBaseMinutes).toEqual(DEFAULT_TIME_MODEL.roomBaseMinutes);
  });

  it('clamps runaway factors, so a bad statistic cannot triple every price', () => {
    const wild = scaleTimeModel(DEFAULT_TIME_MODEL, 99);
    expect(wild.roomBaseMinutes.kitchen).toBeLessThanOrEqual(ROOM_BASE_MINUTES.kitchen * 2);

    const tiny = scaleTimeModel(DEFAULT_TIME_MODEL, 0.01);
    expect(tiny.roomBaseMinutes.kitchen).toBeGreaterThanOrEqual(ROOM_BASE_MINUTES.kitchen * 0.5);
  });

  it('leaves service multipliers alone — they are ratios, not durations', () => {
    expect(scaleTimeModel(DEFAULT_TIME_MODEL, 1.5).serviceTimeMultiplier).toEqual(
      DEFAULT_TIME_MODEL.serviceTimeMultiplier,
    );
  });
});

describe('a calibrated model actually changes the estimate', () => {
  const rooms = [room('kitchen', { grease: 60 }), room('bathroom', { mold: 40 })];

  it('quotes longer under a scaled-up model', () => {
    const baseline = buildAnalysis(rooms, { serviceSlug: 'house-cleaning', source: 'vision-llm' });
    const calibrated = buildAnalysis(rooms, {
      serviceSlug: 'house-cleaning',
      source: 'vision-llm',
      model: scaleTimeModel(DEFAULT_TIME_MODEL, 1.3),
    });
    expect(calibrated.totalMinutes).toBeGreaterThan(baseline.totalMinutes);
    expect(calibrated.totalMinutes / baseline.totalMinutes).toBeCloseTo(1.3, 1);
  });

  it('falls back to the default model when none is passed', () => {
    const explicit = buildAnalysis(rooms, {
      serviceSlug: 'house-cleaning',
      source: 'vision-llm',
      model: DEFAULT_TIME_MODEL,
    });
    const implicit = buildAnalysis(rooms, { serviceSlug: 'house-cleaning', source: 'vision-llm' });
    expect(implicit.totalMinutes).toBe(explicit.totalMinutes);
  });
});

describe('suggestCalibration', () => {
  const enough = MIN_SAMPLES_FOR_CONFIDENCE;

  it('suggests nothing without data', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, { samples: 0, predictedTotal: 0, actualTotal: 0 });
    expect(s.factor).toBe(1);
    expect(s.confident).toBe(false);
    expect(s.params).toEqual(DEFAULT_TIME_MODEL);
  });

  it('computes the factor from summed minutes, weighting long jobs more', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, {
      samples: enough,
      predictedTotal: 1000,
      actualTotal: 1200,
    });
    expect(s.factor).toBeCloseTo(1.2, 2);
    expect(s.biasPct).toBeCloseTo(20, 0);
  });

  /**
   * The guard that keeps calibration from becoming overfitting: a handful of
   * jobs cannot move the live model, however dramatic the apparent bias.
   */
  it('withholds confidence below the sample threshold', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, {
      samples: enough - 1,
      predictedTotal: 1000,
      actualTotal: 1500,
    });
    expect(s.confident).toBe(false);
    expect(s.rationale).toMatch(/noise/i);
  });

  it('withholds confidence when the bias is small enough to be noise', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, {
      samples: enough * 3,
      predictedTotal: 1000,
      actualTotal: 1020,
    });
    expect(s.confident).toBe(false);
  });

  it('is confident with enough samples and a real gap', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, {
      samples: enough,
      predictedTotal: 1000,
      actualTotal: 1250,
    });
    expect(s.confident).toBe(true);
    expect(s.rationale).toMatch(/short/i);
  });

  it('says "long" when the model overestimates', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, {
      samples: enough,
      predictedTotal: 1000,
      actualTotal: 800,
    });
    expect(s.biasPct).toBeLessThan(0);
    expect(s.rationale).toMatch(/long/i);
  });

  it('returns a usable scaled model alongside the number', () => {
    const s = suggestCalibration(DEFAULT_TIME_MODEL, {
      samples: enough,
      predictedTotal: 1000,
      actualTotal: 1200,
    });
    expect(s.params.roomBaseMinutes.kitchen).toBeCloseTo(ROOM_BASE_MINUTES.kitchen * 1.2, 1);
  });
});

describe('marketFor', () => {
  it('maps a city name to its slug', () => {
    expect(marketFor('Brooklyn')).toBe('brooklyn-ny');
  });

  it('falls back to the default market for unknown or missing cities', () => {
    expect(marketFor('Atlantis')).toBe('default');
    expect(marketFor(undefined)).toBe('default');
    expect(marketFor(null)).toBe('default');
  });
});
