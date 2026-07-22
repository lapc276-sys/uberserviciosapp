import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = buildMetadata({
  title: 'Careers — Join Homigo',
  description: 'Join Homigo. We’re hiring cleaning pros and building a team that’s reinventing home services.',
  path: '/careers',
});

const perks = ['Steady, flexible work', 'Fast weekly pay', 'No cost to join', 'Set your own schedule', 'Supportive team', 'Grow with us'];

export default function CareersPage() {
  return (
    <section className="border-b">
      <div className="container py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Careers</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl text-balance">Build a better home-services company with us</h1>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
            We’re hiring reliable cleaning professionals across our service areas. Great pay, flexible hours, and steady bookings.
          </p>
          <div className="mt-8 flex justify-center">
            <Button href="/contact" size="lg">Apply now</Button>
          </div>
        </div>
        <div className="mx-auto mt-14 grid max-w-3xl gap-4 sm:grid-cols-3">
          {perks.map((p) => (
            <div key={p} className="rounded-2xl border bg-white p-5 text-sm shadow-soft dark:bg-white/[0.03]">{p}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
