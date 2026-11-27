/**
 * What labour costs where, so a price can come from the place.
 *
 * NOT WIRED IN. Nothing calls this yet, on purpose: a cleaning company that
 * is already trading knows its own hourly rate, so suggesting one solves a
 * problem they do not have. It is kept because the research behind it is the
 * expensive part and will be wanted the day somebody signs up from a market
 * nobody here has ever priced — and because the two paragraphs below are
 * worth not having to rediscover.
 *
 * Asking a cleaning company to type its own hourly rate makes us a
 * calculator. The rate is not something a new owner knows — it is something
 * the local labour market already decided — and the same job is genuinely
 * worth more in Brooklyn than in Toledo.
 *
 * Two things this is NOT, both deliberate:
 *
 * 1. It is not built on the minimum wage. In 2026 New York's minimum is
 *    $17.00 in Manhattan, Queens AND the Bronx — identical — so the minimum
 *    explains none of the variation anyone actually observes inside a city.
 *    What varies is what the market pays, which is a different number.
 *
 * 2. It does not price by ZIP code or neighbourhood wealth. In the US a ZIP
 *    code is a proxy for race whether or not anybody intends it, and the
 *    textbook case is Princeton Review, whose ZIP-code pricing for test prep
 *    produced Asian-American customers paying nearly double and a national
 *    story about it. Metro-level labour cost is a cost of doing business;
 *    neighbourhood wealth is a demographic target. Only the first is here.
 *
 * The figures are BLS OEWS, occupation 37-2012 ("Maids and Housekeeping
 * Cleaners"), hourly MEAN, all from the same May 2023 release so they are
 * comparable with each other. Mixing releases or mixing mean with median
 * would silently corrupt every ratio computed below.
 *
 * Most entries have `wage: null`. That is the honest state, not an oversight:
 * bls.gov is not reachable from this environment, so only the figures that
 * could be verified are recorded. A null market makes no suggestion at all
 * rather than inventing one — see `suggestedHourlyRate`.
 */

export interface MarketWage {
  /** Hourly, USD. */
  hourly: number;
  /** Which statistic, because a mean and a median are not interchangeable. */
  statistic: 'mean' | 'median';
  /** The release, so a refresh replaces a whole generation at once. */
  asOf: string;
  source: string;
}

export interface Market {
  /** Stored on a tenant and used in URLs. */
  slug: string;
  /** What a cleaning company calls their area. */
  label: string;
  /** The BLS metro name, so a refreshed table can be matched up by hand. */
  blsArea: string;
  /** Null until a figure has actually been read off a BLS table. */
  wage: MarketWage | null;
}

const BLS_2023: Pick<MarketWage, 'statistic' | 'asOf' | 'source'> = {
  statistic: 'mean',
  asOf: 'May 2023',
  source: 'BLS OEWS 37-2012',
};

/** The US-wide figure, for context in the admin. Never used as a fallback. */
export const NATIONAL_WAGE: MarketWage = { hourly: 16.66, ...BLS_2023 };

/**
 * The market every index is measured against.
 *
 * New York because it is the only market whose selling prices are real
 * rather than assumed — the owner quotes them — so an index of 1.0 leaves
 * his own numbers exactly where they are.
 */
export const REFERENCE_MARKET = 'new-york';

