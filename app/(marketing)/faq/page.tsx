import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqSchema } from '@/lib/schema';

export const metadata: Metadata = buildMetadata({
  title: 'FAQ — Cleaning Services Questions Answered | Homigo',
  description: 'Answers about Homigo pricing, scheduling, cancellations, payment, insurance and more.',
  path: '/faq',
});

const faqs = [
  { q: 'How does Homigo pricing work?', a: 'Pricing is transparent and upfront, based on your service, number of bedrooms and bathrooms, and home size. You see the exact price before you book — no hidden fees.' },
  { q: 'Are cleaners insured and background-checked?', a: 'Yes. Every Homigo pro is background-checked, vetted and covered by insurance. Your satisfaction is guaranteed.' },
  { q: 'Do I need to be home during the cleaning?', a: 'No. You can share entry instructions once and we handle the rest. You’ll receive before/after photos.' },
  { q: 'What is your cancellation policy?', a: 'You can reschedule or cancel free up to 24 hours before your appointment, directly from your confirmation.' },
  { q: 'How do I pay?', a: 'We accept all major credit and debit cards through secure checkout. You’re only charged after the service is completed.' },
  { q: 'Do you offer recurring cleaning discounts?', a: 'Yes — weekly saves 20%, bi-weekly 15%, and monthly 10% compared to one-time pricing.' },
  { q: 'What areas do you serve?', a: 'We currently serve several Florida metros and are expanding quickly. Check the Areas We Serve page or ask our assistant.' },
  { q: 'What if I’m not satisfied?', a: 'We offer a satisfaction guarantee. If something isn’t right, tell us within 24 hours and we’ll re-clean the area at no cost.' },
  { q: 'Can I request the same cleaner each time?', a: 'Yes. Recurring plans are matched to the same pro whenever possible for consistency.' },
  { q: 'Do you bring cleaning supplies?', a: 'Yes, our pros arrive fully equipped. If you prefer specific products, just note it in your booking.' },
];

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqSchema(faqs)} />
      <section className="gradient-mesh border-b">
        <div className="container py-16 text-center">
          <span className="eyebrow">FAQ</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Questions, answered</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">Everything you need to know before you book.</p>
        </div>
      </section>
      <section>
        <div className="container py-16">
          <div className="mx-auto max-w-3xl divide-y">
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
        </div>
      </section>
    </>
  );
}
