import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { MapPin, Clock, Home, Bath, ArrowLeft } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { getBookingByRef, pendingOfferProIds } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';
import { JobOfferActions } from '@/components/pros/JobOfferActions';

export const metadata: Metadata = buildMetadata({ title: 'Job offer | Homigo Pros', path: '/pros/jobs', noindex: true });
export const dynamic = 'force-dynamic';

/**
 * Pro-facing job view. Shows what the pro needs to decide — pay, time,
 * neighborhood, scope — but withholds the street address and customer contact
 * until they've claimed the job.
 */
export default async function JobOfferPage({ params }: { params: Promise<{ ref: string }> }) {
  const jar = await cookies();
  const session = await verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value);
  if (!session) redirect(`/pros/login?next=/pros/jobs/${(await params).ref}`);

  const { ref } = await params;
  const booking = await getBookingByRef(ref);
  if (!booking) notFound();

  const pendingIds = await pendingOfferProIds(ref);
  const isMine = booking.proId === session.proId;
  const hasOffer = pendingIds.includes(session.proId);
  const claimedByOther = Boolean(booking.proId) && !isMine;

  // A pro with no relationship to this job sees nothing about it.
  if (!isMine && !hasOffer && !claimedByOther) notFound();

  const payout = booking.quoteLow ? Math.round(booking.quoteLow * 0.75) : null;

  return (
    <section className="border-b">
      <div className="container py-10 sm:py-14">
        <div className="mx-auto max-w-lg">
          <Link href="/pros" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" /> My jobs
          </Link>

          <div className="mt-6 rounded-3xl border bg-white p-7 shadow-lift dark:bg-ink-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  {isMine ? 'Your job' : 'Job offer'} · {booking.ref}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.serviceName}</h1>
              </div>
              {claimedByOther && (
                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  Claimed
                </span>
              )}
            </div>

            {payout !== null && (
              <div className="mt-6 rounded-2xl bg-brand-50 p-5 dark:bg-brand-950/30">
                <p className="text-sm text-brand-800 dark:text-brand-200">You earn</p>
                <p className="mt-0.5 text-3xl font-semibold text-brand-900 dark:text-brand-100">
                  {formatCurrency(payout)}
                </p>
                <p className="mt-1 text-xs text-brand-700/80 dark:text-brand-300/80">
                  Paid to your account after the job is completed.
                </p>
              </div>
            )}

            <div className="mt-6 space-y-3 text-sm">
              <Row icon={<Clock className="h-4 w-4" />} label="When" value={`${booking.date} · ${booking.time}`} />
              <Row
                icon={<MapPin className="h-4 w-4" />}
                label="Where"
                value={isMine ? `${booking.address}, ${booking.city}` : booking.city}
              />
              <Row icon={<Home className="h-4 w-4" />} label="Bedrooms" value={String(booking.bedrooms)} />
              <Row icon={<Bath className="h-4 w-4" />} label="Bathrooms" value={String(booking.bathrooms)} />
              {booking.sqft > 0 && <Row label="Size" value={`${booking.sqft.toLocaleString()} sqft`} />}
              {isMine && <Row label="Customer" value={`${booking.customerName} · ${booking.customerPhone}`} />}
            </div>

            {booking.notes && (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
                <p className="font-medium">Customer notes</p>
                <p className="mt-1">{booking.notes}</p>
              </div>
            )}

            {!isMine && !claimedByOther && (
              <p className="mt-5 text-xs text-slate-400">
                The exact address and customer contact are shared as soon as you accept.
              </p>
            )}

            <div className="mt-6">
              {isMine ? (
                <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  This job is yours. See you there!
                </p>
              ) : claimedByOther ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  Another pro accepted this one first.
                </p>
              ) : (
                <JobOfferActions refId={booking.ref} />
              )}
            </div>
          </div>

          {!isMine && !claimedByOther && (
            <p className="mt-5 text-center text-xs text-slate-400">
              Accepting is optional — passing never affects future offers.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed pb-2.5">
      <span className="inline-flex shrink-0 items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon} {label}
      </span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
