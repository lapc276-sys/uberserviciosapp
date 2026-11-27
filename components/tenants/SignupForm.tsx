'use client';

import { useState } from 'react';
import { Loader2, Check, Copy, AlertTriangle } from 'lucide-react';
import { readJson } from '@/lib/http';

/**
 * A cleaning company opening its own account.
 *
 * Written for somebody filling this in on a phone, between jobs, with one
 * hand. Every field it asks for has to earn its place: the name and the link
 * because they are what the customer sees, the email because that is where
 * leads land, the rate and the minimum because without them the engine quotes
 * at our defaults and the first price they show a customer is wrong.
 *
 * The phone is the only optional one, and it is asked last, because a phone
 * field placed early is where people abandon a signup form.
 */

interface Created {
  slug: string;
  link: string;
  apiKey: string;
  freeQuotes: number;
}

/** Mirrors lib/tenants/store.ts slugify — a live preview must not lie. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const FIELD =
  'min-h-[52px] w-full rounded-xl border bg-white px-4 text-base outline-none focus:border-brand-500 dark:border-white/15 dark:bg-white/5';

export function SignupForm({ origin }: { origin: string }) {
  const [name, setName] = useState('');
  // Null until they edit it: before that the link follows the company name, so
  // most people never touch this field at all.
  const [slugEdited, setSlugEdited] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [minimumJob, setMinimumJob] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  const slug = slugEdited ?? slugify(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/tenants/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          email: email.trim(),
          phone: phone.trim(),
          hourlyRate: Number(hourlyRate),
          minimumJob: Number(minimumJob || 0),
        }),
      });
      const { data, failure } = await readJson<Created & { message?: string }>(res);
      // A 409 or 422 still carries JSON, and its `message` is the only text
      // that tells them what to change — "ese link ya está ocupado" is the
      // whole point of the response, so it must win over a generic string.
      if (failure || !data || !res.ok) {
        setError(failure ?? data?.message ?? 'No se pudo crear la cuenta.');
        return;
      }
      setCreated(data);
    } catch {
      setError('No se pudo conectar. Revisa tu internet y prueba otra vez.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some in-app browsers; the link is
      // selectable on screen, so this is a convenience, not the only route.
    }
  }

  if (created) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <Check className="h-4 w-4" /> Tu cuenta está lista
          </p>
          <p className="mt-3 text-sm text-emerald-900/80 dark:text-emerald-200/80">
            Este es tu link. Pégalo en tu Instagram, Facebook, WhatsApp o tu página web:
          </p>
          <p className="mt-2 break-all rounded-xl bg-white p-3 text-base font-semibold text-brand-700 dark:bg-white/5 dark:text-brand-300">
            {created.link}
          </p>
          <button
            type="button"
            onClick={() => copyLink(created.link)}
            className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white"
          >
            {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            {copied ? 'Copiado' : 'Copiar mi link'}
          </button>
        </div>

        <div>
          <h2 className="font-semibold">Cómo funciona ahora</h2>
          <ol className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>1. Tu cliente abre tu link y graba su casa con el teléfono.</li>
            <li>2. Ve tu precio al momento, con tu nombre y tus tarifas.</li>
            <li>3. Si lo quiere, deja sus datos y te llega un correo con todo.</li>
          </ol>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Tienes {created.freeQuotes} presupuestos gratis este mes.
          </p>
        </div>

        {/* Shown once and genuinely unrecoverable — the server keeps only a
            hash of it. Anyone who skips past this screen needs a new key. */}
        <div className="rounded-2xl border p-5 dark:border-white/10">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Tu llave de API
          </p>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Solo la necesitas si tienes programador. <strong>No se puede volver a ver</strong> — si
            la vas a usar, guárdala ahora.
          </p>
          <p className="mt-3 break-all rounded-xl bg-slate-100 p-3 font-mono text-xs dark:bg-white/5">
            {created.apiKey}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="name">
          Nombre de tu empresa
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Limpieza María"
          className={FIELD}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="slug">
          Tu link
        </label>
        <input
          id="slug"
          required
          value={slug}
          onChange={(e) => setSlugEdited(slugify(e.target.value))}
          placeholder="limpieza-maria"
          className={FIELD}
        />
        <p className="mt-1.5 break-all text-xs text-slate-500 dark:text-slate-400">
          {origin}/q/<strong>{slug || '...'}</strong>
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="email">
          Tu correo
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="maria@ejemplo.com"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Aquí te llegan los clientes que pidan presupuesto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="rate">
            Por hora
          </label>
          <input
            id="rate"
            type="number"
            inputMode="decimal"
            required
            min={1}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            placeholder="55"
            className={FIELD}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="min">
            Mínimo
          </label>
          <input
            id="min"
            type="number"
            inputMode="decimal"
            min={0}
            value={minimumJob}
            onChange={(e) => setMinimumJob(e.target.value)}
            placeholder="110"
            className={FIELD}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">
        Con esto calculamos tus precios. Lo puedes cambiar después.
      </p>

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="phone">
          Teléfono <span className="font-normal text-slate-500">(opcional)</span>
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="718 555 1234"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Si lo pones, también te avisamos por mensaje cuando entre un cliente.
        </p>
      </div>

      <button
        type="submit"
        disabled={busy || !slug}
        className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Crear mi cuenta gratis'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
