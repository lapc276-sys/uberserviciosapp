import type { Metadata } from 'next';
import { site } from './config/site';

interface SeoParams {
  title?: string;
  description?: string;
  path?: string;
  keywords?: string[];
  images?: string[];
  noindex?: boolean;
}

export function buildMetadata({
  title,
  description,
  path = '/',
  keywords = [],
  images,
  noindex,
}: SeoParams = {}): Metadata {
  const fullTitle = title ? `${title}` : `${site.name} — ${site.tagline}`;
  const desc = description ?? site.description;
  const url = new URL(path, site.url).toString();
  const ogImage = images ?? [`${site.url}/og.png`];

  return {
    title: fullTitle,
    description: desc,
    keywords: keywords.length ? keywords : undefined,
    metadataBase: new URL(site.url),
    alternates: { canonical: url },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: fullTitle,
      description: desc,
      url,
      locale: site.locale,
      images: ogImage,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description: desc,
      images: ogImage,
    },
  };
}
