import type { CounterObservation, MerchantProfile, PrepObservation } from './types';
import { confidenceFromSamples, mean, percentile, round1, shrink, stdev } from './stats';

/**
 * The merchant model: how long until the order is actually ready, and how long
 * the courier stands inside once they arrive.
 *
 * These are separate costs and they behave differently. Prep wait is dead time
 * the engine can *avoid* by dispatching later; counter time is unavoidable work
 * that belongs in the price of the job. Conflating them — which every
 * distance-based system does — leads to couriers standing in a laundromat for
 * fifteen minutes while a better job goes to someone else.
 *
 * Prediction is hierarchical, most specific first:
 *   this merchant, this weekday, this hour  ← "Fridays at 8 PM"
 *     → this merchant, this hour of any day
 *       → this merchant overall
 *         → whatever the merchant claimed when they signed up
 *
 * Each level shrinks toward the one above it, so a bucket with two samples
 * doesn't get to make wild claims, but a bucket with forty does.
 */

export interface PrepPrediction {
  /** Minutes from order placement until ready. */
  minutes: number;
  /** The pessimistic case. Dispatch targets this to avoid standing around. */
  p90: number;
  basis: 'quoted' | 'merchant' | 'hour' | 'weekday_hour';
  samples: number;
  confidence: number;
  /** Standard deviation of prep time. High = unreliable = don't batch here. */
  variabilityMinutes: number;
}

/** How many observations the prior is worth at each level of the hierarchy. */
const MERCHANT_PRIOR_STRENGTH = 6;
const HOUR_PRIOR_STRENGTH = 4;
const BUCKET_PRIOR_STRENGTH = 3;

export function predictPrep(
  merchant: MerchantProfile,
  at: Date,
  observations: PrepObservation[],
): PrepPrediction {
  const mine = observations.filter((o) => o.merchantId === merchant.id);
  const hour = at.getHours();
  const weekday = at.getDay();

  const all = mine.map((o) => o.minutes);
  const sameHour = mine.filter((o) => Math.abs(o.hour - hour) <= 1).map((o) => o.minutes);
  const sameBucket = mine.filter((o) => o.weekday === weekday && Math.abs(o.hour - hour) <= 1).map((o) => o.minutes);

  const merchantLevel = shrink(merchant.quotedPrepMinutes, all, MERCHANT_PRIOR_STRENGTH);
  const hourLevel = shrink(merchantLevel, sameHour, HOUR_PRIOR_STRENGTH);
  const bucketLevel = shrink(hourLevel, sameBucket, BUCKET_PRIOR_STRENGTH);

  const basis: PrepPrediction['basis'] =
    sameBucket.length >= 3 ? 'weekday_hour' : sameHour.length >= 3 ? 'hour' : all.length >= 3 ? 'merchant' : 'quoted';

  // The spread that matters is the most specific one with enough data.
  const spreadSet = sameBucket.length >= 5 ? sameBucket : sameHour.length >= 5 ? sameHour : all;
  const variability = stdev(spreadSet);
  const p90 = spreadSet.length >= 5 ? percentile(spreadSet, 0.9) : bucketLevel * 1.5;

  return {
    minutes: round1(bucketLevel),
    p90: round1(Math.max(p90, bucketLevel)),
    basis,
    samples: mine.length,
    confidence: confidenceFromSamples(sameBucket.length * 2 + sameHour.length + all.length * 0.5, 8),
    variabilityMinutes: round1(variability),
  };
}

/**
 * Minutes from `now` until the order is ready.
 *
 * A merchant's own promise is worth something — they know what's on the line —
 * but only as much as their track record says. With no history we take their
 * word; with history the measured model takes over.
 */
export function readyInMinutes(
  merchant: MerchantProfile,
  job: { placedAt: string; promisedReadyAt?: string | null },
  observations: PrepObservation[],
  now: Date = new Date(),
): { minutes: number; prediction: PrepPrediction } {
  const placed = new Date(job.placedAt);
  const prediction = predictPrep(merchant, placed, observations);

  const elapsed = (now.getTime() - placed.getTime()) / 60000;
  let predictedTotal = prediction.minutes;

  if (job.promisedReadyAt) {
    const promised = (new Date(job.promisedReadyAt).getTime() - placed.getTime()) / 60000;
    if (Number.isFinite(promised) && promised >= 0) {
      // Weight the promise by how little we know. Full trust at zero samples,
      // almost none once the model has seen this merchant work.
      const trust = 1 - prediction.confidence;
      predictedTotal = predictedTotal * (1 - trust) + promised * trust;
    }
  }

  return { minutes: Math.max(0, predictedTotal - elapsed), prediction };
}

export interface CounterPrediction {
  minutes: number;
  samples: number;
  confidence: number;
}

/** In the door → order in hand → out. Pure overhead, and merchants differ wildly. */
export function predictCounterMinutes(
  merchant: MerchantProfile,
  observations: CounterObservation[],
): CounterPrediction {
  const mine = observations.filter((o) => o.merchantId === merchant.id).map((o) => o.seconds / 60);
  const prior = merchant.quotedCounterMinutes ?? 2.2;
  return {
    minutes: round1(shrink(prior, mine, 4)),
    samples: mine.length,
    confidence: confidenceFromSamples(mine.length, 4),
  };
}

export interface HourlyPrepRow {
  hour: number;
  weekday: number | null;
  minutes: number;
  samples: number;
}

/**
 * "This merchant takes 17 minutes on Fridays at 8 PM."
 *
 * The report that turns accumulated observations into something an operator
 * can act on — renegotiate the promise, stage a courier earlier, or stop
 * accepting orders from a merchant that cannot hold a schedule.
 */
export function prepProfile(merchantId: string, observations: PrepObservation[], weekday?: number): HourlyPrepRow[] {
  const mine = observations.filter((o) => o.merchantId === merchantId && (weekday === undefined || o.weekday === weekday));
  const byHour = new Map<number, number[]>();
  for (const o of mine) {
    const list = byHour.get(o.hour) ?? [];
    list.push(o.minutes);
    byHour.set(o.hour, list);
  }
  return [...byHour.entries()]
    .map(([hour, list]) => ({ hour, weekday: weekday ?? null, minutes: round1(mean(list)), samples: list.length }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * 0–100. High means the merchant hits its promise consistently — the
 * precondition for batching, because a batch is only as good as the readiness
 * of its slowest order.
 */
export function merchantReliability(merchantId: string, observations: PrepObservation[]): number {
  const mine = observations.filter((o) => o.merchantId === merchantId).map((o) => o.minutes);
  if (mine.length < 4) return 50; // unproven, not bad
  const m = mean(mine);
  if (m <= 0) return 50;
  const cv = stdev(mine) / m; // coefficient of variation
  return Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-2.2 * cv))));
}
