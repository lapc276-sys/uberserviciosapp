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
  name: 'Klaudy',

  /**
   * Null until a company actually exists.
   *
   * "Klaudy Home Services LLC" on a page is a claim that a registered entity
   * is behind the work — the thing a customer relies on when something breaks
   * and the thing that decides who they can pursue. Trading under a name is
   * fine; naming a company that was never filed is not.
   */
  legalName: null as string | null,

  tagline: 'Brooklyn cleaning, priced on the spot.',
  description:
    'House and apartment cleaning in Brooklyn. Record a short walkthrough on your phone and get the price immediately — no site visit. English and Spanish spoken.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  locale: 'en_US',

  /** The one place the business actually works. */
  serviceArea: 'Brooklyn, NY',

  /** Set these once they are real and reachable. Null until then. */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null,
  phone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? null,

  /**
   * WhatsApp number in international digits only, e.g. "13475551234".
   *
   * Kept apart from `phone` because they are frequently different lines, and
   * because the link format is unforgiving: wa.me rejects anything with a
   * plus, a space or a dash, and fails by opening a broken page rather than
   * by erroring.
   */
  whatsapp: (process.env.NEXT_PUBLIC_WHATSAPP ?? '').replace(/\D/g, '') || null,

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

  /** Languages a customer can actually be served in. */
  languages: ['es', 'en'] as const,

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
