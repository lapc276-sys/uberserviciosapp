import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenantBySlug } from '@/lib/tenants/store';
import { services } from '@/lib/config/services';
import { HostedQuote } from '@/components/public/HostedQuote';

/**
 * A cleaning company's own instant-quote page, hosted by us.
 *
 * This is the half of the product that makes the engine sellable. The API is
 * fine for a company with a developer; the ones who lose two hours driving out
 * to quote a $200 job do not have one. They get a link, put it on their site or
 * their Google listing, and are finished.
 *
 * Deliberately unbranded on our side. They are paying for the estimate, not to
 * advertise us to their own customers.
 */

export const dynamic = 'force-dynamic';

/** A colour from tenant settings ends up in a style attribute — validate it. */
function safeColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: 'Not found', robots: { index: false, follow: false } };

  const name = tenant.branding.displayName;
  const title = `Presupuesto instantáneo | ${name}`;
  const description = `Graba un vídeo corto de tu casa y recibe un estimado de ${name} en segundos.`;

  return {
    title,
    description,
    // Every one of these overrides a default inherited from our own site.
    // Without them the link a homeowner forwards on WhatsApp previews as our
    // company, with a canonical pointing at our domain — advertising us to
    // someone else's customer, which is the opposite of what they bought.
    openGraph: {
      title,
      description,
      siteName: name,
      images: tenant.branding.logoUrl ? [{ url: tenant.branding.logoUrl }] : [],
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
    alternates: { canonical: null },
    // Not ours to index on their behalf, and a thin page per tenant would be
    // duplicate content besides.
    robots: { index: false, follow: false },
  };
}

export default async function HostedQuotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const accent = safeColor(tenant.branding.primaryColor, '#1b6ff5');
  const name = tenant.branding.displayName;

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-ink">
      <header className="border-b bg-white dark:bg-ink-soft">
        <div className="mx-auto flex h-16 max-w-lg items-center gap-3 px-4">
          {tenant.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.branding.logoUrl} alt={name} className="h-8 w-auto max-w-[160px] object-contain" />
          ) : (
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold text-white"
              style={{ background: accent }}
            >
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="truncate font-semibold">{name}</span>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Presupuesto en 60 segundos</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sin visitas, sin esperas. Graba un recorrido rápido de tu casa y te damos un estimado al momento.
          </p>
        </div>

        <HostedQuote
          slug={tenant.slug}
          company={name}
          accent={accent}
          services={services.map((s) => ({ slug: s.slug, name: s.name }))}
        />

        <p className="mt-8 text-center text-xs text-slate-400">
          Las imágenes se usan solo para calcular tu estimado.
        </p>
      </div>
    </main>
  );
}
