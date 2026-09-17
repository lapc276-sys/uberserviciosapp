/**
 * The price list, as actually quoted.
 *
 * These are not derived from an hourly rate or a time model — they are the
 * numbers this business tells customers, and they must come out of the
 * calculator exactly, to the dollar. A page that quotes $148 when the owner
 * says $150 is worse than no calculator: it undercuts him on every job and
 * makes him argue with his own website.
 *
 * Kept separate from lib/vision/pricing.ts on purpose. That one prices a job
 * from what a camera measured, with a range, because the uncertainty is real.
 * This one answers a questionnaire, where the honest answer is a single number
 * the owner already committed to.
 */

/**
 * Base price by bedroom count, bathroom included.
 *
 * Deliberately a ladder rather than a rate, because the quoted prices are not
 * linear and that is correct rather than sloppy: the second bedroom adds $40,
 * the third adds $20. Setup, travel and the kitchen are paid for once, so a
 * bigger place costs less per room. A linear fit would have to miss at least
 * one of the four real quotes.
 *
 *   1 bed  $110   quoted
 *   2 bed  $150   quoted
 *   3 bed  $170   quoted (with 2 baths: $190)
 */
const BEDROOM_LADDER: Record<number, number> = {
  0: 110, // studio: priced as a one-bed, it is the same work
  1: 110,
  2: 150,
  3: 170,
  4: 190,
  5: 210,
  6: 230,
};

/** Each bathroom past the first. */
const EXTRA_BATHROOM = 20;

/**
 * Multipliers on the standard clean.
 *
 * `deep` is the owner's own figure. The others keep their ratio to it from the
 * time model until he quotes them directly — marked so nobody mistakes an
 * inherited number for a committed one.
 */
export const SERVICE_MULTIPLIER: Record<string, number> = {
  'house-cleaning': 1,
  'apartment-cleaning': 1,
  'deep-cleaning': 1.45, // quoted by the owner
  'move-out-cleaning': 1.55, // inherited, not yet quoted
  'move-in-cleaning': 1.5, // inherited, not yet quoted
  'airbnb-cleaning': 1.05, // inherited, not yet quoted
};

export interface ListPriceInput {
  bedrooms: number;
  bathrooms: number;
  serviceSlug: string;
}

export interface ListPrice {
  /** The number shown to the customer. */
  price: number;
  /** True when every input sits inside a size the owner has actually quoted. */
  quoted: boolean;
}

/**
 * The largest property whose price came from the owner rather than the ladder.
 *
 * Past this the number is an extrapolation, and the page says so instead of
 * presenting a guess with the same confidence as a real quote.
 */
const QUOTED_MAX_BEDROOMS = 3;
const QUOTED_MAX_BATHROOMS = 2;

export function listPrice({ bedrooms, bathrooms, serviceSlug }: ListPriceInput): ListPrice {
  const beds = Math.max(0, Math.min(Math.round(bedrooms), 6));
  const baths = Math.max(1, Math.min(Math.round(bathrooms), 5));

  const base = BEDROOM_LADDER[beds] ?? BEDROOM_LADDER[6];
  const standard = base + (baths - 1) * EXTRA_BATHROOM;
  const multiplier = SERVICE_MULTIPLIER[serviceSlug] ?? 1;

  return {
    // Rounded to whole dollars. A cleaning quote of $159.50 reads as a
    // machine's output; $160 reads as a price somebody decided on.
    price: Math.round(standard * multiplier),
    quoted: beds <= QUOTED_MAX_BEDROOMS && baths <= QUOTED_MAX_BATHROOMS,
  };
}

/**
 * Whether sales tax is added on top.
 *
 * Off by default because the business is not collecting it yet, and a page
 * that adds tax the owner never charges quotes high and loses the job.
 *
 * It is a switch rather than a deletion because New York does tax interior
 * cleaning and maintenance (NYS 4% + NYC 4.5% + MCTD 0.375%). The day that
 * gets handled properly this flips, and the price list above does not change.
 */
export function chargesSalesTax(): boolean {
  return process.env.CHARGE_SALES_TAX === 'true';
}
