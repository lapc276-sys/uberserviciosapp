'use client';

import { useState } from 'react';
import { MessageCircle, Loader2, Camera, ChevronDown } from 'lucide-react';
import { GuidedCapture } from '@/components/capture/GuidedCapture';
import { readJson } from '@/lib/http';
import { services } from '@/lib/config/services';
import { whatsappLink } from '@/lib/contact';
import { COPY, type Locale } from '@/lib/i18n';

/**
 * Two ways to get a price, in the order people actually want them.
 *
 * The questionnaire is first and open by default. A stranger who just landed
 * wants a number in ten seconds; asking them to walk around filming their own
 * apartment before seeing any price is a large favour to ask of somebody who
 * has not decided to hire you yet.
 *
 * The camera is the better estimate — it sees how dirty a place is, not just
 * how big — but it is the second question, offered to whoever is interested
 * enough to want a firmer number. Leading with it costs jobs from the majority
 * who would have accepted a range and moved on.
 */

/**
 * Two shapes, because the two paths know different amounts.
 *
 * The questionnaire returns one committed price. The camera returns a range,
 * because what it measured is genuinely uncertain. Flattening them into one
 * shape would mean either inventing a range around a fixed price or averaging
 * away a real one.
 */
interface Priced {
  /** Questionnaire: the owner's list price. */
  price?: number;
  /** Camera: a range, tax-inclusive where tax applies. */
  low?: number;
  high?: number;
  totalLow?: number;
  totalHigh?: number;
  taxAmount?: number;
  estimatedMinutes?: number;
  recommendedPros?: number;
  /** False when the size is past anything actually quoted. */
  quoted?: boolean;
}

const HOME_SERVICES = ['house-cleaning', 'deep-cleaning', 'move-out-cleaning'];

