import { calculateQuote } from '../quote';
import type { PropertyAnalysis, RoomType } from './types';

/**
 * A second opinion on the vision estimate.
 *
 * The questionnaire engine has been pricing real jobs since before any of this
 * existed: bedrooms, bathrooms, service, done. It knows nothing about soil, so
 * it will never be exactly right — but it is independent, and that is the whole
 * point. When two engines built on different inputs land in the same
 * neighbourhood, the vision read is probably sound. When they disagree by a
 * factor of three, something is wrong and nobody downstream can tell.
 *
 * The failures this catches are the ones that look fine:
 *
 * - A dim or blurry walkthrough the model graded as filthy, quoting nine hours
 *   for a small apartment.
 * - A demo or misconfigured analyzer returning the same heavy soil for every
 *   room.
 * - A calibration that scaled a market's minutes into nonsense.
 *
 * None of those produce an error. They produce a confident number, which is
 * worse — a customer either abandons the booking or accepts a price we cannot
 * honour, and the first anyone hears of it is the crew arriving.
 */

/** Rooms the questionnaire engine understands. Everything else it prices as 0. */
function countRooms(analysis: PropertyAnalysis): { bedrooms: number; bathrooms: number } {
  const count = (type: RoomType) => analysis.rooms.filter((r) => r.type === type).length;
  return { bedrooms: count('bedroom'), bathrooms: count('bathroom') };
}

/**
 * How far apart the two engines may land before it stops being a difference of
 * method and starts being a fault.
 *
 * Wide, deliberately. The questionnaire cannot see that a kitchen is coated in
 * grease, so a genuinely filthy home *should* price well above it — that gap is
 * the product working, not failing. Only past roughly triple is the likelier
 * explanation that something is broken.
 */
export const SANITY_HIGH_RATIO = 3;
export const SANITY_LOW_RATIO = 0.35;

export interface SanityCheck {
  ok: boolean;
  /** The questionnaire's midpoint for the same home, or null if it can't price it. */
  reference: number | null;
  visionMidpoint: number;
  ratio: number | null;
  /** Customer-facing, in both languages. Null when everything is in range. */
  warningEs: string | null;
  warning: string | null;
}

export function sanityCheckEstimate(
  analysis: PropertyAnalysis,
  opts: { serviceSlug: string; city?: string; low: number; high: number },
): SanityCheck {
  const visionMidpoint = (opts.low + opts.high) / 2;
  const { bedrooms, bathrooms } = countRooms(analysis);

  // With no bedrooms or bathrooms identified there is nothing to compare
  // against — a garage-only job is legitimately outside what the questionnaire
  // models, and inventing a reference for it would be worse than staying quiet.
  if (bedrooms === 0 && bathrooms === 0) {
    return { ok: true, reference: null, visionMidpoint, ratio: null, warningEs: null, warning: null };
  }

  const reference = calculateQuote({ serviceSlug: opts.serviceSlug, bedrooms, bathrooms, city: opts.city });
  if (!reference) {
    return { ok: true, reference: null, visionMidpoint, ratio: null, warningEs: null, warning: null };
  }

  const referenceMidpoint = (reference.low + reference.high) / 2;
  if (referenceMidpoint <= 0) {
    return { ok: true, reference: null, visionMidpoint, ratio: null, warningEs: null, warning: null };
  }

  const ratio = visionMidpoint / referenceMidpoint;

  if (ratio > SANITY_HIGH_RATIO) {
    return {
      ok: false,
      reference: Math.round(referenceMidpoint),
      visionMidpoint,
      ratio: Number(ratio.toFixed(2)),
      warningEs:
        'Este estimado salió mucho más alto de lo normal para una casa de este tamaño. Puede que el video haya quedado oscuro o movido. Vale la pena repetirlo con más luz, o pedir que un profesional lo confirme antes de reservar.',
      warning:
        'This estimate came out much higher than usual for a home this size. The video may have been dark or shaky. It is worth recording it again with more light, or having a pro confirm before you book.',
    };
  }

  if (ratio < SANITY_LOW_RATIO) {
    return {
      ok: false,
      reference: Math.round(referenceMidpoint),
      visionMidpoint,
      ratio: Number(ratio.toFixed(2)),
      warningEs:
        'Este estimado salió bastante más bajo de lo normal. Puede que el video no haya mostrado toda la casa. Revisa que hayas grabado todos los espacios.',
      warning:
        'This estimate came out well below normal. The video may not have shown the whole home — check that every space was filmed.',
    };
  }

  return {
    ok: true,
    reference: Math.round(referenceMidpoint),
    visionMidpoint,
    ratio: Number(ratio.toFixed(2)),
    warningEs: null,
    warning: null,
  };
}
