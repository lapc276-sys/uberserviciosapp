/**
 * Service-area cities. Each generates an SEO-optimized page at /areas/[slug]
 * with LocalBusiness + Service schema targeting that city. Add a city =
 * add an entry; a fully optimized local landing page ships automatically.
 *
 * `timezone` drives all reminder scheduling — never assume server time.
 * `salesTax` drives quote totals. Rates below are the published combined
 * rates at time of writing; VERIFY WITH YOUR ACCOUNTANT before invoicing,
 * they change and vary by exact jurisdiction.
 */
export interface SalesTax {
  /** Combined state + local rate, e.g. 0.08875 for NYC. */
  rate: number;
  /**
   * Which cleaning work the state actually taxes.
   *  - 'all'        → residential and commercial (e.g. New York)
   *  - 'commercial' → nonresidential only (e.g. Florida)
   *  - 'none'       → cleaning services not taxed
   */
  appliesTo: 'all' | 'commercial' | 'none';
  note?: string;
}

export interface City {
  slug: string;
  name: string;
  region: string; // state abbreviation
  county?: string;
  population?: number;
  timezone: string; // IANA timezone
  salesTax: SalesTax;
  neighborhoods: string[];
  zipCodes: string[];
  geo: { lat: number; lng: number };
  blurb: string;
}

const NY_TAX: SalesTax = {
  rate: 0.08875,
  appliesTo: 'all',
  note: 'NY taxes interior cleaning and maintenance services (NYS 4% + NYC 4.5% + MCTD 0.375%).',
};

const FL_MIAMI_TAX: SalesTax = {
  rate: 0.07,
  appliesTo: 'commercial',
  note: 'Florida taxes nonresidential cleaning; residential house cleaning is generally exempt.',
};

const FL_BROWARD_TAX: SalesTax = { ...FL_MIAMI_TAX, rate: 0.07 };
const FL_ORANGE_TAX: SalesTax = { ...FL_MIAMI_TAX, rate: 0.065 };
const FL_HILLS_TAX: SalesTax = { ...FL_MIAMI_TAX, rate: 0.075 };

