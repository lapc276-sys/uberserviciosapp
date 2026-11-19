import type { TidyingCounts } from './types';
import { depthChoiceFor, type DepthChoices } from './model';

/**
 * Putting things away, counted instead of scored.
 *
 * Clutter used to be one soil dimension, 0–100, weighted into at most a dozen
 * minutes a room. That has two faults and they compound. A score saturates:
 * "messy" and "you cannot see the floor" both land near the top, and the
 * second takes an hour. And a score has no idea where things go — a sock on
 * a bedroom floor is a bend, a sock in the kitchen is a walk to the bedroom
 * and back. Meanwhile a sink full of pots was not anywhere at all: the
 * catalogue had a dish rack and nothing to wash in it.
 *
 * So the model now counts, and this file turns counts into minutes. Counting
 * is something a vision model does tolerably; judging how long tidying takes
 * is not, which is the same split as every other number in this engine.
 *
 * Three kinds of work, deliberately priced differently:
 *
 *   clearing   Moving what is on the floor and the counters so they can be
 *              cleaned at all. Always charged: nobody mops around forty socks.
 *   putting    Carrying things that belong in another room to that room.
 *   away       Asked, never assumed — deciding where somebody's belongings
 *              live is not a cleaner's call to make for them.
 *   dishes     Washing what is in the sink. Asked: plenty of cleaning
 *              companies do not do dishes at all, and it is a different job.
 *
 * Per-item times come from MOST (Maynard Operation Sequence Technique), the
 * industrial work-measurement standard. Its worked pick-and-place sequence —
 * walk, bend and arise, grasp, carry, place — comes to about ten seconds.
 * That was measured on factory workers, not on cleaners in a Brooklyn
 * walk-up, so every figure here is a HYPOTHESIS with a better starting point
 * than a guess, and the same rule as model.ts applies: correct it with the
 * job timer, never from a handful of jobs.
 */

/** Seconds per item. See above — hypotheses, not measurements. */
export const TIDY_SECONDS = {
  /** MOST pick-and-place with a bend: about ten seconds. */
  clear: 10,
  /**
   * The extra walk to another room. Less than a full round trip per item,
   * because nobody carries one sock at a time — things bound for the same
   * room travel together.
   */
  elsewhere: 15,
  /**
   * Hand-washing one item. The widest guess in the file: a mug is ten
   * seconds and a pan with burnt grease is three minutes. A mixed sink
   * averages somewhere near here.
   */
  dish: 40,
} as const;

/**
 * Ceilings on what a count may claim.
 *
 * A model asked to count will occasionally answer 400. These keep one bad
 * reply from becoming a three-hour surcharge, and they sit well above a
 * genuinely chaotic room so they never bite on a real one.
 */
export const TIDY_COUNT_CAP = {
  toClear: 150,
  elsewhere: 80,
  dishes: 60,
} as const;

/** Below these, the work is not worth interrupting somebody to ask about. */
export const ASK_PUT_AWAY_AT = 5;
export const ASK_DISHES_AT = 6;

/** The answer keys these questions are recorded under. */
export const PUT_AWAY = 'declutter';
export const DISHES = 'dishes';

function clamp(n: unknown, cap: number): number {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(Math.round(value), cap));
}

/**
 * The counts a model is allowed to report, made safe.
 *
 * `elsewhere` is a subset of `toClear` — a sock that belongs in the bedroom
 * still has to be picked up off the kitchen floor first — so it is clamped to
 * it. A reply claiming forty things belong elsewhere out of ten on the floor
 * is a model contradicting itself, and the smaller number is the one that
 * cannot overcharge.
 */
export function coerceTidying(raw: unknown): TidyingCounts | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const toClear = clamp(r.toClear, TIDY_COUNT_CAP.toClear);
  const elsewhere = Math.min(clamp(r.elsewhere, TIDY_COUNT_CAP.elsewhere), toClear);
  const dishes = clamp(r.dishes, TIDY_COUNT_CAP.dishes);
  if (toClear === 0 && dishes === 0) return { toClear: 0, elsewhere: 0, dishes: 0 };
  return { toClear, elsewhere, dishes };
}

export interface TidyingMinutes {
  clearing: number;
  puttingAway: number;
  dishes: number;
  total: number;
}

/**
 * Minutes of tidying in one room, given what the customer agreed to.
 *
 * Optional work defaults to NOT charged. If nobody was asked — the scout
 * failed in a basement, or an old client never sent answers — a sink of
 * pots does not quietly become twenty minutes on somebody's bill.
 */
export function tidyingMinutes(
  counts: TidyingCounts | undefined,
  roomType: string,
  choices?: DepthChoices,
): TidyingMinutes {
  if (!counts) return { clearing: 0, puttingAway: 0, dishes: 0, total: 0 };

  const wantsPutAway = depthChoiceFor(PUT_AWAY, roomType, choices) === 'deep';
  const wantsDishes = depthChoiceFor(DISHES, roomType, choices) === 'deep';

  const clearing = (counts.toClear * TIDY_SECONDS.clear) / 60;
  const puttingAway = wantsPutAway ? (counts.elsewhere * TIDY_SECONDS.elsewhere) / 60 : 0;
  const dishes = wantsDishes ? (counts.dishes * TIDY_SECONDS.dish) / 60 : 0;

  return { clearing, puttingAway, dishes, total: clearing + puttingAway + dishes };
}

/** What a yes to putting things away would add, for the question itself. */
export function putAwayMinutes(counts: TidyingCounts): number {
  return (counts.elsewhere * TIDY_SECONDS.elsewhere) / 60;
}

/** What a yes to the dishes would add, for the question itself. */
export function dishesMinutes(counts: TidyingCounts): number {
  return (counts.dishes * TIDY_SECONDS.dish) / 60;
}
