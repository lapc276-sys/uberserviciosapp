import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Smartphone, ArrowLeft } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { DeviceCheck } from '@/components/pilot/DeviceCheck';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Device Check | Homigo Pilot',
  path: '/pilot/check',
  noindex: true,
});

export const dynamic = 'force-dynamic';

/**
 * Run this once on any phone before it is used for a real job.
 *
 * Phones fail in ways that only show up under load — a codec the browser
 * can't decode, a browser with no speech engine. This surfaces all of it in
 * half a minute, on the couch, instead of in a customer's kitchen.
 */
export default async function DeviceCheckPage() {
  const jar = await cookies();
  const [proSession, adminSession] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);

  if (!(proSession?.email || adminSession?.email)) redirect('/pros/login?next=/pilot/check');

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-ink">
      <header className="border-b bg-white dark:bg-ink-soft">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link href="/pilot" className="flex items-center gap-2 text-sm font-medium">
            <ArrowLeft className="h-4 w-4" /> {site.name} Pilot
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            <Smartphone className="h-3.5 w-3.5" /> Device check
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Is this phone ready?</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Run this on every phone before its first real job. It takes about thirty seconds.
          </p>
        </div>

        <DeviceCheck />
      </div>
    </main>
  );
}
