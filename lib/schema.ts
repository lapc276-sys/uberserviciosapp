import { site } from './config/site';
import type { Service } from './config/services';
import type { City } from './config/cities';

/** JSON-LD builders. Consumed by the <JsonLd> component on relevant pages. */

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    legalName: site.legalName,
    url: site.url,
    logo: `${site.url}/logo.png`,
    email: site.email,
    telephone: site.phone,
    sameAs: Object.values(site.social),
  };
}

export function localBusinessSchema(city?: City) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    '@id': `${site.url}#business`,
    name: city ? `${site.name} — ${city.name}, ${city.region}` : site.name,
    image: `${site.url}/og.png`,
    url: city ? `${site.url}/areas/${city.slug}` : site.url,
    telephone: site.phone,
    email: site.email,
    priceRange: site.priceRange,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: city?.name ?? site.address.city,
      addressRegion: city?.region ?? site.address.region,
      postalCode: site.address.postalCode,
      addressCountry: site.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: city?.geo.lat ?? site.geo.lat,
      longitude: city?.geo.lng ?? site.geo.lng,
    },
    openingHours: site.hours,
    areaServed: city ? `${city.name}, ${city.region}` : 'United States',
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: site.rating.value,
      reviewCount: site.rating.count,
    },
  };
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
