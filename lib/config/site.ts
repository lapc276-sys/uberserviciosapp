/**
 * Single source of truth for company identity, contact and brand.
 * Change it once here — it propagates to SEO, schema, footer, chatbot, etc.
 *
 * Everything here is published: the pages render it and lib/schema.ts feeds it
 * to Google as structured data. So nothing in this file may be aspirational.
 *
 * The fields below started as placeholders during the build and went live with
 * the first deploy, which put an invented review count, an address the company
 * does not occupy and a fictional 555 phone number in front of real visitors
 * and into schema.org markup. Fabricated ratings there are what earns a manual
 * penalty from Google, and in the US an invented review count is an FTC matter
 * rather than a cosmetic one.
 *
 * The rule now: anything unproven is `null`, and every surface omits what is
 * null instead of inventing a stand-in. An incomplete page is recoverable; a
 * page that lies is not.
 */
export const site = {
  name: 'Homigo',
  legalName: 'Homigo Home Services LLC',
  tagline: 'Home services, on autopilot.',
  description:
    'Instant online quotes from a short video of your home, AI scheduling, and pros who show up prepared.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  locale: 'en_US',

  /** Set these once they are real and reachable. Null until then. */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null,
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? null,

  /**
   * A street address here becomes a LocalBusiness claim to Google that the
   * company operates from it. Left null until there is one.
   */
  address: null as null | {
    street: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  },
  geo: null as null | { lat: number; lng: number },

  hours: 'Mo-Su 07:00-21:00',
  priceRange: '$$',
  founded: '2026',

  /**
   * Only ever set from real, verifiable reviews. Until then no star rating is
   * shown anywhere and no aggregateRating is emitted.
   */
  rating: null as null | { value: number; count: number },

  /**
   * Claims that carry legal weight. `licensedInsured` in particular is a
   * statement about coverage that matters most precisely when something has
   * gone wrong on a job.
   */
  claims: {
    licensedInsured: false,
  },

  /** Only profiles that exist. An empty list emits no sameAs. */
  social: {} as Record<string, string>,
} as const;

export type Site = typeof site;
