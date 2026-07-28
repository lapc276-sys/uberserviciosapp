import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { getChannelPerformance, listCustomers } from '@/lib/data';
import { segmentCustomers } from '@/lib/marketing/campaigns';
import { promos } from '@/lib/marketing/promos';
import { formatCurrency } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({ title: 'Marketing | Homigo Admin', path: '/admin/marketing', noindex: true });
export const dynamic = 'force-dynamic';

const SEGMENT_LABELS: Record<string, string> = {
  lapsed: 'Lapsed',
  one_time: 'One-time',
  loyal: 'Loyal',
  high_value: 'High value',
};

const SEGMENT_NOTES: Record<string, string> = {
  lapsed: 'No booking in 45+ days — cheapest revenue to win back',
  one_time: 'Booked once — target for a recurring plan',
  loyal: '3+ bookings — referral candidates',
  high_value: 'Spend over $600 — protect these',
};

export default async function MarketingPage() {
  const [channels, customers] = await Promise.all([getChannelPerformance(), listCustomers()]);
  const segmented = segmentCustomers(customers);

  const bySegment = segmented.reduce<Record<string, number>>((acc, c) => {
    acc[c.segment] = (acc[c.segment] ?? 0) + 1;
    return acc;
  }, {});

  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);
  const maxRevenue = Math.max(1, ...channels.map((c) => c.revenue));

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Where bookings come from, who to re-engage, and which offers are live
        </p>
      </div>

      {/* Attribution */}
      <div className="rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Bookings by channel</h2>
          <p className="text-xs text-slate-400">
            First-touch attribution. <span className="font-medium">Max CAC</span> is what you can pay per booking and
            still break even on the first job — spend above it only if customers come back.
          </p>
        </div>
        {channels.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No bookings yet. Tag your ads with <span className="font-mono text-xs">?utm_source=google&amp;utm_medium=cpc</span> and
            attribution appears here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="p-4">Channel</th>
                  <th className="p-4">Bookings</th>
                  <th className="p-4">Booked value</th>
                  <th className="p-4">Avg. ticket</th>
                  <th className="p-4">Max CAC</th>
                  <th className="p-4 w-40">Share</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={`${c.source}-${c.medium}`} className="border-b last:border-0">
                    <td className="p-4 font-medium">{c.channel}</td>
                    <td className="p-4">{c.bookings}</td>
                    <td className="p-4 font-medium">{formatCurrency(c.revenue)}</td>
                    <td className="p-4">{formatCurrency(c.avgTicket)}</td>
                    <td className="p-4">{formatCurrency(c.maxCac)}</td>
                    <td className="p-4">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div
                          className="h-full rounded-full bg-brand-600 dark:bg-brand-500"
                          style={{ width: `${(c.revenue / maxRevenue) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-slate-50/50 dark:bg-white/[0.02]">
                  <td className="p-4 font-medium">Total</td>
                  <td className="p-4 font-medium">{channels.reduce((s, c) => s + c.bookings, 0)}</td>
                  <td className="p-4 font-medium">{formatCurrency(totalRevenue)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Segments */}
      <div className="mt-8">
        <h2 className="font-semibold">Customer segments</h2>
        <p className="text-xs text-slate-400">
          Lifecycle emails run weekly against these. Every send honors the opt-out list.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(['lapsed', 'one_time', 'loyal', 'high_value'] as const).map((segment) => (
            <div key={segment} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
              <p className="text-2xl font-semibold">{bySegment[segment] ?? 0}</p>
              <p className="text-sm font-medium">{SEGMENT_LABELS[segment]}</p>
              <p className="mt-1 text-xs text-slate-400">{SEGMENT_NOTES[segment]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Promos */}
      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Promo codes</h2>
          <p className="text-xs text-slate-400">
            Edit in <span className="font-mono">lib/marketing/promos.ts</span> — validated server-side on every booking.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="p-4">Code</th>
                <th className="p-4">Offer</th>
                <th className="p-4">Conditions</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => {
                const conditions = [
                  p.minSubtotal ? `min ${formatCurrency(p.minSubtotal)}` : null,
                  p.firstTimeOnly ? 'first-time only' : null,
                  p.services?.length ? `${p.services.length} service(s)` : null,
                  p.cities?.length ? `${p.cities.length} city(ies)` : null,
                ].filter(Boolean);
                return (
                  <tr key={p.code} className="border-b last:border-0">
                    <td className="p-4 font-mono text-xs font-medium">{p.code}</td>
                    <td className="p-4">{p.label}</td>
                    <td className="p-4 text-slate-500 dark:text-slate-400">
                      {conditions.length ? conditions.join(' · ') : 'No restrictions'}
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs ${
                          p.active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-white/5'
                        }`}
                      >
                        {p.active ? 'Active' : 'Off'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
