import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { Analytics } from '@/components/analytics/Analytics';
import { Landing } from '@/components/klaudy/Landing';
import { site } from '@/lib/config/site';
import { homeCity } from '@/lib/config/cities';

/**
 * The home page is the business.
 *
 * Deliberately outside the (marketing) route group. That layout wraps every
 * page in the site nav and footer, and this page brings its own — the language
 * switch and the WhatsApp button belong in the header of a page whose entire
 * job is to get someone to make contact, and they cannot live in a nav shared
 * with /terms. Stacked, the two headers rendered the brand name twice.
 *
 * Titled in Spanish first because that is who the page is aimed at, and named
 * for the neighbourhood rather than the category: somebody searching "limpieza
 * Brooklyn" is a customer, somebody searching "cleaning services" is reading.
 */
export const metadata: Metadata = buildMetadata({
  title: 'House Cleaning in Brooklyn — Instant Price | Klaudy',
  description:
    'House and apartment cleaning in Brooklyn. Record a two-minute walkthrough on your phone and get your price immediately — no site visit, no waiting on a quote. English and Spanish spoken.',
  path: '/',
  keywords: [
    'limpieza brooklyn',
    'servicio de limpieza brooklyn',
    'limpieza de apartamentos brooklyn',
    'cleaning service brooklyn',
    'house cleaning brooklyn ny',
    'limpieza de mudanza brooklyn',
  ],
});

export default function HomePage() {
  const city = homeCity();

  /**
   * LocalBusiness, with only what is true.
   *
   * No street address: `areaServed` says where the work happens without
   * claiming premises the business does not occupy, which is the difference
   * between a service-area business and a false storefront listing. No rating,
   * because there are no reviews yet — an invented one here is what earns a
   * manual penalty from Google.
   */
  const business = {
    '@context': 'https://schema.org',
    '@type': 'HouseCleaningService',
    name: site.name,
    description: site.description,
    url: site.url,
    areaServed: {
      '@type': 'City',
      name: city.name,
      address: { '@type': 'PostalAddress', addressLocality: city.name, addressRegion: city.region, addressCountry: 'US' },
    },
    availableLanguage: ['es', 'en'],
    priceRange: site.priceRange,
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(site.email ? { email: site.email } : {}),
  };

  return (
    <>
      <JsonLd data={business} />
      <Landing />
      <Analytics />
    </>
  );
}
