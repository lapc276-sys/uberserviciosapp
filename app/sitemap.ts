import type { MetadataRoute } from 'next';
import { site } from '@/lib/config/site';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url;
  const now = new Date();

  const staticPages = ['', '/services', '/areas', '/book', '/faq', '/contact', '/about', '/careers', '/blog', '/privacy', '/terms'].map(
    (path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: path === '' ? 1 : 0.7,
    }),
  );

  const servicePages = services.map((s) => ({
    url: `${base}/services/${s.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.9,
  }));

  const cityPages = cities.map((c) => ({
    url: `${base}/areas/${c.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...servicePages, ...cityPages];
}