export const markets: Market[] = [
  {
    slug: 'new-york',
    label: 'Nueva York y alrededores',
    blsArea: 'New York-Newark-Jersey City, NY-NJ',
    wage: { hourly: 22.62, ...BLS_2023 },
  },
  {
    slug: 'san-jose',
    label: 'San José y Silicon Valley',
    blsArea: 'San Jose-Sunnyvale-Santa Clara, CA',
    wage: { hourly: 26.21, ...BLS_2023 },
  },
  {
    slug: 'napa',
    label: 'Napa',
    blsArea: 'Napa, CA',
    wage: { hourly: 21.06, ...BLS_2023 },
  },

  // Structure present, figure not yet verified. These appear in the picker so
  // an owner can say where they are — which is worth recording even when no
  // rate can be suggested — and each one lights up the day its wage is read
  // off the BLS table.
  { slug: 'los-angeles', label: 'Los Ángeles', blsArea: 'Los Angeles-Long Beach-Anaheim, CA', wage: null },
  { slug: 'chicago', label: 'Chicago', blsArea: 'Chicago-Naperville-Elgin, IL-IN', wage: null },
  { slug: 'miami', label: 'Miami', blsArea: 'Miami-Fort Lauderdale-West Palm Beach, FL', wage: null },
  { slug: 'houston', label: 'Houston', blsArea: 'Houston-Pasadena-The Woodlands, TX', wage: null },
  { slug: 'dallas', label: 'Dallas y Fort Worth', blsArea: 'Dallas-Fort Worth-Arlington, TX', wage: null },
  { slug: 'philadelphia', label: 'Filadelfia', blsArea: 'Philadelphia-Camden-Wilmington, PA-NJ-DE-MD', wage: null },
  { slug: 'boston', label: 'Boston', blsArea: 'Boston-Cambridge-Newton, MA-NH', wage: null },
  { slug: 'washington', label: 'Washington D.C.', blsArea: 'Washington-Arlington-Alexandria, DC-VA-MD-WV', wage: null },
  { slug: 'atlanta', label: 'Atlanta', blsArea: 'Atlanta-Sandy Springs-Roswell, GA', wage: null },
  { slug: 'phoenix', label: 'Phoenix', blsArea: 'Phoenix-Mesa-Chandler, AZ', wage: null },
  { slug: 'seattle', label: 'Seattle', blsArea: 'Seattle-Tacoma-Bellevue, WA', wage: null },
  { slug: 'denver', label: 'Denver', blsArea: 'Denver-Aurora-Centennial, CO', wage: null },
  { slug: 'san-francisco', label: 'San Francisco', blsArea: 'San Francisco-Oakland-Fremont, CA', wage: null },
  { slug: 'orlando', label: 'Orlando', blsArea: 'Orlando-Kissimmee-Sanford, FL', wage: null },
  { slug: 'las-vegas', label: 'Las Vegas', blsArea: 'Las Vegas-Henderson-North Las Vegas, NV', wage: null },
  { slug: 'san-diego', label: 'San Diego', blsArea: 'San Diego-Chula Vista-Carlsbad, CA', wage: null },
  { slug: 'minneapolis', label: 'Minneapolis y St. Paul', blsArea: 'Minneapolis-St. Paul-Bloomington, MN-WI', wage: null },
];

export function findMarket(slug: string | undefined): Market | undefined {
  if (!slug) return undefined;
  return markets.find((m) => m.slug === slug);
}

/** Markets that can actually produce a suggestion today. */
export function pricedMarkets(): Market[] {
  return markets.filter((m) => m.wage !== null);
}

/**
 * How much more or less an hour of this work costs than in the reference
 * market. 1.0 means the same; 0.8 means labour is a fifth cheaper.
 *
 * Returns null — not 1 — when either side is unknown. A silent 1.0 would
 * quote Tulsa at New York prices and look like a working feature while doing
 * it, which is the failure mode worth spending a null on.
 */
export function marketIndex(slug: string | undefined): number | null {
  const market = findMarket(slug);
  const reference = findMarket(REFERENCE_MARKET);
  if (!market?.wage || !reference?.wage || reference.wage.hourly <= 0) return null;
  // Guarding against mixing statistics: a median against a mean is a ratio of
  // two different questions, and the result looks perfectly plausible.
  if (market.wage.statistic !== reference.wage.statistic) return null;
  return market.wage.hourly / reference.wage.hourly;
}

/**
 * What to put in front of a company in this market as a starting rate.
 *
 * `baseRate` is what the reference market charges per labour hour. Null means
 * we have nothing to say and the form should ask instead of guessing.
 */
export function suggestedHourlyRate(slug: string | undefined, baseRate: number): number | null {
  const index = marketIndex(slug);
  if (index === null) return null;
  // Whole dollars: $63.47 reads as a machine's output, $63 as a rate somebody
  // chose, and this number is meant to be edited anyway.
  return Math.round(baseRate * index);
}
