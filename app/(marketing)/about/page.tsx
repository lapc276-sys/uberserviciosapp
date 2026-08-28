import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { Button } from '@/components/ui/Button';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'About Homigo — Home Services, Automated',
  description: 'Homigo is building the most automated home-services company in America — starting with cleaning and expanding to every home service.',
  path: '/about',
});

const values = [
  { title: 'Effortless for you', text: 'Booking takes 60 seconds. Everything after — reminders, dispatch, follow-up — runs itself.' },
  { title: 'Fair for pros', text: 'We use technology to give cleaners steady work, fast pay, and fewer no-shows.' },
  { title: 'Consistent everywhere', text: 'The same high standard, photo-verified, in every home and every city we serve.' },
];

// Rating and review counts appear here only once they exist. The other two
// describe how the product behaves, which is true on day one.
const stats = [
  ...(site.rating
    ? [
        { value: `${site.rating.value}★`, label: 'Average rating' },
        { value: `${(site.rating.count / 1000).toFixed(1)}k+`, label: 'Reviews' },
      ]
    : []),
  { value: '60s', label: 'Avg. time to book' },
  { value: '24/7', label: 'AI availability' },
];

export default function AboutPage() {
  return (
    <>
      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20 text-center">
          <span className="eyebrow">About</span>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl text-balance">
            We’re automating home services — starting with a spotless home
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            {site.name} pairs vetted, insured pros with an AI operations layer that handles quoting, scheduling, reminders and follow-up — so great service is fast, reliable and always-on.
          </p>
        </div>
      </section>

      <section className="border-b">
        <div className="container grid gap-6 py-12 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-semibold text-brand-600">{s.value}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b">
        <div className="container py-16">
          <div className="grid gap-6 md:grid-cols-3">
            {values.map((v) => (
              <div key={v.title} className="rounded-2xl border bg-white p-7 shadow-soft dark:bg-white/[0.03]">
                <h2 className="font-semibold">{v.title}</h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready to experience it?</h2>
          <div className="mt-6 flex justify-center">
            <Button href="/book" size="lg">Book online</Button>
          </div>
        </div>
      </section>
    </>
  );
}
