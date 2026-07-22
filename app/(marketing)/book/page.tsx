import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { BookingForm } from '@/components/booking/BookingForm';

export const metadata: Metadata = buildMetadata({
  title: 'Book Online — Instant Quote in 60 Seconds | Homigo',
  description: 'Book your cleaning in under a minute. Choose a service, see an instant price, pick a time — insured pros, satisfaction guaranteed.',
  path: '/book',
});

export default function BookPage() {
  return (
    <section className="border-b">
      <div className="container py-12 sm:py-16">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <span className="eyebrow">Book online</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl text-balance">Your instant quote & booking</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">See a real price as you go. No callbacks, no surprises.</p>
        </div>
        <Suspense fallback={<div className="py-20 text-center text-slate-400">Loading…</div>}>
          <BookingForm />
        </Suspense>
      </div>
    </section>
  );
}
