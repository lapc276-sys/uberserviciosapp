import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { services } from '@/lib/config/services';
import { verticals } from '@/lib/config/verticals';
import { buildMetadata } from '@/lib/seo';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({
  title: 'Cleaning Services — Deep, Move-Out, Airbnb & More | Homigo',
  description: 'Explore Homigo cleaning services with transparent, upfront pricing. Book insured, background-checked pros online in 60 seconds.',
  path: '/services',
  keywords: ['cleaning services', 'house cleaning', 'deep cleaning', 'move out cleaning', 'airbnb cleaning'],
});

export default function ServicesIndex() {
  return (
    <>
      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20 text-center">
          <span className="eyebrow">Services</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl text-balance">Every clean, one platform</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">
            Transparent pricing, insured pros and automated scheduling on every service.
          </p>
        </div>
      </section>

      <section>
        <div className="container py-16">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <Link key={s.slug} href={`/services/${s.slug}`} className="group flex flex-col rounded-2xl border bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:bg-white/[0.03]">
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><Icon name={s.icon} /></span>
                <h2 className="mt-4 font-semibold">{s.name}</h2>
                <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{s.summary}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="font-medium">From {formatCurrency(s.pricing.base)}</span>
                  <span className="inline-flex items-center gap-1 text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">View <ArrowRight className="h-3.5 w-3.5" /></span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-16 rounded-3xl border bg-slate-50/60 p-8 dark:bg-white/[0.02]">
            <h2 className="text-xl font-semibold">Beyond cleaning — coming soon</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Homigo is built to power every home service. Same account, same instant booking.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {verticals.filter((v) => v.status === 'soon').map((v) => (
                <span key={v.slug} className="inline-flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                  <Icon name={v.icon} className="h-4 w-4" /> {v.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