export function QuickQuote({ locale }: { locale: Locale }) {
  const t = COPY[locale];

  const [propertyType, setPropertyType] = useState<'house' | 'apartment'>('apartment');
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [serviceSlug, setServiceSlug] = useState('house-cleaning');

  const [priced, setPriced] = useState<Priced | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [cameraOpen, setCameraOpen] = useState(false);

  const options = services.filter((s) => HOME_SERVICES.includes(s.slug));

  async function priceIt() {
    setBusy(true);
    setError('');
    setPriced(null);
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No square footage: the price list is keyed on rooms, and the owner
        // quotes a house and a flat of the same size at the same price. Sending
        // an invented area would let it drift off his own numbers.
        body: JSON.stringify({ serviceSlug, bedrooms, bathrooms, city: 'Brooklyn' }),
      });
      const { data, failure } = await readJson<any>(res);
      if (failure || !data || !res.ok) {
        setError(failure ?? t.contactFormError);
        return;
      }
      setPriced(data);
    } catch {
      setError(t.contactFormError);
    } finally {
      setBusy(false);
    }
  }

  async function priceFromCamera(frames: string[], captions: string[] | undefined, slug: string, focus?: string) {
    setBusy(true);
    setError('');
    setPriced(null);
    try {
      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, captions, serviceSlug: slug, focus, city: 'Brooklyn' }),
      });
      const { data, failure } = await readJson<any>(res);
      if (failure || !data || !res.ok) {
        setError(failure ?? data?.error ?? t.contactFormError);
        return;
      }
      setPriced({ ...data.quote, estimatedMinutes: data.analysis?.totalMinutes });
    } catch {
      setError(t.contactFormError);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The message must carry the number the customer actually saw.
   *
   * The screen shows the tax-inclusive range and `low`/`high` are pre-tax, so
   * reading the wrong pair sends a figure fifteen dollars under the quote —
   * the customer arrives expecting one price and is billed another, which is
   * an argument on the doorstep rather than a rounding detail.
   */
  const shownLow = priced?.totalLow ?? priced?.low;
  const shownHigh = priced?.totalHigh ?? priced?.high;

  /** Exactly what the customer is looking at, so the message cannot disagree. */
  const shownPrice =
    priced?.price !== undefined ? `$${priced.price}` : shownLow ? `$${shownLow}–$${shownHigh}` : '';

  /**
   * The property type rides along in the message rather than in the price.
   *
   * The owner quotes a two-bed house and a two-bed flat the same, so making the
   * toggle move the number would be inventing a rule he does not use. It still
   * belongs in the message: a house means stairs and probably more floor, which
   * is what he needs to know before agreeing to a time.
   */
  const place =
    locale === 'es'
      ? `${propertyType === 'house' ? 'casa' : 'apartamento'} de ${bedrooms} hab y ${bathrooms} baño${bathrooms > 1 ? 's' : ''}`
      : `${bedrooms}-bed ${bathrooms}-bath ${propertyType}`;

  const bookMessage = priced
    ? locale === 'es'
      ? `Hola, quiero limpieza en Brooklyn para un ${place}. La página me dio ${shownPrice}. ¿Cuándo tienes disponible?`
      : `Hi, I need cleaning in Brooklyn for a ${place}. Your page quoted me ${shownPrice}. When are you available?`
    : '';
  const bookLink = priced ? whatsappLink(bookMessage) : null;

  return (
    <div className="rounded-2xl border p-5 dark:border-white/10">
      {busy ? (
        <div className="py-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
          <p className="mt-3 text-sm font-medium">
            {locale === 'es' ? 'Calculando…' : 'Working it out…'}
          </p>
        </div>
      ) : priced ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.calcResult}</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight">
              {priced.quoted === false && <span className="text-2xl font-medium">{t.calcFrom} </span>}
              {shownPrice}
            </p>
            {(priced.taxAmount || priced.estimatedMinutes) && (
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                {priced.taxAmount ? `${t.calcTax} · ` : ''}
                {priced.estimatedMinutes
                  ? `≈ ${Math.floor(priced.estimatedMinutes / 60)}h ${priced.estimatedMinutes % 60}m`
                  : ''}
                {(priced.recommendedPros ?? 1) > 1 &&
                  ` · ${priced.recommendedPros} ${locale === 'es' ? 'personas' : 'people'}`}
              </p>
            )}
          </div>

          {bookLink && (
            <a
              href={bookLink}
              className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white"
            >
              <MessageCircle className="h-5 w-5" /> {t.calcBook}
            </a>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400">
            {priced.quoted === false ? t.calcAsk : t.calcDisclaimer}
          </p>

          <button
            type="button"
            onClick={() => {
              setPriced(null);
              setCameraOpen(false);
            }}
            className="w-full text-sm font-medium text-slate-500 underline"
          >
            {locale === 'es' ? 'Calcular otro' : 'Start over'}
          </button>
        </div>
      ) : cameraOpen ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setCameraOpen(false)}
            className="text-sm font-medium text-slate-500 underline"
          >
            ← {locale === 'es' ? 'Volver al formulario' : 'Back to the form'}
          </button>
          <GuidedCapture
            onComplete={({ frames, captions, serviceSlug: chosen, focus }) =>
              priceFromCamera(frames, captions, chosen, focus)
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          {/* House or apartment */}
          <div className="grid grid-cols-2 gap-2">
            {(['apartment', 'house'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setPropertyType(type)}
                className={`min-h-[52px] rounded-xl border-2 text-base font-medium transition-colors ${
                  propertyType === type
                    ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'dark:border-white/15'
                }`}
              >
                {type === 'house' ? t.calcHouse : t.calcApartment}
              </button>
            ))}
          </div>

          {/* Counters, tap-sized. A stepper beats a dropdown on a phone: no
              sheet opens, and the whole range is visible at once. */}
          {(
            [
              [t.calcBedrooms, bedrooms, setBedrooms, 0, 6],
              [t.calcBathrooms, bathrooms, setBathrooms, 1, 5],
            ] as const
          ).map(([label, value, set, min, max]) => (
            <div key={label}>
              <p className="mb-2 text-sm font-medium">{label}</p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set(n)}
                    className={`h-12 min-w-[3rem] flex-1 rounded-xl border-2 text-base font-medium transition-colors ${
                      value === n
                        ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                        : 'dark:border-white/15'
                    }`}
                  >
                    {n === max ? `${n}+` : n}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="svc">
              {t.calcService}
            </label>
            <select
              id="svc"
              value={serviceSlug}
              onChange={(e) => setServiceSlug(e.target.value)}
              className="min-h-[52px] w-full rounded-xl border bg-white px-4 text-base outline-none dark:border-white/15 dark:bg-white/5"
            >
              {options.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {locale === 'es' ? s.nameEs : s.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={priceIt}
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-brand-600 text-base font-semibold text-white"
          >
            {t.heroCtaQuote}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* The camera, offered rather than imposed. */}
          <div className="border-t pt-4 dark:border-white/10">
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="inline-flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300">
                <Camera className="h-4 w-4" /> {t.quoteToggle}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-slate-400" />
            </button>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t.quoteWhy}</p>
          </div>
        </div>
      )}
    </div>
  );
}
