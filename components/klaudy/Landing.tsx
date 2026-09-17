'use client';

import { useState } from 'react';
import { MessageCircle, Phone, Camera, MapPin, Check, Loader2, Languages } from 'lucide-react';
import { QuickQuote } from '@/components/klaudy/QuickQuote';
import { services } from '@/lib/config/services';
import { site } from '@/lib/config/site';
import { whatsappLink, telLink, OPENERS } from '@/lib/contact';
import { COPY, DEFAULT_LOCALE, type Locale } from '@/lib/i18n';

/**
 * The page that has to bring in work this month.
 *
 * Built around one belief about how somebody actually hires a cleaner: they
 * are on a phone, they have already decided they need this, and the only
 * question is whether contacting you is easier than contacting the next
 * person. So the two things that produce a job — a price, and a message —
 * are both reachable without scrolling, and everything else is below them.
 *
 * The quote tool sits on this page rather than behind a link because it is the
 * only reason to choose this business over the one with a cheaper flyer. A
 * separate /quote page would put a navigation step between a curious visitor
 * and the thing that makes them a customer.
 */

export function Landing() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const t = COPY[locale];

  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');

  const wa = whatsappLink(OPENERS[locale]);
  const tel = telLink();

  // Only the services worth showing a homeowner in Brooklyn. The commercial
  // and post-construction lines exist in the config but do not belong in front
  // of somebody who wants their apartment cleaned.
  const shown = services.filter((s) =>
    ['house-cleaning', 'deep-cleaning', 'apartment-cleaning', 'move-out-cleaning', 'airbnb-cleaning'].includes(s.slug),
  );

  async function submitContact(form: FormData) {
    setSending(true);
    setFormError('');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          phone: String(form.get('contact') ?? ''),
          message: String(form.get('message') ?? ''),
          source: 'klaudy_landing',
        }),
      });
      if (!res.ok) throw new Error('failed');
      setSent(true);
    } catch {
      setFormError(t.contactFormError);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur dark:border-white/10 dark:bg-slate-950/90">
        {/* min-w-0 and shrink on the brand: at 360px the three items do not
            fit, and without these the WhatsApp button is pushed off the right
            edge — invisible, on the narrowest phones, which is most of them. */}
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <span className="min-w-0 shrink truncate text-lg font-semibold tracking-tight">{site.name}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
              aria-label={t.langSwitch}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium dark:border-white/15"
            >
              <Languages className="h-3.5 w-3.5" />
              {t.langSwitch}
            </button>
            {wa && (
              <a
                href={wa}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-sm font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="py-10 sm:py-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            <MapPin className="h-3.5 w-3.5" /> {t.heroBadge}
          </span>
          <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t.heroTitle}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">{t.heroSub}</p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a
              href="#precio"
              className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-semibold text-white"
            >
              <Camera className="h-5 w-5" /> {t.heroCtaQuote}
            </a>
            {wa && (
              <a
                href={wa}
                className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl border-2 px-6 text-base font-semibold dark:border-white/20"
              >
                <MessageCircle className="h-5 w-5 text-emerald-600" /> {t.heroCtaWhatsapp}
              </a>
            )}
          </div>
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t.heroNote}</p>
        </section>

        {/* ── Services ───────────────────────────────────────────────── */}
        <section id="servicios" className="border-t py-12 dark:border-white/10">
          <h2 className="text-2xl font-semibold tracking-tight">{t.servicesTitle}</h2>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{t.servicesSub}</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((s) => (
              <div key={s.slug} className="rounded-2xl border p-5 dark:border-white/10">
                <h3 className="font-semibold">{locale === 'es' ? s.nameEs : s.name}</h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                  {locale === 'es' ? s.summaryEs : s.summary}
                </p>
                <p className="mt-3 text-sm font-medium">
                  {t.from} ${s.pricing.base}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How ────────────────────────────────────────────────────── */}
        <section id="como" className="border-t py-12 dark:border-white/10">
          <h2 className="text-2xl font-semibold tracking-tight">{t.howTitle}</h2>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{t.howSub}</p>

          {/* Numbered because this genuinely is a sequence — you cannot get a
              price before recording, or book before seeing the price. */}
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              [t.how1Title, t.how1Body],
              [t.how2Title, t.how2Body],
              [t.how3Title, t.how3Body],
            ].map(([title, body], i) => (
              <li key={title} className="rounded-2xl border p-5 dark:border-white/10">
                <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Price, on the page ─────────────────────────────────────── */}
        <section id="precio" className="scroll-mt-16 border-t py-12 dark:border-white/10">
          <h2 className="text-2xl font-semibold tracking-tight">{t.calcTitle}</h2>
          <p className="mt-1 max-w-xl text-slate-600 dark:text-slate-300">{t.calcSub}</p>

          <div className="mt-6 max-w-lg">
            <QuickQuote locale={locale} />
          </div>
        </section>

        {/* ── Contact ────────────────────────────────────────────────── */}
        <section id="contacto" className="border-t py-12 dark:border-white/10">
          <h2 className="text-2xl font-semibold tracking-tight">{t.contactTitle}</h2>
          <p className="mt-1 text-slate-600 dark:text-slate-300">{t.contactSub}</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {wa && (
              <a
                href={wa}
                className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white"
              >
                <MessageCircle className="h-5 w-5" /> {t.contactWhatsapp}
              </a>
            )}
            {tel && (
              <a
                href={tel}
                className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold dark:border-white/20"
              >
                <Phone className="h-5 w-5" /> {t.contactCall}
              </a>
            )}
          </div>

          {sent ? (
            <p className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <Check className="h-4 w-4" /> {t.contactFormSent}
            </p>
          ) : (
            <form
              action={submitContact}
              className="mt-6 grid gap-3 rounded-2xl border p-5 dark:border-white/10"
            >
              <input name="name" required placeholder={t.contactFormName} className={FIELD} />
              <input name="contact" required placeholder={t.contactFormPhone} className={FIELD} />
              <textarea name="message" rows={3} placeholder={t.contactFormMessage} className={FIELD} />
              <button
                type="submit"
                disabled={sending}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
              >
                {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : t.contactFormSend}
              </button>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </form>
          )}
        </section>

        {/* ── Area ───────────────────────────────────────────────────── */}
        <section className="border-t py-12 dark:border-white/10">
          <h2 className="text-lg font-semibold">{t.areaTitle}</h2>
          <p className="mt-1.5 max-w-xl text-slate-600 dark:text-slate-300">{t.areaBody}</p>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
        © {new Date().getFullYear()} {site.name} · Brooklyn, NY
      </footer>
    </div>
  );
}

const FIELD =
  'min-h-[52px] w-full rounded-xl border bg-white px-4 text-base outline-none focus:border-brand-500 dark:border-white/15 dark:bg-white/5';
