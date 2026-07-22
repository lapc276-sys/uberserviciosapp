import Link from 'next/link';
import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { cities } from '@/lib/config/cities';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Areas We Serve — Home Cleaning Near You | Homigo',
  description: 'Homigo provides trusted, insured cleaning across Florida and beyond. Find your city and book online in 60 seconds.',
  path: '/areas',
  keywords: ['cleaning near me', 'house cleaning service areas', 'local cleaning company'],
});

export default function AreasIndex() {
  return (
    <>
      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20 text-center">
          <span className="eyebrow">Areas we serve</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl text-balance">Trusted cleaning near you</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            We’re expanding fast. Find your city below — or ask our assistant if we cover your area.
          </p>
        </div>
      </section>

      <section>
        <div className="container py-16">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((c) => (
              <Link key={c.slug} href={`/areas/${c.slug}`} className="group rounded-2xl border bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:bg-white/[0.03]">
                <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><MapPin className="h-5 w-5" /></span>
                <h2 className="mt-4 font-semibold">{c.name}, {c.region}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{c.blurb}</p>
                <p className="mt-3 text-xs text-slate-400">{c.neighborhoods.slice(0, 4).join(' · ')}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
