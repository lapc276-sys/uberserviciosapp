import Link from 'next/link';
import { ArrowRight, Star, ShieldCheck, Clock, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { JsonLd } from '@/components/seo/JsonLd';
import { services, popularServices } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';
import { verticals } from '@/lib/config/verticals';
import { site } from '@/lib/config/site';
import { faqSchema } from '@/lib/schema';
import { formatCurrency } from '@/lib/utils';

const steps = [
  { icon: 'MousePointerClick', title: 'Get an instant quote', text: 'Answer a few questions and see a transparent price in seconds — no waiting for a callback.' },
  { icon: 'CalendarCheck', title: 'Pick your time', text: 'Choose a slot that works. Our AI matches you with a vetted, insured pro nearby.' },
  { icon: 'Sparkles', title: 'Relax — it’s handled', text: 'We remind you, show up, send photo proof, and follow up. You do nothing.' },
];

const trust = [
  // Only claims that are actually true today. Insurance and review counts
  // reappear here the moment they are real — not before.
  ...(site.claims.licensedInsured ? [{ icon: ShieldCheck, label: 'Licensed & insured' }] : []),
  ...(site.rating
    ? [{ icon: Star, label: `${site.rating.value}★ · ${site.rating.count.toLocaleString()} reviews` }]
    : []),
  { icon: Clock, label: 'Book in 60 seconds' },
];

const homeFaqs = [
  { q: 'How does pricing work?', a: 'Transparent, upfront pricing based on your home size and service. You see the price before you book — no surprises, no hidden fees.' },
  {
    q: 'Are your cleaners background-checked?',
    a: 'Every pro applies, and we review each application before approving them for work. We’re building out formal background screening — ask us about a specific pro and we’ll tell you exactly what we’ve verified.',
  },
  { q: 'Can I reschedule or cancel?', a: 'Absolutely — free rescheduling or cancellation up to 24 hours before your appointment, right from your confirmation.' },
  { q: 'Do you offer recurring cleaning?', a: 'Yes, and recurring plans save up to 20%. Set weekly, bi-weekly or monthly and we handle the rest automatically.' },
];

export default function HomePage() {
  return (
    <>
      <JsonLd data={faqSchema(homeFaqs)} />

      {/* Hero */}
      <section className="relative overflow-hidden gradient-mesh">
        <div className="container relative py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 flex justify-center">
              <span className="eyebrow animate-fade-in">
                <Sparkles className="h-3.5 w-3.5 text-brand-600" />
                {site.tagline}
              </span>
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl animate-fade-up">
              The most automated way to keep your home{' '}
              <span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">spotless</span>.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-slate-600 dark:text-slate-300 animate-fade-up" style={{ animationDelay: '80ms' }}>
              Instant quotes. AI scheduling. Vetted, insured pros. Book trusted home cleaning in 60 seconds — everything after that runs itself.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row animate-fade-up" style={{ animationDelay: '160ms' }}>
              <Button href="/book" size="lg">
                Get my instant quote <ArrowRight className="h-4 w-4" />
              </Button>
              <Button href="/services" variant="ghost" size="lg">Explore services</Button>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
              {trust.map((t) => (
                <span key={t.label} className="inline-flex items-center gap-1.5">
                  <t.icon className="h-4 w-4 text-brand-600" /> {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Popular services */}
      <section className="border-t bg-slate-50/60 dark:bg-white/[0.02]">
        <div className="container py-20">
          <SectionHeader eyebrow="Services" title="Cleaning for every need" subtitle="Upfront pricing on every service. Pick one to see details, or get an instant quote." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <Link
                key={s.slug}
                href={`/services/${s.slug}`}
                className="group relative flex flex-col rounded-2xl border bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:bg-white/[0.03]"
              >
                {s.popular && (
                  <span className="absolute right-4 top-4 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                    Popular
                  </span>
                )}
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                  <Icon name={s.icon} />
                </span>
                <h3 className="mt-4 font-semibold">{s.name}</h3>
                <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{s.summary}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="font-medium">From {formatCurrency(s.pricing.base)}</span>
                  <span className="inline-flex items-center gap-1 text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                    View <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t">
        <div className="container py-20">
          <SectionHeader eyebrow="How it works" title="Three taps. Zero hassle." subtitle="We built the whole experience so a human never has to chase you — or you us." />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl border bg-white p-7 shadow-soft dark:bg-white/[0.03]">
                <span className="text-sm font-semibold text-brand-600">0{i + 1}</span>
                <span className="mt-3 inline-grid h-11 w-11 place-items-center rounded-xl bg-slate-100 dark:bg-white/5">
                  <Icon name={s.icon} className="text-slate-700 dark:text-slate-200" />
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Automation highlight */}
      <section className="border-t bg-slate-50/60 dark:bg-white/[0.02]">
        <div className="container grid items-center gap-12 py-20 lg:grid-cols-2">
          <div>
            <span className="eyebrow"><Sparkles className="h-3.5 w-3.5 text-brand-600" /> Automation</span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl text-balance">
              A cleaning company that runs itself
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              Behind the scenes, an AI operations layer handles quoting, booking, reminders, pro dispatch, invoicing and follow-up — so service stays fast, consistent and always-on.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                'Instant AI quotes 24/7',
                'Automated scheduling & dispatch',
                'SMS + email reminders',
                'Photo-proof of every clean',
                'Auto invoicing & payments',
                'Review requests & follow-ups',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {f}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button href="/book">Get started <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="relative">
            <div className="rounded-3xl border bg-white p-6 shadow-lift dark:bg-ink-soft">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2">Homigo · booking pipeline</span>
              </div>
              <div className="mt-5 space-y-3">
                {[
                  { t: 'Quote generated', s: '$189 · Deep Clean · 3BR/2BA', c: 'text-brand-600' },
                  { t: 'Booked for Sat 10:00 AM', s: 'Pro matched: Maria G. (4.9★)', c: 'text-emerald-600' },
                  { t: 'Confirmation sent', s: 'Email + SMS delivered', c: 'text-slate-500' },
                  { t: 'Reminder scheduled', s: '24h + 2h before', c: 'text-slate-500' },
                  { t: 'Review request queued', s: 'Fires on completion', c: 'text-slate-500' },
                ].map((row) => (
                  <div key={row.t} className="flex items-center gap-3 rounded-xl border bg-slate-50/50 p-3 dark:bg-white/[0.03]">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg bg-white text-xs font-semibold shadow-soft dark:bg-white/5 ${row.c}`}>✓</span>
                    <div>
                      <p className="text-sm font-medium">{row.t}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.s}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section id="pricing" className="border-t">
        <div className="container py-20">
          <SectionHeader eyebrow="Pricing" title="Transparent, upfront pricing" subtitle="No callbacks, no haggling. See a real price before you book. Recurring plans save up to 20%." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {popularServices.concat(services.filter((s) => !s.popular).slice(0, 4 - popularServices.length)).slice(0, 4).map((s) => (
              <div key={s.slug} className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
                <h3 className="font-semibold">{s.shortName}</h3>
                <p className="mt-2 text-3xl font-semibold">{formatCurrency(s.pricing.base)}<span className="text-sm font-normal text-slate-400">+</span></p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.pricing.estimatedHours}</p>
                <Button href={`/book?service=${s.slug}`} variant="ghost" size="sm" className="mt-5 w-full">Book</Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Areas */}
      <section className="border-t bg-slate-50/60 dark:bg-white/[0.02]">
        <div className="container py-20">
          <SectionHeader eyebrow="Areas we serve" title="Trusted pros near you" subtitle="Expanding fast. Find your city or ask our assistant if we’re in your area." />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {cities.map((c) => (
              <Link
                key={c.slug}
                href={`/areas/${c.slug}`}
                className="rounded-full border bg-white px-4 py-2 text-sm text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700 dark:bg-white/[0.03] dark:text-slate-300"
              >
                {c.name}, {c.region}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t">
        <div className="container py-20">
          <div className="mx-auto max-w-3xl">
            <SectionHeader eyebrow="FAQ" title="Questions, answered" />
            <div className="mt-10 divide-y">
              {homeFaqs.map((f) => (
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

      {/* Expansion / verticals */}
      <section className="border-t bg-slate-50/60 dark:bg-white/[0.02]">
        <div className="container py-16 text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-slate-400">More home services, coming soon</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-slate-400">
            {verticals.map((v) => (
              <span key={v.slug} className="inline-flex items-center gap-2 text-sm">
                <Icon name={v.icon} className="h-4 w-4" /> {v.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t">
        <div className="container py-20">
          <div className="relative overflow-hidden rounded-3xl bg-brand-600 px-8 py-16 text-center text-white shadow-lift">
            <div className="absolute inset-0 gradient-mesh opacity-30" />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl text-balance">Ready for a spotless home?</h2>
              <p className="mt-4 text-brand-50">Get your instant quote and book in under a minute. Everything after that is on us.</p>
              <div className="mt-8 flex justify-center">
                <Button href="/book" variant="secondary" size="lg">Book online now <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl text-balance">{title}</h2>
      {subtitle && <p className="mt-3 text-slate-600 dark:text-slate-300 text-balance">{subtitle}</p>}
    </div>
  );
}
