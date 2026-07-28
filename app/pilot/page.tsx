import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ScanEye } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { PilotCapture } from '@/components/pilot/PilotCapture';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Field Capture | Homigo Pilot',
  path: '/pilot',
  noindex: true,
});

export const dynamic = 'force-dynamic';

/**
 * Standalone capture app — no marketing chrome, phone-first, used on the job.
 */
export default async function PilotPage() {
  const jar = await cookies();
  const [proSession, adminSession] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);

  const capturedBy = proSession?.name || proSession?.email || adminSession?.email;
  if (!capturedBy) redirect('/pros/login?next=/pilot');

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-ink">
      <header className="border-b bg-white dark:bg-ink-soft">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-white text-sm">H</span>
            <span className="text-sm">{site.name} Pilot</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            <ScanEye className="h-3.5 w-3.5" /> Field capture
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6">
        <PilotCapture capturedBy={capturedBy} />
      </div>
    </main>
  );
}
