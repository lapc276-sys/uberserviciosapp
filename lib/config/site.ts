/**
 * Single source of truth for company identity, contact and brand.
 * Change it once here — it propagates to SEO, schema, footer, chatbot, etc.
 */
export const site = {
  name: 'Homigo',
  legalName: 'Homigo Home Services LLC',
  tagline: 'Home services, on autopilot.',
  description:
    'Book trusted, insured home-service pros in minutes. Instant online quotes, AI scheduling, and flawless service — cleaning, and much more.',
  // Update to the production domain at launch.
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://homigo.com',
  locale: 'en_US',
  email: 'hello@homigo.com',
  phone: '+1 (555) 240-0199',
  phoneHref: 'tel:+15552400199',
  // Primary market — used for LocalBusiness schema.
  address: {
    street: '2100 Biscayne Blvd, Suite 300',
    city: 'Miami',
    region: 'FL',
    postalCode: '33137',
    country: 'US',
  },
  geo: { lat: 25.7955, lng: -80.1918 },
  hours: 'Mo-Su 07:00-21:00',
  priceRange: '$$',
  founded: '2024',
  rating: { value: 4.9, count: 1284 },
  social: {
    facebook: 'https://facebook.com/homigo',
    instagram: 'https://instagram.com/homigo',
    google: 'https://g.page/homigo',
    linkedin: 'https://linkedin.com/company/homigo',
  },
} as const;

export type Site = typeof site;
