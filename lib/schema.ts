import { site } from './config/site';
import type { Service } from './config/services';
import type { City } from './config/cities';

/** JSON-LD builders. Consumed by the <JsonLd> component on relevant pages. */

/**
 * Structured data is a set of assertions to a search engine, not decoration.
 * Every optional field here is emitted only when it is backed by something
 * real — an absent property costs a rich-result feature, while a fabricated
 * one is what earns a manual penalty.
 */
function omitEmpty<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as T;
}

export function organizationSchema() {
  const sameAs = Object.values(site.social);
  return omitEmpty({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    legalName: site.legalName,
    url: site.url,
    logo: `${site.url}/logo.png`,
    email: site.email,
    telephone: site.phone,
    sameAs: sameAs.length > 0 ? sameAs : null,
  });
}

export function localBusinessSchema(city?: City) {
  const a = site.address;
  const geo = city?.geo ?? site.geo;

  return omitEmpty({
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    '@id': `${site.url}#business`,
    name: city ? `${site.name} — ${city.name}, ${city.region}` : site.name,
    image: `${site.url}/og.png`,
    url: city ? `${site.url}/areas/${city.slug}` : site.url,
    telephone: site.phone,
    email: site.email,
    priceRange: site.priceRange,
    // A PostalAddress tells Google the business operates from that spot.
    // Emitted only when one exists; a city page still declares areaServed.
    address: a
      ? {
          '@type': 'PostalAddress',
          streetAddress: a.street,
          addressLocality: city?.name ?? a.city,
          addressRegion: city?.region ?? a.region,
          postalCode: a.postalCode,
          addressCountry: a.country,
        }
      : null,
    geo: geo ? { '@type': 'GeoCoordinates', latitude: geo.lat, longitude: geo.lng } : null,
    openingHours: site.hours,
    areaServed: city ? `${city.name}, ${city.region}` : 'United States',
    // No invented aggregateRating. It reappears the day real reviews exist.
    aggregateRating: site.rating
      ? { '@type': 'AggregateRating', ratingValue: site.rating.value, reviewCount: site.rating.count }
      : null,
  });
}

export function serviceSchema(service: Service, city?: City) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: city ? `${service.name} in ${city.name}, ${city.region}` : service.name,
    serviceType: service.name,
    description: service.description,
    provider: { '@type': 'Organization', name: site.name, url: site.url },
    areaServed: city ? `${city.name}, ${city.region}` : 'United States',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: service.pricing.base,
      priceSpecification: {
        '@type': 'PriceSpecification',
        priceCurrency: 'USD',
        minPrice: service.pricing.base,
      },
    },
  };
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: new URL(item.path, site.url).toString(),
    })),
  };
}
