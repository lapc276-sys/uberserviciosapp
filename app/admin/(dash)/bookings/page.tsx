import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { listBookings } from '@/lib/data';
import { BookingsManager } from '@/components/admin/BookingsManager';

export const metadata: Metadata = buildMetadata({ title: 'Bookings | Homigo Admin', path: '/admin/bookings', noindex: true });
export const dynamic = 'force-dynamic';

export default async function BookingsPage() {
  const bookings = await listBookings(200);
  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Assign pros and manage status. {bookings.length} total.</p>
      </div>
      <BookingsManager
        bookings={bookings.map((b) => ({
          ref: b.ref,
          serviceName: b.serviceName,
          customerName: b.customerName,
          city: b.city,
          date: b.date,
          time: b.time,
          quoteLow: b.quoteLow,
          status: b.status,
          proName: b.proName,
        }))}
      />
    </section>
  );
}
