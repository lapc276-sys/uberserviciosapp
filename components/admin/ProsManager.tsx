'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, Car, Loader2 } from 'lucide-react';

interface Pro {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  rating: number;
  yearsExperience: number;
  hasTransport: boolean;
  areas: string[];
  jobs: number;
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  APPLIED: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  SUSPENDED: 'bg-red-50 text-red-600 dark:bg-red-950/30',
};

export function ProsManager({ pros }: { pros: Pro[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState('');

  async function setStatus(id: string, status: string) {
    setBusy(id);
    await fetch(`/api/admin/pros/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusy('');
    startTransition(() => router.refresh());
  }

  if (pros.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
        No pros yet. Applications from <span className="font-mono">/pros/apply</span> appear here.
      </div>
    );
  }

  // Pending applications first — they're the action item.
  const sorted = [...pros].sort((a, b) => (a.status === 'APPLIED' ? -1 : b.status === 'APPLIED' ? 1 : 0));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((p) => (
        <div key={p.id} className="flex flex-col rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
          <div className="flex items-start justify-between">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/50">
              {p.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLES[p.status] ?? STATUS_STYLES.APPLIED}`}>
              {p.status}
            </span>
          </div>

          <h2 className="mt-4 font-semibold">{p.name}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{p.email}</p>
          {p.phone && <p className="text-xs text-slate-400">{p.phone}</p>}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {p.areas.map((a) => (
              <span key={a} className="rounded-full border px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">{a}</span>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 text-amber-400" /> {p.rating.toFixed(1)}</span>
            <span>{p.yearsExperience}y exp</span>
            {p.hasTransport && <span className="inline-flex items-center gap-1"><Car className="h-4 w-4" /> Car</span>}
            <span className="ml-auto">{p.jobs} jobs</span>
          </div>

          <div className="mt-5 flex gap-2">
            {p.status !== 'APPROVED' && (
              <button
                onClick={() => setStatus(p.id, 'APPROVED')}
                disabled={busy === p.id}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-600 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy === p.id && <Loader2 className="h-3 w-3 animate-spin" />} Approve
              </button>
            )}
            {p.status === 'APPROVED' && (
              <button
                onClick={() => setStatus(p.id, 'SUSPENDED')}
                disabled={busy === p.id}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/5"
              >
                {busy === p.id && <Loader2 className="h-3 w-3 animate-spin" />} Suspend
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
