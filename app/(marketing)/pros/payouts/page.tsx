import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { earningsForPro, getProStripeAccount } from '@/lib/payouts';
import { getAccountStatus, isStripeConfigured } from '@/lib/stripe';
import { formatCurrency } from '@/lib/utils';
import { PayoutOnboarding } from '@/components/pros/PayoutOnboarding';

export const metadata: Metadata = buildMetadata({ title: 'Payouts | Homigo Pros', path: '/pros/payouts', noindex: true });
export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  const jar = await cookies();
  const session = await verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value);
  if (!session) redirect('/pros/login');

  const [earnings, accountId] = await Promise.all([
    earningsForPro(session.proId),
    getProStripeAccount(session.proId),
  ]);
  const status = accountId ? await getAccountStatus(accountId) : null;
  const ready = Boolean(status?.payoutsEnabled);

  return (
    <section className="border-b">
      <div className="container py-10 sm:py-14">
        <div className="mx-auto max-w-lg">
          <Link href="/pros" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to my jobs
          </Link>

          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Payouts</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Where your earnings go after each completed job.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
              <p className="text-sm text-slate-500 dark:text-slate-400">Paid out</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(earnings.paidCents / 100)}</p>
            </div>
            <div className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
              <p className="text-sm text-slate-500 dark:text-slate-400">Pending</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(earnings.pendingCents / 100)}</p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
            {ready ? (
              <>
                <span className="inline-grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <h2 className="mt-4 font-semibold">You’re set up to get paid</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Earnings are transferred to your bank after each completed job.
                </p>
              </>
            ) : (
              <>
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <h2 className="mt-4 font-semibold">
                  {accountId ? 'Finish your payout setup' : 'Set up payouts'}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Stripe collects your bank and tax details securely — Homigo never sees or stores them. It takes about
                  three minutes, and you need it before we can send your first payment.
                </p>
                {!isStripeConfigured && (
                  <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Payouts aren’t switched on yet. You can still accept jobs — earnings are tracked and paid once setup
                    is live.
                  </p>
                )}
                <div className="mt-5">
                  <PayoutOnboarding disabled={!isStripeConfigured} resuming={Boolean(accountId)} />
                </div>
              </>
            )}
          </div>

          <p className="mt-6 text-xs text-slate-400">
            You’re an independent contractor. Homigo doesn’t withhold taxes — Stripe issues your 1099 when you meet the
            reporting threshold.
          </p>
        </div>
      </div>
    </section>
  );
}
