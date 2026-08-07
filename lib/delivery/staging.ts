import type { CourierState, LatLng, MerchantProfile } from './types';
import { estimateTravelMinutes } from './geo';
import { mean, round1, shrink } from './stats';

/**
 * Strategic points — where a courier should be when they are not carrying
 * anything.
 *
 * The idle gap has two halves. Standing at a counter is one; riding across
 * town to the next pickup is the other, and it is the half nobody optimizes.
 * A courier who ends a drop in a dead zone pays five minutes to get back to
 * where work exists — every time, all shift.
 *
 * The fix is not a heat map for its own sake. It is a single answer to a single
 * question, delivered the moment a courier is about to be free: *given where
 * you'll be in three minutes, where should you go?* The answer weighs how much
 * demand a spot can reach against how long it takes to get there.
 */

/** Orders that came out of one merchant in one weekday-hour. */
export interface DemandSample {
  merchantId: string;
  weekday: number;
  hour: number;
  orders: number;
}

/**
 * Expected orders per hour from a merchant at a given time. Hierarchical, same
 * shape as the prep model: this weekday-hour → this hour any day → overall.
 */
export function expectedOrdersPerHour(
  merchantId: string,
  weekday: number,
  hour: number,
  samples: DemandSample[],
): number {
  const mine = samples.filter((s) => s.merchantId === merchantId);
  if (mine.length === 0) return 0;

  const overall = mean(mine.map((s) => s.orders));
  const sameHour = mine.filter((s) => Math.abs(s.hour - hour) <= 1).map((s) => s.orders);
  const hourLevel = shrink(overall, sameHour, 3);
  const bucket = mine.filter((s) => s.weekday === weekday && Math.abs(s.hour - hour) <= 1).map((s) => s.orders);
  return shrink(hourLevel, bucket, 2);
}

export interface StagingSuggestion {
  merchantId: string;
  label: string;
  location: LatLng;
  minutesAway: number;
  /** Orders this spot is expected to produce in the horizon window. */
  expectedOrders: number;
  /**
   * Expected orders reachable per minute of repositioning — the thing being
   * maximized. Sitting on top of a slow merchant beats a five-minute ride to a
   * busy one only when the demand gap is big enough to pay for the ride.
   */
  score: number;
  reason: string;
}

export interface StagingOptions {
  now?: Date;
  /** How far ahead to count demand. */
  horizonMinutes?: number;
  /** Don't suggest a reposition longer than this. */
  maxMinutesAway?: number;
  /** Ignore merchants that produce essentially nothing. */
  minExpectedOrders?: number;
}

export function suggestStaging(
  courier: CourierState,
  merchants: MerchantProfile[],
  demand: DemandSample[],
  opts: StagingOptions = {},
): StagingSuggestion[] {
  const now = opts.now ?? new Date();
  const horizon = opts.horizonMinutes ?? 30;
  const maxAway = opts.maxMinutesAway ?? 8;
  const minOrders = opts.minExpectedOrders ?? 0.25;

  // Where the courier will actually be when they are free, not where they are.
  const from = courier.freeAt ?? courier.location;
  const at = new Date(now.getTime() + courier.freeInMinutes * 60000);

  return merchants
    .map((m) => {
      const perHour = expectedOrdersPerHour(m.id, at.getDay(), at.getHours(), demand);
      const expectedOrders = (perHour * horizon) / 60;
      const minutesAway = estimateTravelMinutes(from, m.location, courier.mode, {
        hour: at.getHours(),
        paceFactor: courier.paceFactor,
      });
      // +2 in the denominator so a spot one minute away isn't scored as
      // infinitely better than one two minutes away.
      const score = expectedOrders / (minutesAway + 2);
      return {
        merchantId: m.id,
        label: m.name,
        location: m.location,
        minutesAway: round1(minutesAway),
        expectedOrders: round1(expectedOrders),
        score: Math.round(score * 1000) / 1000,
        reason: `${round1(expectedOrders)} orders expected in the next ${horizon} min, ${round1(minutesAway)} min away`,
      };
    })
    .filter((s) => s.minutesAway <= maxAway && s.expectedOrders >= minOrders)
    .sort((a, b) => b.score - a.score);
}

/**
 * The pre-assignment: an order that will be ready right around when this
 * courier finishes. This is the mechanism that removes the idle gap entirely —
 * the next job is in hand before the current one ends, so there is no moment
 * of "what now?".
 */
export interface HandoffMatch {
  ref: string;
  merchantId: string;
  merchantName: string;
  /** Minutes from now until the courier is free. */
  freeInMinutes: number;
  /** Minutes from now until they could be at the merchant. */
  arriveInMinutes: number;
  /** Minutes from now until the order is ready. */
  readyInMinutes: number;
  /** Negative = the courier waits; positive = the order waits. */
  slackMinutes: number;
  quality: 'perfect' | 'good' | 'poor';
}

export function rateHandoff(input: {
  ref: string;
  merchantId: string;
  merchantName: string;
  freeInMinutes: number;
  travelMinutes: number;
  readyInMinutes: number;
}): HandoffMatch {
  const arriveInMinutes = round1(input.freeInMinutes + input.travelMinutes);
  const slack = round1(input.readyInMinutes - arriveInMinutes);
  return {
    ref: input.ref,
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    freeInMinutes: round1(input.freeInMinutes),
    arriveInMinutes,
    readyInMinutes: round1(input.readyInMinutes),
    slackMinutes: slack,
    // Slightly early is ideal: the order is warm and nobody waits long.
    quality: slack >= -1 && slack <= 3 ? 'perfect' : slack > 3 && slack <= 8 ? 'good' : 'poor',
  };
}
