import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { listCustomers } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({ title: 'Customers | Homigo Admin', path: '/admin/customers', noindex: true });
export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const customers = await listCustomers();
  const totalLtv = customers.reduce((s, c) => s + c.ltv, 0);

  return (
    <section className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{customers.length} customers · {formatCurrency(totalLtv)} total lifetime value</p>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
          No customers yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="p-4">Customer</th>
                <th className="p-4">Contact</th>
                <th className="p-4">Bookings</th>
                <th className="p-4">LTV</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.email + c.phone} className="border-b last:border-0">
                  <td className="p-4 font-medium">{c.name}</td>
                  <td className="p-4 text-slate-500 dark:text-slate-400">{c.email}<span className="block text-xs">{c.phone}</span></td>
                  <td className="p-4">{c.bookings}</td>
                  <td className="p-4 font-semibold">{formatCurrency(c.ltv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
