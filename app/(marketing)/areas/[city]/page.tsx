import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, MapPin, ShieldCheck, Star } from 'lucide-react';
import { cities, getCity } from '@/lib/config/cities';
import { services } from '@/lib/config/services';
import { site } from '@/lib/config/site';
import { buildMetadata } from '@/lib/seo';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { JsonLd } from '@/components/seo/JsonLd';
import { localBusinessSchema, serviceSchema, breadcrumbSchema } from '@/lib/schema';
import { formatCurrency } from '@/lib/utils';

export function generateStaticParams() {
  return cities.map((c) => ({ city: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) return buildMetadata({ title: 'Area not found' });
  return buildMetadata({
    title: `House Cleaning in ${city.name}, ${city.region} — Book Online | Homigo`,
    description: `Top-rated cleaning services in ${city.name}, ${city.region}. Insured, background-checked pros, instant quotes and automated scheduling. Serving ${city.neighborhoods.slice(0, 3).join(', ')} and more.`,
    path: `/areas/${city.slug}`,
    keywords: [
      `cleaning service ${city.name}`,
      `house cleaning ${city.name} ${city.region}`,
      `maid service ${city.name}`,
      `deep cleaning ${city.name}`,
    ],
  });
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const city = getCity(slug);
  if (!city) notFound();

  return (
    <>
      <JsonLd
        data={[
          localBusinessSchema(city),
          ...services.slice(0, 4).map((s) => serviceSchema(s, city)),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Areas', path: '/areas' },
            { name: `${city.name}, ${city.region}`, path: `/areas/${city.slug}` },
          ]),
        ]}
      />

      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20">
          <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-900 dark:hover:text-white">Home</Link>
            <span>/</span>
            <Link href="/areas" className="hover:text-slate-900 dark:hover:text-white">Areas</Link>
            <span>/</span>
            <span className="text-slate-900 dark:text-white">{city.name}</span>
          </nav>
          <span className="inline-flex items-center gap-2 eyebrow"><MapPin className="h-3.5 w-3.5 text-brand-600" /> {city.name}, {city.region}</span>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl text-balance">
            House cleaning in {city.name}, {city.region}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-300">{city.blurb}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand-600" /> Licensed & insured</span>
            <span className="inline-flex items-center gap-1.5"><Star className="h-4 w-4 text-brand-600" /> {site.rating.value}★ · {site.rating.count.toLocaleString()} reviews</span>
          </div>
          <div className="mt-8">
            <Button href="/book" size="lg">Book in {city.name} <ArrowRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="container py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cleaning services in {city.name}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <Link key={s.slug} href={`/services/${s.slug}`} className="group flex flex-col rounded-2xl border bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:bg-white/[0.03]">
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><Icon name={s.icon} /></span>
                <h3 className="mt-4 font-semibold">{s.shortName} in {city.name}</h3>
                <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{s.summary}</p>
                <span className="mt-4 text-sm font-medium">From {formatCurrency(s.pricing.base)}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b bg-slate-50/60 dark:bg-white/[0.02]">
        <div className="container py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Neighborhoods we serve in {city.name}</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            {city.neighborhoods.map((n) => (
              <span key={n} className="rounded-full border bg-white px-4 py-2 text-sm text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">{n}</span>
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
            ZIP codes served include {city.zipCodes.join(', ')} and surrounding areas.
          </p>
        </div>
      </section>

      <section>
        <div className="container py-14">
          <h2 className="text-lg font-semibold">Other areas</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {cities.filter((c) => c.slug !== city.slug).map((c) => (
              <Link key={c.slug} href={`/areas/${c.slug}`} className="rounded-full border bg-white px-4 py-2 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:bg-white/[0.03] dark:text-slate-300">
                {c.name}, {c.region}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
