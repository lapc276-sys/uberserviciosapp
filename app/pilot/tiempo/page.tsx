import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Timer } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { JobTimer } from '@/components/pilot/JobTimer';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Cronómetro | Klaudy Pilot',
  path: '/pilot/tiempo',
  noindex: true,
});

export const dynamic = 'force-dynamic';

/**
 * Where the time model stops being a guess.
 *
 * Everything priced by this product is minutes multiplied by a rate, and the
 * minutes currently come from constants fitted to a single measured day. This
 * screen is the only thing that changes that, so it is deliberately its own
 * page with nothing else on it.
 */
export default async function JobTimerPage() {
  const jar = await cookies();
  const [proSession, adminSession] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);

  if (!(proSession?.email || adminSession?.email)) redirect('/pros/login?next=/pilot/tiempo');

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-ink">
      <header className="border-b bg-white dark:bg-ink-soft">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link href="/pilot" className="text-sm font-semibold">
            {site.name} Pilot
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            <Timer className="h-3.5 w-3.5" /> Cronómetro
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        <JobTimer />
      </div>
    </main>
  );
}
