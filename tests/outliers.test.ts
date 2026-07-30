import { describe, it, expect } from 'vitest';
import {
  classifySample,
  buildCalibrationSet,
  exclusionWarning,
  EXCLUSION_RATE_ALARM,
} from '@/lib/vision/outliers';

const sample = (predictedMinutes: number, actualMinutes: number) => ({ predictedMinutes, actualMinutes });

describe('classifySample', () => {
  it('accepts a job that landed near the estimate', () => {
    expect(classifySample(sample(120, 130)).verdict).toBe('ok');
  });

  /**
   * Wide bounds on purpose. The model is uncalibrated, so a job taking twice as
   * long is precisely the error being measured — screening it out would hide
   * the very signal calibration exists to find.
   */
  it('keeps a job that took twice the estimate', () => {
    expect(classifySample(sample(120, 240)).verdict).toBe('ok');
  });

  it('keeps a job that took half the estimate', () => {
    expect(classifySample(sample(120, 60)).verdict).toBe('ok');
  });

  it('rejects a job past three times the estimate as something that happened to the job', () => {
    const result = classifySample(sample(60, 300));
    expect(result.verdict).toBe('ran_long');
    expect(result.reason).toMatch(/×/);
  });

  it('rejects a job far under the estimate', () => {
    expect(classifySample(sample(300, 30)).verdict).toBe('ran_short');
  });

  it('rejects a duration no visit could have', () => {
    expect(classifySample(sample(120, 0)).verdict).toBe('implausible');
    expect(classifySample(sample(120, 2)).verdict).toBe('implausible');
    expect(classifySample(sample(120, 900)).verdict).toBe('implausible');
  });

  it('rejects rather than divides by a missing prediction', () => {
    expect(classifySample(sample(0, 120)).verdict).toBe('implausible');
  });

  it('survives NaN', () => {
    expect(classifySample(sample(120, Number.NaN)).verdict).toBe('implausible');
  });

  it('reports the ratio so the admin can show what happened', () => {
    expect(classifySample(sample(100, 150)).ratio).toBeCloseTo(1.5, 2);
  });
});

describe('buildCalibrationSet', () => {
  it('splits usable from rejected', () => {
    const set = buildCalibrationSet([sample(120, 130), sample(60, 600), sample(100, 110)]);
    expect(set.used).toHaveLength(2);
    expect(set.excluded).toHaveLength(1);
  });

  it('weights by job size, so a long job counts for more than a short one', () => {
    // One six-hour job an hour over, one twenty-minute job five minutes over.
    const set = buildCalibrationSet([sample(360, 420), sample(20, 25)]);
    // Size-weighted: 445/380 ≈ 1.17. A mean of ratios would say ≈1.21.
    expect(set.factor).toBeCloseTo(445 / 380, 2);
  });

  it('excludes outliers before summing', () => {
    const clean = buildCalibrationSet([sample(120, 132), sample(120, 132)]);
    const withNoise = buildCalibrationSet([sample(120, 132), sample(120, 132), sample(10, 500)]);
    expect(withNoise.factor).toBeCloseTo(clean.factor, 3);
  });

  it('returns a neutral factor when nothing survives', () => {
    expect(buildCalibrationSet([sample(120, 0), sample(60, 900)]).factor).toBe(1);
  });

  it('handles an empty set', () => {
    const set = buildCalibrationSet([]);
    expect(set.factor).toBe(1);
    expect(set.exclusionRate).toBe(0);
  });

  it('reports the exclusion rate', () => {
    const set = buildCalibrationSet([sample(120, 130), sample(120, 130), sample(120, 130), sample(120, 0)]);
    expect(set.exclusionRate).toBe(25);
  });
});

describe('exclusionWarning', () => {
  it('stays quiet on a clean set', () => {
    expect(exclusionWarning(buildCalibrationSet([sample(120, 130)]))).toBeNull();
  });

  it('mentions a small number of rejects without alarm', () => {
    const set = buildCalibrationSet([...Array.from({ length: 20 }, () => sample(120, 130)), sample(120, 0)]);
    const warning = exclusionWarning(set)!;
    expect(warning).toMatch(/1 sample excluded/);
    expect(warning).not.toMatch(/capture flow/i);
  });

  /**
   * Past this rate the problem is not careless data entry — it is that the
   * pilot is asking the wrong question, or asking it at the wrong moment.
   * Calibrating harder will not fix that, so the message says so.
   */
  it('points at the capture flow when most of the data is unusable', () => {
    const set = buildCalibrationSet([
      ...Array.from({ length: 5 }, () => sample(120, 130)),
      ...Array.from({ length: 5 }, () => sample(120, 0)),
    ]);
    expect(set.exclusionRate).toBeGreaterThanOrEqual(EXCLUSION_RATE_ALARM);
    expect(exclusionWarning(set)).toMatch(/capture flow/i);
  });
});
