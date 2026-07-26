'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Loader2, PartyPopper } from 'lucide-react';

/**
 * Accept / decline controls for a job offer.
 *
 * The pro picker is an interim stand-in for real pro authentication — the SMS
 * link identifies the job, not the pro. Replace with a magic-link session
 * before launch (tracked as the pro-auth milestone).
 */
export function JobOfferActions({ refId, pros }: { refId: string; pros: { id: string; name: string }[] }) {
  const router = useRouter();
  const [proId, setProId] = useState(pros[0]?.id ?? '');
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);

  async function respond(action: 'accept' | 'decline') {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/pros/jobs/${refId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        router.refresh();
        return;
      }
      if (action === 'accept') setAccepted(true);
      else setDeclined(true);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (accepted) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-5 text-center dark:bg-emerald-950/30">
        <PartyPopper className="mx-auto h-6 w-6 text-emerald-600" />
        <p className="mt-2 font-semibold text-emerald-900 dark:text-emerald-200">The job is yours</p>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-300/80">
          We just texted you the full address and customer details.
        </p>
      </div>
    );
  }

  if (declined) {
    return (
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
        Thanks for letting us know — we’ll send the next one your way.
      </p>
    );
  }

  return (
    <div>
      {pros.length > 1 && (
        <div className="mb-4">
          <label className="text-sm font-medium">Who’s responding?</label>
          <select
            value={proId}
            onChange={(e) => setProId(e.target.value)}
            className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
          >
            {pros.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={() => respond('accept')}
          disabled={busy !== null}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
        >
          {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Accept job
        </button>
        <button
          onClick={() => respond('decline')}
          disabled={busy !== null}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/5"
        >
          {busy === 'decline' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          Pass
        </button>
      </div>
    </div>
  );
}
