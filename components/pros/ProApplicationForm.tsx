'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { cities } from '@/lib/config/cities';

export function ProApplicationForm() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    yearsExperience: 2,
    hasTransport: false,
    bio: '',
  });
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function toggleArea(slug: string) {
    setAreas((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (areas.length === 0) {
      setError('Pick at least one area you can work in.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/pros/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, serviceAreas: areas }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setDone(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-3xl border bg-white p-8 text-center shadow-lift dark:bg-ink-soft">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold">Application received 🎉</h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          We review applications within 2 business days. Once you’re approved, jobs in your areas start arriving by text —
          accept the ones you want.
        </p>
      </div>
    );
  }

  const byRegion = cities.reduce<Record<string, typeof cities>>((acc, c) => {
    (acc[c.region] ??= []).push(c);
    return acc;
  }, {});

  return (
    <form onSubmit={submit} className="rounded-3xl border bg-white p-6 shadow-soft sm:p-8 dark:bg-white/[0.03]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
        <Field label="Phone" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
        <div>
          <label className="text-sm font-medium">Years of cleaning experience</label>
          <input
            type="number"
            min={0}
            max={60}
            value={form.yearsExperience}
            onChange={(e) => setForm({ ...form, yearsExperience: Number(e.target.value) })}
            className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
          />
        </div>
      </div>

      <div className="mt-6">
        <label className="text-sm font-medium">Where can you work?</label>
        <p className="mt-1 text-xs text-slate-400">Pick every area you can reach. More areas means more job offers.</p>
        <div className="mt-3 space-y-4">
          {Object.entries(byRegion).map(([region, list]) => (
            <div key={region}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{region}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {list.map((c) => {
                  const on = areas.includes(c.slug);
                  return (
                    <button
                      type="button"
                      key={c.slug}
                      onClick={() => toggleArea(c.slug)}
                      aria-pressed={on}
                      className={`rounded-full border px-4 py-2 text-sm transition-all ${
                        on
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                          : 'hover:border-slate-300 dark:text-slate-300'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="mt-6 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.hasTransport}
          onChange={(e) => setForm({ ...form, hasTransport: e.target.checked })}
          className="h-4 w-4 accent-brand-600"
        />
        I have my own transportation
      </label>

      <div className="mt-6">
        <label className="text-sm font-medium">Tell us about yourself (optional)</label>
        <textarea
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
          rows={3}
          placeholder="Experience, specialties, languages you speak…"
          className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
        />
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />} Apply to join
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">
        Applying is free. You choose which jobs to accept — no minimum hours.
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
      />
    </div>
  );
}
