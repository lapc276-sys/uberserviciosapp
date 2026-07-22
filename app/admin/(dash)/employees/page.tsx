import type { Metadata } from 'next';
import { Star } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { listEmployees, listBookings } from '@/lib/data';

export const metadata: Metadata = buildMetadata({ title: 'Team | Homigo Admin', path: '/admin/employees', noindex: true });
export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const [employees, bookings] = await Promise.all([listEmployees(), listBookings(500)]);
  const jobsByEmp = new Map<string, number>();
  for (const b of bookings) if (b.employeeId) jobsByEmp.set(b.employeeId, (jobsByEmp.get(b.employeeId) ?? 0) + 1);

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{employees.filter((e) => e.active).length} active pros</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {employees.map((e) => (
          <div key={e.id} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
            <div className="flex items-center justify-between">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/50">
                {e.name.split(' ').map((n) => n[0]).join('')}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs ${e.active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/5'}`}>
                {e.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <h2 className="mt-4 font-semibold">{e.name}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{e.email}</p>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 text-amber-400" /> {e.rating.toFixed(1)}</span>
              <span className="text-slate-500 dark:text-slate-400">{jobsByEmp.get(e.id) ?? 0} jobs</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
