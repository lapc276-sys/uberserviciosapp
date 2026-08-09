'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Copy, Check, KeyRound, AlertTriangle } from 'lucide-react';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  plan: string;
  active: boolean;
  monthlyQuota: number;
  keyLast4: string;
  currency: string;
  hourlyRate: number;
  sampleSize: number;
  used: number;
  quotedValue: number;
  createdAt: string;
}

const PLAN_STYLES: Record<string, string> = {
  trial: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
  starter: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  growth: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  scale: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

const input =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-white/10 dark:bg-white/[0.04]';

export function TenantsManager({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(form: FormData) {
    setBusy(true);
    setError('');

    const currency = String(form.get('currency') || 'USD').toUpperCase();
    const taxPercent = Number(form.get('taxRate') || 0);

    const res = await fetch('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') || ''),
        contactEmail: String(form.get('contactEmail') || ''),
        plan: String(form.get('plan') || 'trial'),
        pricing: {
          hourlyRate: Number(form.get('hourlyRate') || 55),
          minimumJob: Number(form.get('minimumJob') || 89),
          laborCostRate: Number(form.get('laborCostRate') || 32),
          currency,
          // The form asks for a percentage because that is how tax is written
          // on an invoice; the engine works in fractions.
          taxRate: taxPercent / 100,
          taxAppliesTo: String(form.get('taxAppliesTo') || 'none'),
          supplyCostMultiplier: Number(form.get('supplyCostMultiplier') || 1),
        },
      }),
    });

    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(data.error ?? 'Could not create the account.');
      return;
    }

    setNewKey({ key: data.apiKey, name: data.tenant.name });
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      {newKey && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                API key for {newKey.name} — copy it now
              </p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/80">
                This is the only time it is shown. We store a hash, not the key, so it cannot be
                recovered later — only replaced.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs dark:bg-black/30">
                  {newKey.key}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(newKey.key);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setNewKey(null)}
                className="mt-3 text-xs font-medium text-amber-800 underline dark:text-amber-300"
              >
                I&rsquo;ve saved it — hide this
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
        >
          {open ? 'Cancel' : 'New account'}
        </button>
      </div>

      {open && (
        <form
          action={create}
          className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2 dark:bg-white/[0.03]"
        >
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Company name</span>
            <input name="name" required minLength={2} className={input} placeholder="Sparkle Cleaning Ltd" />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Contact email</span>
            <input name="contactEmail" type="email" required className={input} placeholder="ops@sparkle.co.uk" />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Plan</span>
            <select name="plan" className={input} defaultValue="trial">
              <option value="trial">Trial — 50 quotes/mo</option>
              <option value="starter">Starter — 500/mo</option>
              <option value="growth">Growth — 2,500/mo</option>
              <option value="scale">Scale — 25,000/mo</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Currency</span>
            <input name="currency" maxLength={3} className={input} defaultValue="USD" placeholder="GBP" />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Charged per labor hour</span>
            <input name="hourlyRate" type="number" step="0.01" min="1" className={input} defaultValue={55} />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Minimum job</span>
            <input name="minimumJob" type="number" step="0.01" min="0" className={input} defaultValue={89} />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Their cost per labor hour</span>
            <input name="laborCostRate" type="number" step="0.01" min="0" className={input} defaultValue={32} />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Tax rate (%)</span>
            <input name="taxRate" type="number" step="0.001" min="0" max="100" className={input} defaultValue={0} />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Tax applies to</span>
            <select name="taxAppliesTo" className={input} defaultValue="none">
              <option value="none">Nothing</option>
              <option value="all">All services</option>
              <option value="commercial">Commercial only</option>
            </select>
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Supply cost multiplier</span>
            <input
              name="supplyCostMultiplier"
              type="number"
              step="0.05"
              min="0.05"
              className={input}
              defaultValue={1}
            />
            <span className="mt-1 block text-xs text-slate-500">
              1.0 = US wholesale prices. Raise it for expensive markets, lower it for cheap ones — the
              margin figure is only as good as this number.
            </span>
          </label>

          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Create and issue key
            </button>
          </div>
        </form>
      )}

      {tenants.length === 0 ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
          No licensed accounts yet. Each one gets an API key for{' '}
          <span className="font-mono">POST /api/v1/quote</span>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white dark:bg-white/[0.03]">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">This month</th>
                <th className="px-4 py-3 font-medium">Quoted</th>
                <th className="px-4 py-3 font-medium">Calibration</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.contactEmail}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STYLES[t.plan] ?? PLAN_STYLES.trial}`}
                    >
                      {t.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-500">
                      <KeyRound className="h-3.5 w-3.5" />…{t.keyLast4}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {t.hourlyRate} {t.currency}/h
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {t.used.toLocaleString()} / {t.monthlyQuota.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {t.quotedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} {t.currency}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {t.sampleSize > 0 ? `${t.sampleSize} jobs` : 'defaults'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
