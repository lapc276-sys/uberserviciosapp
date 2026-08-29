'use client';

import { useState } from 'react';
import { Video, Loader2, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import { extractFrames, readImages, UnsupportedVideoError, DEFAULT_FRAME_COUNT } from '@/lib/vision/frames';
import { GuidedCapture } from '@/components/capture/GuidedCapture';
import { readJson } from '@/lib/http';

/**
 * The quoting page a cleaning company hands to its own customers.
 *
 * Written for someone who has never seen this before and is standing in their
 * own hallway: one instruction at a time, no jargon, and no account to create.
 * The company's name is on it, not ours — they are not paying us to advertise
 * to their customers.
 */

interface Service {
  slug: string;
  name: string;
}

interface Quote {
  currency: string;
  low: number;
  high: number;
  tax: number;
  totalLow: number;
  totalHigh: number;
  taxNote?: string;
  minutes: number;
  hours: number;
  crewSize: number;
  condition: string;
  confidence: number;
  rooms: { label: string; condition: string; minutes: number }[];
  warnings: string[];
}

type Stage = 'idle' | 'reading' | 'analyzing' | 'quoted' | 'sending' | 'sent';

const CONDITION_ES: Record<string, string> = {
  excellent: 'excelente',
  good: 'bueno',
  fair: 'regular',
  poor: 'malo',
  very_poor: 'muy malo',
};

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unrecognised currency code must not blank out the price.
    return `${Math.round(amount)} ${currency}`;
  }
}

