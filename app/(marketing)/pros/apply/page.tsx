import type { Metadata } from 'next';
import { DollarSign, CalendarClock, Smartphone, ShieldCheck } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { ProApplicationForm } from '@/components/pros/ProApplicationForm';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqSchema } from '@/lib/schema';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Become a Homigo Pro — Cleaning Jobs Near You, On Your Schedule',
  description:
    'Join Homigo as an independent cleaning professional. Pick your own areas and schedule, accept the jobs you want, and get paid fast. Free to apply.',
  path: '/pros/apply',
  keywords: ['cleaning jobs nyc', 'house cleaner jobs near me', 'independent cleaner work', 'flexible cleaning jobs'],
});

const benefits = [
  { icon: DollarSign, title: 'Keep more of what you earn', text: 'Transparent pay shown up front on every job offer — no surprises, no bidding wars.' },
  { icon: CalendarClock, title: 'You choose the work', text: 'Accept the jobs that fit your day and skip the rest. No minimum hours, no penalties.' },
  { icon: Smartphone, title: 'Jobs come to you', text: 'We handle the marketing, quoting, scheduling and reminders. You just clean.' },
  { icon: ShieldCheck, title: 'Backed and supported', text: 'Clear job details before you accept, and support when something needs sorting out.' },
];

const faqs = [
  { q: 'How much does it cost to join?', a: 'Nothing. Applying and using Homigo is free — we only earn when you complete a job.' },
  { q: 'Am I an employee?', a: 'No. Homigo Pros are independent contractors. You choose your own service areas, set your own availability, and are free to accept or decline any job.' },
  { q: 'Do I need my own supplies?', a: 'Most jobs expect you to bring standard cleaning supplies. Any exceptions are noted in the job details before you accept.' },
  { q: 'How do I get jobs?', a: 'Once approved, jobs in your chosen areas arrive by text. The first pro to accept gets the job, so quick responses win more work.' },
  { q: 'How fast do I get paid?', a: 'Payouts are issued after the job is completed and confirmed, on a weekly cycle.' },
];

export default function ProApplyPage() {
  return (
    <>
      <JsonLd data={faqSchema(faqs)} />

      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">For cleaning professionals</span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl text-balance">
              Steady cleaning work, on your schedule
            </h1>
            <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
              Homigo brings the customers. You pick the jobs that fit your day. Free to join, no minimum hours —
              now onboarding pros across New York and Florida.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="container py-14">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b) => (
              <div key={b.title} className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                  <b.icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 font-semibold">{b.title}</h2>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="container py-16">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Apply in 2 minutes</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Tell us where you can work and we’ll review your application within 2 business days.
            </p>
            <div className="mt-8">
              <ProApplicationForm />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Questions from pros</h2>
            <div className="mt-8 divide-y">
              {faqs.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                    {f.q}
                    <span className="ml-4 text-slate-400 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{f.a}</p>
                </details>
              ))}
            </div>
            <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
              Still have questions? Call us at{' '}
              <a href={site.phoneHref} className="text-brand-600 underline">{site.phone}</a>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
