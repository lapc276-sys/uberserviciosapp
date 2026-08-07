import type { JobEstimate } from './types';
import { clamp, round1 } from './stats';

/**
 * Delivery Complexity Score, 0–100.
 *
 * One number for how hard a job is to *do*, deliberately separate from what it
 * pays. Keeping them apart is the point: a $7 job that scores 81 is worse
 * business than a $6 job that scores 18, and no amount of staring at the fee
 * reveals that.
 *
 * The score is a weighted sum where each factor has a ceiling — the minutes at
 * which that factor is as bad as it gets — and the ceilings add to 100. That
 * makes it explainable: every point on the score can be traced to a component
 * of real time, which is what lets you show a courier *why* a job scored what
 * it did instead of asking them to trust a black box.
 */

export interface ComplexityFactor {
  key: string;
  label: string;
  /** Points contributed, 0–max. */
  points: number;
  max: number;
  /** The minutes behind those points. */
  minutes: number;
  note?: string;
}

export interface ComplexityResult {
  score: number;
  factors: ComplexityFactor[];
  /** The single worst contributor — what to tell a dispatcher in five words. */
  headline: string;
}

/**
 * Factor ceilings: [max points, minutes at which the factor is maxed out].
 * These weights encode a judgement — waiting on a merchant is the most
 * destructive single thing that happens to a courier's hour, so it carries the
 * most weight per minute.
 */
const FACTORS: { key: string; label: string; max: number; refMinutes: number; components: (keyof JobEstimate['components'])[] }[] = [
  { key: 'prep_wait', label: 'Waiting on the merchant', max: 20, refMinutes: 15, components: ['prep_wait'] },
  { key: 'line_haul', label: 'Distance to the customer', max: 16, refMinutes: 14, components: ['line_haul'] },
  { key: 'vertical', label: 'Floors', max: 14, refMinutes: 4, components: ['vertical'] },
  { key: 'to_merchant', label: 'Distance to the pickup', max: 12, refMinutes: 10, components: ['to_merchant'] },
  { key: 'merchant_ops', label: 'Pickup overhead', max: 12, refMinutes: 6, components: ['merchant_park', 'merchant_counter'] },
  { key: 'building', label: 'Building access', max: 10, refMinutes: 2.5, components: ['building_entry', 'walk'] },
  { key: 'parking', label: 'Parking at the drop', max: 8, refMinutes: 3, components: ['dropoff_park'] },
  { key: 'handoff', label: 'Handoff', max: 8, refMinutes: 1.5, components: ['handoff'] },
];

export function complexityScore(estimate: JobEstimate): ComplexityResult {
  const factors: ComplexityFactor[] = FACTORS.map((f) => {
    const minutes = f.components.reduce((s, c) => s + estimate.components[c], 0);
    // Linear up to the ceiling: half the reference minutes is half the points.
    // Deliberately the most boring possible response curve — a score a courier
    // can reproduce in their head is a score they will believe.
    const points = f.max * clamp(minutes / f.refMinutes, 0, 1);
    return { key: f.key, label: f.label, points: round1(points), max: f.max, minutes: round1(minutes) };
  });

  const score = Math.round(clamp(factors.reduce((s, f) => s + f.points, 0), 0, 100));
  const worst = [...factors].sort((a, b) => b.points - a.points)[0];

  return {
    score,
    factors: factors.sort((a, b) => b.points - a.points),
    headline: worst && worst.points >= 4 ? `${worst.label} — ${worst.minutes} min` : 'Clean job, nothing unusual',
  };
}

/**
 * What a courier should earn per minute for the platform to be worth their
 * time. Everything downstream — pay, batching, assignment — is judged against
 * this number, so it belongs in one place.
 *
 * $0.42/min ≈ $25/hour of *engaged* time, before vehicle costs. Set it by
 * market; a courier who cannot beat their alternative will simply stop
 * accepting, and an empty fleet is the most expensive state a marketplace has.
 */
export const TARGET_DOLLARS_PER_MINUTE = 0.42;

export type JobVerdict = 'great' | 'fair' | 'poor';

export interface JobAppraisal {
  complexity: ComplexityResult;
  dollarsPerMinute: number;
  dollarsPerHour: number;
  verdict: JobVerdict;
  /** Dollars this job *should* pay to clear the target, given its real cost. */
  fairPay: number;
  /** Positive = underpaid for the work it contains. */
  payGap: number;
}

export function appraise(estimate: JobEstimate, payout: number, tip = 0): JobAppraisal {
  const complexity = complexityScore(estimate);
  const dpm = estimate.dollarsPerMinute;
  const fairPay = Math.round(TARGET_DOLLARS_PER_MINUTE * estimate.totalMinutes * 100) / 100;

  return {
    complexity,
    dollarsPerMinute: dpm,
    dollarsPerHour: Math.round(dpm * 60 * 100) / 100,
    verdict: dpm >= TARGET_DOLLARS_PER_MINUTE * 1.15 ? 'great' : dpm >= TARGET_DOLLARS_PER_MINUTE * 0.9 ? 'fair' : 'poor',
    fairPay,
    payGap: Math.round((fairPay - (payout + tip)) * 100) / 100,
  };
}
