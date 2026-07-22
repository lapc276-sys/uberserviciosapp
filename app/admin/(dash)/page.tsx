import type { Metadata } from 'next';
import { TrendingUp, Users, CalendarCheck, DollarSign, Star, Repeat } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { getDashboardStats, listBookings } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({ title: 'Admin Dashboard | Homigo', path: '/admin', noindex: true });
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  SCHEDULED: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  PENDING: 'bg-slate-100 text-slate-600 dark:bg-white/5',
  CANCELED: 'bg-red-50 text-red-600 dark:bg-red-950/30',
};

export default async function AdminDashboard() {
  const [stats, bookings] = await Promise.all([getDashboardStats(), listBookings(15)]);

  const kpis = [
    { icon: DollarSign, label: 'Revenue (MTD)', value: formatCurrency(stats.revenueMtd) },
    { icon: CalendarCheck, label: 'Bookings', value: String(stats.bookings) },
    { icon: Users, label: 'New customers', value: String(stats.newCustomers) },
    { icon: Repeat, label: 'Recurring rate', value: `${stats.recurringRatePct}%` },
    { icon: Star, label: 'Avg. rating', value: String(stats.avgRating) },
    { icon: TrendingUp, label: 'Data source', value: stats.source === 'db' ? 'Live DB' : 'In-memory' },
  ];

  return (
    <section className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Operations overview</p>
        </div>
        {stats.source === 'memory' && (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            No DATABASE_URL · showing in-memory data
          </span>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><k.icon className="h-5 w-5" /></span>
            <p className="mt-4 text-2xl font-semibold">{k.value}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Recent bookings</h2>
        </div>
        {bookings.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No bookings yet. Create one from the <a href="/book" className="text-brand-600 underline">booking flow</a> and it appears here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="p-4">Ref</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Service</th>
                  <th className="p-4">City</th>
                  <th className="p-4">Date</th>
                  <th className="p-4">Est.</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="p-4 font-mono text-xs">{b.ref}</td>
                    <td className="p-4">{b.customerName}</td>
                    <td className="p-4">{b.serviceName}</td>
                    <td className="p-4">{b.city}</td>
                    <td className="p-4">{b.date}</td>
                    <td className="p-4 font-medium">{b.quoteLow ? `${formatCurrency(b.quoteLow)}+` : '—'}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLES[b.status] ?? STATUS_STYLES.PENDING}`}>{b.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