export const cities: City[] = [
  // ── New York (launch market) ───────────────────────────────────────────────
  {
    slug: 'manhattan-ny',
    name: 'Manhattan',
    region: 'NY',
    county: 'New York',
    population: 1629153,
    timezone: 'America/New_York',
    salesTax: NY_TAX,
    neighborhoods: ['Upper East Side', 'Upper West Side', 'Chelsea', 'SoHo', 'Tribeca', 'Harlem', 'Financial District', 'Murray Hill'],
    zipCodes: ['10001', '10011', '10016', '10021', '10023', '10128'],
    geo: { lat: 40.7831, lng: -73.9712 },
    blurb: 'From Tribeca lofts to Upper East Side classic sixes, Homigo brings vetted, insured cleaners to every Manhattan doorman building and walk-up.',
  },
  {
    slug: 'brooklyn-ny',
    name: 'Brooklyn',
    region: 'NY',
    county: 'Kings',
    population: 2561225,
    timezone: 'America/New_York',
    salesTax: NY_TAX,
    neighborhoods: ['Williamsburg', 'Park Slope', 'Bushwick', 'Brooklyn Heights', 'DUMBO', 'Bed-Stuy', 'Greenpoint'],
    zipCodes: ['11201', '11211', '11215', '11221', '11222', '11238'],
    geo: { lat: 40.6782, lng: -73.9442 },
    blurb: 'Brownstone deep cleans, Williamsburg Airbnb turnovers and move-outs across Brooklyn — booked in 60 seconds.',
  },
  {
    slug: 'queens-ny',
    name: 'Queens',
    region: 'NY',
    county: 'Queens',
    population: 2252196,
    timezone: 'America/New_York',
    salesTax: NY_TAX,
    neighborhoods: ['Astoria', 'Long Island City', 'Forest Hills', 'Flushing', 'Jackson Heights', 'Sunnyside'],
    zipCodes: ['11101', '11106', '11354', '11372', '11375'],
    geo: { lat: 40.7282, lng: -73.7949 },
    blurb: 'Reliable home and office cleaning across Astoria, LIC, Flushing and every corner of Queens.',
  },
  {
    slug: 'bronx-ny',
    name: 'The Bronx',
    region: 'NY',
    county: 'Bronx',
    population: 1472654,
    timezone: 'America/New_York',
    salesTax: NY_TAX,
    neighborhoods: ['Riverdale', 'Fordham', 'Mott Haven', 'Pelham Bay', 'Throgs Neck'],
    zipCodes: ['10451', '10463', '10465', '10468'],
    geo: { lat: 40.8448, lng: -73.8648 },
    blurb: 'Trusted, insured cleaners serving Riverdale, Mott Haven and neighborhoods throughout the Bronx.',
  },

  // ── Florida ────────────────────────────────────────────────────────────────
  {
    slug: 'miami-fl',
    name: 'Miami',
    region: 'FL',
    county: 'Miami-Dade',
    population: 442241,
    timezone: 'America/New_York',
    salesTax: FL_MIAMI_TAX,
    neighborhoods: ['Brickell', 'Wynwood', 'Coral Gables', 'Little Havana', 'Edgewater', 'Coconut Grove'],
    zipCodes: ['33101', '33125', '33130', '33137', '33145'],
    geo: { lat: 25.7617, lng: -80.1918 },
    blurb: 'From Brickell high-rises to Coral Gables homes, Homigo brings vetted, insured cleaners to every corner of Miami.',
  },
  {
    slug: 'miami-beach-fl',
    name: 'Miami Beach',
    region: 'FL',
    county: 'Miami-Dade',
    population: 82890,
    timezone: 'America/New_York',
    salesTax: FL_MIAMI_TAX,
    neighborhoods: ['South Beach', 'Mid-Beach', 'North Beach', 'Sunset Harbour'],
    zipCodes: ['33139', '33140', '33141'],
    geo: { lat: 25.7907, lng: -80.13 },
    blurb: 'Condo turnovers, Airbnb resets and home cleans across South Beach and beyond — booked in 60 seconds.',
  },
  {
    slug: 'fort-lauderdale-fl',
    name: 'Fort Lauderdale',
    region: 'FL',
    county: 'Broward',
    population: 182760,
    timezone: 'America/New_York',
    salesTax: FL_BROWARD_TAX,
    neighborhoods: ['Las Olas', 'Victoria Park', 'Rio Vista', 'Coral Ridge'],
    zipCodes: ['33301', '33304', '33308', '33312'],
    geo: { lat: 26.1224, lng: -80.1373 },
    blurb: 'Reliable home and office cleaning throughout Fort Lauderdale and the Broward coast.',
  },
  {
    slug: 'orlando-fl',
    name: 'Orlando',
    region: 'FL',
    county: 'Orange',
    population: 307573,
    timezone: 'America/New_York',
    salesTax: FL_ORANGE_TAX,
    neighborhoods: ['Lake Nona', 'Winter Park', 'Baldwin Park', 'Dr. Phillips'],
    zipCodes: ['32801', '32803', '32806', '32827'],
    geo: { lat: 28.5383, lng: -81.3792 },
    blurb: 'Vacation-rental turnovers and home cleaning across Orlando and Central Florida.',
  },
  {
    slug: 'tampa-fl',
    name: 'Tampa',
    region: 'FL',
    county: 'Hillsborough',
    population: 384959,
    timezone: 'America/New_York',
    salesTax: FL_HILLS_TAX,
    neighborhoods: ['Hyde Park', 'Channelside', 'Westshore', 'Seminole Heights'],
    zipCodes: ['33602', '33606', '33609', '33611'],
    geo: { lat: 27.9506, lng: -82.4572 },
    blurb: 'Trusted cleaners for homes, condos and offices across the Tampa Bay area.',
  },
];

export const getCity = (slug: string) => cities.find((c) => c.slug === slug);

/** Look a city up by its display name (what the booking form submits). */
export const getCityByName = (name: string) =>
  cities.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

/** Timezone for a market, defaulting to Eastern (all current markets). */
export const timezoneForCity = (name: string) => getCityByName(name)?.timezone ?? 'America/New_York';

export const citiesByRegion = () => {
  const map = new Map<string, City[]>();
  for (const c of cities) map.set(c.region, [...(map.get(c.region) ?? []), c]);
  return map;
};
