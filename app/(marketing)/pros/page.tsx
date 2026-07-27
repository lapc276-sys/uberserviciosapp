import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Calendar, MapPin, Wallet, Clock, AlertTriangle } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { bookingsForPro, openOffersForPro, getProById } from '@/lib/data';
import { earningsForPro } from '@/lib/payouts';
import { formatCurrency } from '@/lib/utils';
import { ProSignOut } from '@/components/pros/ProSignOut';

export const metadata: Metadata = buildMetadata({ title: 'My jobs | Homigo Pros', path: '/pros', noindex: true });
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  SCHEDULED: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  CANCELED: 'bg-red-50 text-red-600 dark:bg-red-950/30',
};

export default async function ProDashboard() {
  const jar = await cookies();
  const session = await verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value);
  if (!session) redirect('/pros/login');

  const [pro, jobs, offers, earnings] = await Promise.all([
    getProById(session.proId),
    bookingsForPro(session.proId),
    openOffersForPro(session.proId),
    earningsForPro(session.proId),
  ]);

  const upcoming = jobs.filter((j) => j.status === 'SCHEDULED' || j.status === 'IN_PROGRESS');
  const past = jobs.filter((j) => j.status === 'COMPLETED');

  return (
    <section className="border-b">
      <div className="container py-10 sm:py-14">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Hi {(pro?.name ?? session.name).split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {upcoming.length} upcoming · {offers.length} open offer{offers.length === 1 ? '' : 's'}
            </p>
          </div>
          <ProSignOut />
        </div>

        {/* Earnings */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Tile label="Paid out" value={formatCurrency(earnings.paidCents / 100)} icon={<Wallet className="h-5 w-5" />} />
          <Tile label="Pending" value={formatCurrency(earnings.pendingCents / 100)} icon={<Clock className="h-5 w-5" />} />
          <Tile label="Jobs completed" value={String(past.length)} icon={<Calendar className="h-5 w-5" />} />
        </div>

        <div className="mt-4">
          <Link
            href="/pros/payouts"
            className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:text-slate-300"
          >
            <Wallet className="h-4 w-4" /> Payout settings
          </Link>
        </div>

        {/* Open offers */}
        {offers.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold">Open offers</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">First to accept gets the job.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {offers.map((o) => (
                <Link
                  key={o.ref}
                  href={`/pros/jobs/${o.ref}`}
                  className="rounded-2xl border-2 border-brand-200 bg-white p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:border-brand-900 dark:bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{o.serviceName}</span>
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                      New offer
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {o.date} · {o.time}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5" /> {o.city}
                  </p>
                  {o.quoteLow && (
                    <p className="mt-3 font-semibold text-brand-700 dark:text-brand-300">
                      You earn ~{formatCurrency(Math.round(o.quoteLow * 0.75))}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold">Your schedule</h2>
          {upcoming.length === 0 ? (
            <div className="mt-4 rounded-2xl border bg-white p-8 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
              No jobs scheduled yet. New offers in your areas arrive by text.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {upcoming.map((j) => (
                <div key={j.ref} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{j.serviceName}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLES[j.status]}`}>{j.status}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-sm text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                    <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {j.date} · {j.time}</span>
                    <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {j.address}, {j.city}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400">{j.customerName} · {j.customerPhone}</span>
                    {j.quoteLow && (
                      <span className="font-semibold">{formatCurrency(Math.round(j.quoteLow * 0.75))}</span>
                    )}
                  </div>
                  {j.notes && (
                    <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                      {j.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {pro?.status !== 'APPROVED' && (
          <div className="mt-8 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Your account is not currently approved for new jobs. Contact support if you think this is a mistake.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Tile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
      <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
        {icon}
      </span>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
