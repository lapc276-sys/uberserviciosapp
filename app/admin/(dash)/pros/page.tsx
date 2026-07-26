import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { listPros, listBookings } from '@/lib/data';
import { getCity } from '@/lib/config/cities';
import { ProsManager } from '@/components/admin/ProsManager';

export const metadata: Metadata = buildMetadata({ title: 'Pros | Homigo Admin', path: '/admin/pros', noindex: true });
export const dynamic = 'force-dynamic';

export default async function ProsPage() {
  const [pros, bookings] = await Promise.all([listPros(), listBookings(500)]);

  const jobsByPro = new Map<string, number>();
  for (const b of bookings) if (b.proId) jobsByPro.set(b.proId, (jobsByPro.get(b.proId) ?? 0) + 1);

  const applied = pros.filter((p) => p.status === 'APPLIED').length;

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Pros</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {pros.filter((p) => p.status === 'APPROVED').length} approved
          {applied > 0 && ` · ${applied} awaiting review`}
        </p>
      </div>

      <ProsManager
        pros={pros.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          status: p.status,
          rating: p.rating,
          yearsExperience: p.yearsExperience,
          hasTransport: p.hasTransport,
          areas: p.serviceAreas.map((slug) => getCity(slug)?.name ?? slug),
          jobs: jobsByPro.get(p.id) ?? 0,
        }))}
      />
    </section>
  );
}
