import type { Metadata } from 'next';
import { Phone, Mail, Clock, MessageSquare } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { Button } from '@/components/ui/Button';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Contact Homigo — We’re Here to Help',
  description: 'Reach Homigo by phone, email or chat. Or skip the wait and book online in 60 seconds.',
  path: '/contact',
});

export default function ContactPage() {
  const channels = [
    ...(site.phone
      ? [{ icon: Phone, label: 'Call or text', value: site.phone, href: `tel:${site.phone.replace(/[^+\d]/g, '')}` }]
      : []),
    ...(site.email ? [{ icon: Mail, label: 'Email', value: site.email, href: `mailto:${site.email}` }] : []),
    { icon: Clock, label: 'Hours', value: 'Mon–Sun · 7am–9pm', href: undefined },
    { icon: MessageSquare, label: 'Live chat', value: 'Bottom-right, 24/7 AI', href: undefined },
  ];

  return (
    <section className="border-b">
      <div className="container py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Contact</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">We’re here to help</h1>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
            The fastest way to get service is to book online — but reach us any way you like.
          </p>
          <div className="mt-8 flex justify-center">
            <Button href="/book" size="lg">Book online</Button>
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-3xl gap-5 sm:grid-cols-2">
          {channels.map((c) => (
            <div key={c.label} className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
              <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><c.icon className="h-5 w-5" /></span>
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{c.label}</p>
              {c.href ? (
                <a href={c.href} className="mt-0.5 block font-medium hover:text-brand-600">{c.value}</a>
              ) : (
                <p className="mt-0.5 font-medium">{c.value}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
