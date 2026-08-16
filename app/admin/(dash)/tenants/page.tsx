import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { listTenants, getUsage, countTenantLeads } from '@/lib/tenants/store';
import { TenantsManager } from '@/components/admin/TenantsManager';

export const metadata: Metadata = buildMetadata({
  title: 'Licensing | Homigo Admin',
  path: '/admin/tenants',
  noindex: true,
});
export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  const tenants = await listTenants();
  const [usage, leadCounts] = await Promise.all([
    Promise.all(tenants.map((t) => getUsage(t.id))),
    Promise.all(tenants.map((t) => countTenantLeads(t.id))),
  ]);

  const rows = tenants.map((t, i) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    contactEmail: t.contactEmail,
    plan: t.plan,
    active: t.active,
    monthlyQuota: t.monthlyQuota,
    keyLast4: t.keyLast4,
    currency: t.pricing.currency,
    hourlyRate: t.pricing.hourlyRate,
    sampleSize: t.calibration.sampleSize,
    used: usage[i].quotes,
    quotedValue: usage[i].quotedValue,
    leads: leadCounts[i],
    createdAt: t.createdAt,
  }));

  const activeQuotes = rows.reduce((sum, r) => sum + r.used, 0);

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Licensing</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Companies using the quoting engine through the API
          {rows.length > 0 && ` · ${activeQuotes.toLocaleString()} quotes this month`}
        </p>
      </div>

      <TenantsManager tenants={rows} />
    </section>
  );
}
