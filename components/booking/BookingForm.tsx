'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ArrowLeft, Check, Loader2, CalendarCheck } from 'lucide-react';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';
import { calculateQuote } from '@/lib/quote';
import { formatCurrency } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';

type Frequency = 'one_time' | 'weekly' | 'biweekly' | 'monthly';

const FREQ: { value: Frequency; label: string; note: string }[] = [
  { value: 'one_time', label: 'One-time', note: '' },
  { value: 'monthly', label: 'Monthly', note: 'Save 10%' },
  { value: 'biweekly', label: 'Bi-weekly', note: 'Save 15%' },
  { value: 'weekly', label: 'Weekly', note: 'Save 20%' },
];

const TIMES = ['08:00 AM', '10:00 AM', '12:00 PM', '02:00 PM', '04:00 PM'];

export function BookingForm() {
  const params = useSearchParams();
  const initialService = params.get('service') ?? services[0].slug;

  const [step, setStep] = useState(0);
  const [serviceSlug, setServiceSlug] = useState(initialService);
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(1);
  const [sqft, setSqft] = useState(1200);
  const [frequency, setFrequency] = useState<Frequency>('one_time');
  const [date, setDate] = useState('');
  const [time, setTime] = useState(TIMES[1]);
  const [contact, setContact] = useState({ name: '', email: '', phone: '', address: '', city: cities[0].name, notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ bookingId: string; message: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (params.get('service')) setServiceSlug(params.get('service')!);
  }, [params]);

  const quote = useMemo(
    () => calculateQuote({ serviceSlug, bedrooms, bathrooms, sqft, frequency }),
    [serviceSlug, bedrooms, bathrooms, sqft, frequency],
  );

  const service = services.find((s) => s.slug === serviceSlug)!;

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceSlug, bedrooms, bathrooms, sqft, frequency, date, time, ...contact }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
      } else {
        setResult({ bookingId: data.bookingId, message: data.message });
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border bg-white p-8 text-center shadow-lift dark:bg-ink-soft">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
          <CalendarCheck className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold">You’re booked! 🎉</h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{result.message}</p>
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-white/5">
          Confirmation #: <span className="font-semibold">{result.bookingId}</span>
        </p>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          We’ll send reminders 24h and 2h before, and follow up after your service. No action needed.
        </p>
      </div>
    );
  }

  const canContinue = [
    true,
    bedrooms >= 0 && bathrooms >= 0,
    !!date && !!time,
    contact.name.length > 1 && /.+@.+\..+/.test(contact.email) && contact.phone.length > 6 && contact.address.length > 3,
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="rounded-3xl border bg-white p-6 shadow-soft sm:p-8 dark:bg-white/[0.03]">
        {/* Progress */}
        <div className="mb-8 flex items-center gap-2">
          {['Service', 'Details', 'Schedule', 'Contact'].map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${i <= step ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400 dark:bg-white/5'}`}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`hidden text-xs sm:block ${i <= step ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>{label}</span>
              {i < 3 && <span className={`h-px flex-1 ${i < step ? 'bg-brand-600' : 'bg-slate-200 dark:bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {/* Step 0: service */}
        {step === 0 && (
          <div>
            <h2 className="text-xl font-semibold">Which service?</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {services.map((s) => (
                <button
                  key={s.slug}
                  onClick={() => setServiceSlug(s.slug)}
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${serviceSlug === s.slug ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20' : 'hover:border-slate-300'}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50"><Icon name={s.icon} className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">From {formatCurrency(s.pricing.base)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: details */}
        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Tell us about your space</h2>
            <Stepper label="Bedrooms" value={bedrooms} setValue={setBedrooms} min={0} max={8} />
            <Stepper label="Bathrooms" value={bathrooms} setValue={setBathrooms} min={0} max={8} />
            <div>
              <label className="text-sm font-medium">Approx. square footage: <span className="text-brand-600">{sqft.toLocaleString()} sqft</span></label>
              <input type="range" min={400} max={6000} step={100} value={sqft} onChange={(e) => setSqft(Number(e.target.value))} className="mt-3 w-full accent-brand-600" />
            </div>
            <div>
              <label className="text-sm font-medium">Frequency</label>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {FREQ.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFrequency(f.value)}
                    className={`rounded-xl border p-3 text-center transition-all ${frequency === f.value ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20' : 'hover:border-slate-300'}`}
                  >
                    <span className="block text-sm font-medium">{f.label}</span>
                    {f.note && <span className="block text-xs text-emerald-600">{f.note}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: schedule */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Pick a date & time</h2>
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={date}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setDate(e.target.value)}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {TIMES.map((t) => (
                  <button key={t} onClick={() => setTime(t)} className={`rounded-full border px-4 py-2 text-sm transition-all ${time === t ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20' : 'hover:border-slate-300'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: contact */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Almost done</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} />
              <Field label="Email" type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} />
              <Field label="Phone" type="tel" value={contact.phone} onChange={(v) => setContact({ ...contact, phone: v })} />
              <div>
                <label className="text-sm font-medium">City</label>
                <select value={contact.city} onChange={(e) => setContact({ ...contact, city: e.target.value })} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5">
                  {cities.map((c) => <option key={c.slug}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <Field label="Address" value={contact.address} onChange={(v) => setContact({ ...contact, address: v })} />
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <textarea value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} rows={3} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5" placeholder="Pets, entry instructions, focus areas…" />
            </div>
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}
          </div>
        )}

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 disabled:opacity-0"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < 3 ? (
            <button
              onClick={() => canContinue[step] && setStep((s) => s + 1)}
              disabled={!canContinue[step]}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-600 px-6 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting || !canContinue[3]}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-600 px-6 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirm booking
            </button>
          )}
        </div>
      </div>

      {/* Live quote summary */}
      <aside className="h-fit rounded-3xl border bg-white p-6 shadow-soft lg:sticky lg:top-24 dark:bg-white/[0.03]">
        <p className="text-sm text-slate-500 dark:text-slate-400">Your instant quote</p>
        <p className="mt-1 text-3xl font-semibold">
          {quote ? `${formatCurrency(quote.low)}–${formatCurrency(quote.high)}` : '—'}
        </p>
        {quote && quote.frequencyDiscountPct > 0 && (
          <span className="mt-2 inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            {quote.frequencyDiscountPct}% recurring discount applied
          </span>
        )}
        <div className="mt-5 space-y-2 border-t pt-4 text-sm">
          <Row label="Service" value={service.name} />
          <Row label="Bedrooms" value={String(bedrooms)} />
          <Row label="Bathrooms" value={String(bathrooms)} />
          <Row label="Size" value={`${sqft.toLocaleString()} sqft`} />
          <Row label="Est. time" value={quote?.estimatedHours ?? '—'} />
          {date && <Row label="Date" value={date} />}
          {step >= 2 && <Row label="Time" value={time} />}
        </div>
        <p className="mt-5 text-xs text-slate-400">You’re only charged after the service. Free cancellation up to 24h before.</p>
      </aside>
    </div>
  );
}

function Stepper({ label, value, setValue, min, max }: { label: string; value: number; setValue: (n: number) => void; min: number; max: number }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-3">
        <button onClick={() => setValue(Math.max(min, value - 1))} className="grid h-9 w-9 place-items-center rounded-full border text-lg hover:border-slate-300">−</button>
        <span className="w-6 text-center font-medium">{value}</span>
        <button onClick={() => setValue(Math.min(max, value + 1))} className="grid h-9 w-9 place-items-center rounded-full border text-lg hover:border-slate-300">+</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5" />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
