import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { getAnalytics } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({ title: 'Analytics | Homigo Admin', path: '/admin/analytics', noindex: true });
export const dynamic = 'force-dynamic';

/**
 * Analytics dashboard (Phase 5). Single-series magnitude charts use one
 * validated brand hue (brand-600 light / brand-500 dark); all text stays in
 * ink tokens. Zero chart dependencies — server-rendered bars.
 */
export default async function AnalyticsPage() {
  const a = await getAnalytics();

  const tiles = [
    { label: 'Booked value', value: formatCurrency(a.estRevenue), sub: 'sum of quote midpoints' },
    { label: 'Avg. ticket', value: formatCurrency(a.avgTicket), sub: 'per booking' },
    { label: 'Lead → booking', value: `${a.conversionPct}%`, sub: `${a.funnel.leads} leads captured` },
    { label: 'Completion rate', value: `${a.completionPct}%`, sub: `${a.funnel.completed} completed` },
    { label: 'Recurring share', value: `${a.recurringPct}%`, sub: 'of all bookings' },
  ];

  const maxDay = Math.max(1, ...a.byDay.map((d) => d.count));
  const maxService = Math.max(1, ...a.byService.map((s) => s.value));
  const maxFunnel = Math.max(1, a.funnel.leads);

  const funnelSteps = [
    { label: 'Leads', value: a.funnel.leads },
    { label: 'Bookings', value: a.funnel.bookings },
    { label: 'Completed', value: a.funnel.completed },
  ];

  return (
    <section className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Funnel, demand and revenue signals</p>
        </div>
        {a.source === 'memory' && (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            In-memory data
          </span>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold">{t.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Bookings — last 14 days */}
        <div className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
          <h2 className="font-semibold">Bookings — last 14 days</h2>
          <p className="text-xs text-slate-400">Daily count · hover a bar for detail</p>
          <div className="mt-6 flex h-40 items-end gap-[2px]">
            {a.byDay.map((d) => (
              <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.count} booking${d.count === 1 ? '' : 's'} · ${formatCurrency(d.value)}`}>
                <div
                  className="w-full rounded-t bg-brand-600 transition-opacity group-hover:opacity-80 dark:bg-brand-500"
                  style={{ height: `${Math.max(d.count > 0 ? 6 : 2, (d.count / maxDay) * 100)}%`, opacity: d.count === 0 ? 0.15 : 1 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{a.byDay[0]?.date.slice(5)}</span>
            <span>{a.byDay[a.byDay.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        {/* Funnel */}
        <div className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
          <h2 className="font-semibold">Conversion funnel</h2>
          <p className="text-xs text-slate-400">Leads → bookings → completed</p>
          <div className="mt-6 space-y-4">
            {funnelSteps.map((step) => (
              <div key={step.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300">{step.label}</span>
                  <span className="font-medium">{step.value}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                  <div className="h-full rounded-full bg-brand-600 dark:bg-brand-500" style={{ width: `${(step.value / maxFunnel) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue by service */}
        <div className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
          <h2 className="font-semibold">Booked value by service</h2>
          <p className="text-xs text-slate-400">Where the money comes from</p>
          {a.byService.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400">No bookings yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {a.byService.slice(0, 6).map((s) => (
                <div key={s.name} title={`${s.name}: ${s.count} bookings · ${formatCurrency(s.value)}`}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">{s.name}</span>
                    <span className="font-medium">{formatCurrency(s.value)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                    <div className="h-full rounded-full bg-brand-600 dark:bg-brand-500" style={{ width: `${(s.value / maxService) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bookings by city + data table */}
        <div className="rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
          <h2 className="font-semibold">Bookings by city</h2>
          <p className="text-xs text-slate-400">Demand by service area</p>
          {a.byCity.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400">No bookings yet.</p>
          ) : (
            <table className="mt-5 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2">City</th>
                  <th className="pb-2 text-right">Bookings</th>
                  <th className="pb-2 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {a.byCity.map((c) => (
                  <tr key={c.name} className="border-b last:border-0">
                    <td className="py-2.5">{c.name}</td>
                    <td className="py-2.5 text-right font-medium">{c.count}</td>
                    <td className="py-2.5 text-right text-slate-500 dark:text-slate-400">
                      {Math.round((c.count / Math.max(1, a.funnel.bookings)) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
