import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Check, Star, ShieldCheck, Clock } from 'lucide-react';
import { services, getService } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';
import { site } from '@/lib/config/site';
import { buildMetadata } from '@/lib/seo';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { JsonLd } from '@/components/seo/JsonLd';
import { serviceSchema, faqSchema, breadcrumbSchema, localBusinessSchema } from '@/lib/schema';
import { formatCurrency } from '@/lib/utils';

export function generateStaticParams() {
  return services.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) return buildMetadata({ title: 'Service not found' });
  return buildMetadata({
    title: service.seo.title,
    description: service.seo.description,
    keywords: service.seo.keywords,
    path: `/services/${service.slug}`,
  });
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) notFound();

  const related = services.filter((s) => s.slug !== service.slug).slice(0, 3);

  return (
    <>
      <JsonLd
        data={[
          serviceSchema(service),
          localBusinessSchema(),
          faqSchema(service.faqs),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Services', path: '/services' },
            { name: service.name, path: `/services/${service.slug}` },
          ]),
        ]}
      />

      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20">
          <nav className="mb-6 flex items-center gap-2 text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-900 dark:hover:text-white">Home</Link>
            <span>/</span>
            <Link href="/services" className="hover:text-slate-900 dark:hover:text-white">Services</Link>
            <span>/</span>
            <span className="text-slate-900 dark:text-white">{service.name}</span>
          </nav>
          <div className="grid items-start gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                <Icon name={service.icon} className="h-6 w-6" />
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl text-balance">{service.name}</h1>
              <p className="mt-4 max-w-lg text-lg text-slate-600 dark:text-slate-300">{service.description}</p>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand-600" /> Insured pros</span>
                <span className="inline-flex items-center gap-1.5"><Star className="h-4 w-4 text-brand-600" /> {site.rating.value}★ rated</span>
                <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-brand-600" /> {service.pricing.estimatedHours}</span>
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button href={`/book?service=${service.slug}`} size="lg">Book this service <ArrowRight className="h-4 w-4" /></Button>
                <Button href={`/book?service=${service.slug}`} variant="ghost" size="lg">Get instant quote</Button>
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-7 shadow-lift dark:bg-ink-soft">
              <p className="text-sm text-slate-500 dark:text-slate-400">Starting at</p>
              <p className="mt-1 text-4xl font-semibold">{formatCurrency(service.pricing.base)}<span className="text-base font-normal text-slate-400">+</span></p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Final price scales with bedrooms, bathrooms and size. Recurring plans save up to 20%.</p>
              <div className="mt-6 space-y-3">
                <PriceRow label="Base" value={formatCurrency(service.pricing.base)} />
                <PriceRow label="Per bedroom" value={`+ ${formatCurrency(service.pricing.perBedroom)}`} />
                <PriceRow label="Per bathroom" value={`+ ${formatCurrency(service.pricing.perBathroom)}`} />
                <PriceRow label="Per 1,000 sqft" value={`+ ${formatCurrency(service.pricing.perSqftThousand)}`} />
              </div>
              <Button href={`/book?service=${service.slug}`} className="mt-6 w-full">See my exact price</Button>
            </div>
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="border-b">
        <div className="container py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What’s included</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {service.includes.map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-soft dark:bg-white/[0.03]">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50"><Check className="h-4 w-4" /></span>
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      {service.faqs.length > 0 && (
        <section className="border-b bg-slate-50/60 dark:bg-white/[0.02]">
          <div className="container py-16">
            <div className="mx-auto max-w-3xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{service.name} FAQ</h2>
              <div className="mt-8 divide-y">
                {service.faqs.map((f) => (
                  <details key={f.q} className="group py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                      {f.q}
                      <span className="ml-4 text-slate-400 transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Cities */}
      <section className="border-b">
        <div className="container py-14">
          <h2 className="text-lg font-semibold">{service.name} near you</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {cities.map((c) => (
              <Link key={c.slug} href={`/areas/${c.slug}`} className="rounded-full border bg-white px-4 py-2 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:bg-white/[0.03] dark:text-slate-300">
                {service.shortName} in {c.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Related */}
      <section>
        <div className="container py-16">
          <h2 className="text-2xl font-semibold tracking-tight">Related services</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {related.map((s) => (
              <Link key={s.slug} href={`/services/${s.slug}`} className="group rounded-2xl border bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:bg-white/[0.03]">
                <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><Icon name={s.icon} /></span>
                <h3 className="mt-4 font-semibold">{s.name}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{s.summary}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed pb-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