export function HostedQuote({
  slug,
  company,
  services,
  accent,
}: {
  slug: string;
  company: string;
  services: Service[];
  accent: string;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [serviceSlug, setServiceSlug] = useState(services[0]?.slug ?? 'house-cleaning');
  const [progress, setProgress] = useState({ done: 0, total: DEFAULT_FRAME_COUNT });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');

  const busy = stage === 'reading' || stage === 'analyzing' || stage === 'sending';

  /** Shared by the guided walkthrough and the saved-video fallback. */
  async function requestQuote(frames: string[], captions: string[] | undefined, service: string) {
    setError('');
    setQuote(null);
    setServiceSlug(service);

    try {
      setStage('analyzing');
      const res = await fetch(`/api/public/quote/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, captions, serviceSlug: service }),
      });
      const { data, failure } = await readJson<any>(res);
      if (failure || !data) {
        setError(failure ?? 'No pudimos calcular el estimado. Inténtalo otra vez.');
        setStage('idle');
        return;
      }
      if (!res.ok) {
        setError(data.message ?? 'No pudimos calcular el estimado. Inténtalo otra vez.');
        setStage('idle');
        return;
      }

      setQuote(data as Quote);
      setStage('quoted');
    } catch {
      setError('No pudimos calcular el estimado. Inténtalo otra vez.');
      setStage('idle');
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError('');
    setQuote(null);

    try {
      const list = Array.from(files);
      const isVideo = list[0].type.startsWith('video/');

      setStage('reading');
      const frames = isVideo
        ? await extractFrames(list[0], { onProgress: (done, total) => setProgress({ done, total }) })
        : await readImages(list);

      // An uploaded video carries no captions — nobody was told what to aim at.
      await requestQuote(frames, undefined, serviceSlug);
    } catch (err) {
      setError(
        err instanceof UnsupportedVideoError
          ? err.message
          : 'No pudimos leer ese archivo. Prueba a grabar un vídeo nuevo.',
      );
      setStage('idle');
    }
  }

  async function submitLead(form: FormData) {
    if (!quote) return;
    setStage('sending');
    setError('');

    const res = await fetch(`/api/public/lead/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') || ''),
        email: String(form.get('email') || ''),
        phone: String(form.get('phone') || ''),
        address: String(form.get('address') || ''),
        notes: String(form.get('notes') || ''),
        serviceSlug,
        quoteLow: quote.low,
        quoteHigh: quote.high,
        currency: quote.currency,
        minutes: quote.minutes,
        condition: quote.condition,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message ?? 'No pudimos enviar tus datos. Inténtalo otra vez.');
      setStage('quoted');
      return;
    }
    setStage('sent');
  }

  if (stage === 'sent') {
    return (
      <div className="rounded-2xl border p-8 text-center">
        <div
          className="mx-auto grid h-14 w-14 place-items-center rounded-full text-white"
          style={{ background: accent }}
        >
          <Check className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-semibold">Listo</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {company} recibió tu solicitud y se pondrá en contacto para confirmar el precio y la fecha.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* The walkthrough. No form to fill in first: the guide asks which
          spaces there are as it goes, and asks how deep a clean at the end,
          which is every question the old service dropdown was asking up front
          of someone who has not seen a price yet. */}
      {stage !== 'quoted' && !busy && (
        <div className="rounded-2xl border p-5">
          <GuidedCapture
            onComplete={({ frames, captions, serviceSlug: chosen }) =>
              requestQuote(frames, captions, chosen)
            }
            fallback={
              <label className="flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-sm font-medium">
                <Video className="h-5 w-5" /> Subir un vídeo que ya tengas
                <input
                  type="file"
                  accept="video/*,image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            }
          />

          <p className="mt-3 text-xs text-slate-400">
            No se sube ningún vídeo ni se guarda nada en tu galería: las fotos salen de la cámara
            directo al estimado.
          </p>
        </div>
      )}

      {busy && stage !== 'sending' && (
        <div className="rounded-2xl border p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
          <p className="mt-4 text-sm font-medium">
            {stage === 'reading'
              ? `Leyendo el vídeo… ${progress.done}/${progress.total}`
              : 'Calculando tu estimado…'}
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 3 — the price */}
      {quote && (
        <>
          <div className="rounded-2xl border p-5">
            <p className="text-sm text-slate-500 dark:text-slate-400">Tu estimado</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">
              {money(quote.totalLow, quote.currency)} – {money(quote.totalHigh, quote.currency)}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {Math.round(quote.hours * 10) / 10} h de trabajo
              {quote.crewSize > 1 && ` · ${quote.crewSize} personas`}
              {' · '}estado {CONDITION_ES[quote.condition] ?? quote.condition}
            </p>
            {quote.tax > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Incluye {money(quote.tax, quote.currency)} de impuestos{quote.taxNote ? ` · ${quote.taxNote}` : ''}
              </p>
            )}

            <ul className="mt-4 divide-y text-sm">
              {quote.rooms.map((r, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span>{r.label}</span>
                  <span className="text-slate-400">{r.minutes} min</span>
                </li>
              ))}
            </ul>

            {/* Said plainly, because a surprise on arrival is what destroys
                the trust that made them book from a video. */}
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
              Es un estimado calculado a partir de tu vídeo. {company} confirmará el precio final antes de
              empezar.
            </p>

            <button
              type="button"
              onClick={() => {
                setQuote(null);
                setStage('idle');
              }}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-500 underline"
            >
              <RotateCcw className="h-4 w-4" /> Grabar otro vídeo
            </button>
          </div>

          <form action={submitLead} className="space-y-3 rounded-2xl border p-5">
            <p className="text-sm font-medium">3. ¿Te lo reservamos?</p>
            <input name="name" required placeholder="Tu nombre" className={inputClass} />
            <input name="phone" type="tel" placeholder="Teléfono" className={inputClass} />
            <input name="email" type="email" placeholder="Email" className={inputClass} />
            <input name="address" placeholder="Dirección" className={inputClass} />
            <textarea name="notes" rows={2} placeholder="Algo que debamos saber (opcional)" className={inputClass} />

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: accent }}
            >
              {stage === 'sending' && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar a {company}
            </button>
            <p className="text-center text-xs text-slate-400">
              Tus datos van directamente a {company}.
            </p>
          </form>
        </>
      )}
    </div>
  );
}

const inputClass =
  'min-h-[48px] w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none dark:bg-white/5';
