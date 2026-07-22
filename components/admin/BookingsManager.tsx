'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface Booking {
  ref: string;
  serviceName: string;
  customerName: string;
  city: string;
  date: string;
  time: string;
  quoteLow: number | null;
  status: string;
  employeeName: string | null;
}

const STATUSES = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'];

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  SCHEDULED: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  PENDING: 'bg-slate-100 text-slate-600 dark:bg-white/5',
  CANCELED: 'bg-red-50 text-red-600 dark:bg-red-950/30',
};

export function BookingsManager({ bookings }: { bookings: Booking[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string>('');

  async function patch(ref: string, body: object) {
    setBusy(ref);
    await fetch(`/api/admin/bookings/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy('');
    startTransition(() => router.refresh());
  }

  if (bookings.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
        No bookings yet. They appear here as soon as customers book.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="p-4">Ref</th>
            <th className="p-4">Customer</th>
            <th className="p-4">Service</th>
            <th className="p-4">Date</th>
            <th className="p-4">Est.</th>
            <th className="p-4">Pro</th>
            <th className="p-4">Status</th>
            <th className="p-4"></th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.ref} className="border-b last:border-0">
              <td className="p-4 font-mono text-xs">{b.ref}</td>
              <td className="p-4">{b.customerName}<span className="block text-xs text-slate-400">{b.city}</span></td>
              <td className="p-4">{b.serviceName}</td>
              <td className="p-4">{b.date}<span className="block text-xs text-slate-400">{b.time}</span></td>
              <td className="p-4 font-medium">{b.quoteLow ? `${formatCurrency(b.quoteLow)}+` : '—'}</td>
              <td className="p-4">
                {b.employeeName ? (
                  <span>{b.employeeName}</span>
                ) : (
                  <button
                    onClick={() => patch(b.ref, { action: 'auto-assign' })}
                    disabled={busy === b.ref}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50 dark:text-slate-300"
                  >
                    {busy === b.ref ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Assign
                  </button>
                )}
              </td>
              <td className="p-4">
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLES[b.status] ?? STATUS_STYLES.PENDING}`}>{b.status}</span>
              </td>
              <td className="p-4">
                <select
                  value={b.status}
                  onChange={(e) => patch(b.ref, { status: e.target.value })}
                  disabled={busy === b.ref || pending}
                  className="rounded-lg border bg-white px-2 py-1 text-xs outline-none focus:border-brand-400 dark:bg-white/5"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
