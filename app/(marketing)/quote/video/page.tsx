import type { Metadata } from 'next';
import { Video, Zap, ShieldCheck } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { VideoQuote } from '@/components/vision/VideoQuote';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqSchema } from '@/lib/schema';

export const metadata: Metadata = buildMetadata({
  title: 'Instant AI Quote from a Video — No Home Visit | Homigo',
  description:
    'Record a 60-second walkthrough and our AI estimates rooms, condition, cleaning time and price instantly. No in-person estimate, no waiting for a callback.',
  path: '/quote/video',
  keywords: ['instant cleaning quote', 'ai cleaning estimate', 'cleaning quote from video', 'no home visit estimate'],
});

const steps = [
  { icon: Video, title: 'Record a walkthrough', text: 'Walk slowly through each room. 30–90 seconds is enough.' },
  { icon: Zap, title: 'AI reads the space', text: 'It identifies rooms, objects and soil levels, then computes the work involved.' },
  { icon: ShieldCheck, title: 'Get a real price', text: 'Time, crew size, supplies and a transparent quote — in seconds.' },
];

const faqs = [
  {
    q: 'How accurate is the AI quote?',
    a: 'It is an estimate based on what the footage shows, and every quote comes with a range that widens when the AI is less certain. Your pro confirms the scope on arrival, and any change is agreed with you before work starts.',
  },
  {
    q: 'Is my video uploaded anywhere?',
    a: 'No. Your device extracts a handful of still frames and only those images are sent for analysis. The video file itself never leaves your phone.',
  },
  { q: 'What if my video is dark or blurry?', a: 'The AI lowers its confidence and widens the price range. For the best result, turn on lights and walk slowly.' },
  { q: 'Can I use photos instead of video?', a: 'Yes — upload photos of each room and the analysis works the same way.' },
  { q: 'Do I still need an in-person estimate?', a: 'No. That is the point: you get a real number without scheduling a visit or waiting for a callback.' },
];

export default function VideoQuotePage() {
  return (
    <>
      <JsonLd data={faqSchema(faqs)} />

      <section className="gradient-mesh border-b">
        <div className="container py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow">
              <Zap className="h-3.5 w-3.5 text-brand-600" /> AI instant quote
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl text-balance">
              Skip the home visit. Get your price from a video.
            </h1>
            <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
              Record a quick walkthrough and our AI figures out the rooms, how dirty they are, how long the job takes and
              what it costs — in seconds, not days.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
                <span className="text-sm font-semibold text-brand-600">0{i + 1}</span>
                <span className="mt-3 inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                  <s.icon className="h-5 w-5" />
                </span>
                <h2 className="mt-3 font-semibold">{s.title}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b">
        <div className="container py-12 sm:py-16">
          <VideoQuote />
        </div>
      </section>

      <section>
        <div className="container py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How the AI quote works</h2>
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
          </div>
        </div>
      </section>
    </>
  );
}
