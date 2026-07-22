import type { Metadata } from 'next';
import { TrendingUp, Users, CalendarCheck, DollarSign, Star, Repeat } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({ title: 'Admin Dashboard | Homigo', path: '/admin', noindex: true });

/**
 * Admin dashboard preview (Phase 5). Static sample data today; wires to the
 * database and live KPIs once auth + persistence land. Route is noindex and
 * will sit behind role-based auth in production.
 */
const kpis = [
  { icon: DollarSign, label: 'Revenue (MTD)', value: '$48,920', delta: '+18%' },
  { icon: CalendarCheck, label: 'Bookings', value: '412', delta: '+9%' },
  { icon: Users, label: 'New customers', value: '86', delta: '+12%' },
  { icon: Repeat, label: 'Recurring rate', value: '54%', delta: '+3%' },
  { icon: Star, label: 'Avg. rating', value: '4.9', delta: '+0.1' },
  { icon: TrendingUp, label: 'CAC', value: '$34', delta: '-6%' },
];

const recent = [
  { id: 'HMG-8F2A', customer: 'A. Rivera', service: 'Deep Clean', city: 'Miami', total: '$189', status: 'Completed' },
  { id: 'HMG-8F2B', customer: 'J. Chen', service: 'Move Out', city: 'Fort Lauderdale', total: '$264', status: 'Scheduled' },
  { id: 'HMG-8F2C', customer: 'M. Okafor', service: 'Airbnb', city: 'Miami Beach', total: '$132', status: 'In progress' },
  { id: 'HMG-8F2D', customer: 'S. Patel', service: 'House Clean', city: 'Orlando', total: '$154', status: 'Scheduled' },
];

export default function AdminDashboard() {
  return (
    <section>
      <div className="container py-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Live operations overview · sample data</p>
          </div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Preview · Phase 5</span>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><k.icon className="h-5 w-5" /></span>
                <span className={`text-xs font-medium ${k.delta.startsWith('-') ? 'text-emerald-600' : 'text-emerald-600'}`}>{k.delta}</span>
              </div>
              <p className="mt-4 text-2xl font-semibold">{k.value}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{k.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
          <div className="border-b p-5">
            <h2 className="font-semibold">Recent bookings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="p-4">ID</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Service</th>
                  <th className="p-4">City</th>
                  <th className="p-4">Total</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-4 font-mono text-xs">{r.id}</td>
                    <td className="p-4">{r.customer}</td>
                    <td className="p-4">{r.service}</td>
                    <td className="p-4">{r.city}</td>
                    <td className="p-4 font-medium">{r.total}</td>
                    <td className="p-4">
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs dark:bg-white/5">{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
