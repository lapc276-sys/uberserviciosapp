/**
 * Service-area cities. Each generates an SEO-optimized page at /areas/[slug]
 * with LocalBusiness + Service schema targeting that city. Add a city =
 * add an entry; a fully optimized local landing page ships automatically.
 */
export interface City {
  slug: string;
  name: string;
  region: string; // state abbreviation
  county?: string;
  population?: number;
  neighborhoods: string[];
  zipCodes: string[];
  geo: { lat: number; lng: number };
  blurb: string;
}

export const cities: City[] = [
  {
    slug: 'miami-fl',
    name: 'Miami',
    region: 'FL',
    county: 'Miami-Dade',
    population: 442241,
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
    neighborhoods: ['Hyde Park', 'Channelside', 'Westshore', 'Seminole Heights'],
    zipCodes: ['33602', '33606', '33609', '33611'],
    geo: { lat: 27.9506, lng: -82.4572 },
    blurb: 'Trusted cleaners for homes, condos and offices across the Tampa Bay area.',
  },
];

export const getCity = (slug: string) => cities.find((c) => c.slug === slug);
