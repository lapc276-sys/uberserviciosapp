import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapPin, Clock, Home, Bath } from 'lucide-react';
import { buildMetadata } from '@/lib/seo';
import { getBookingByRef, pendingOfferProIds, listPros } from '@/lib/data';
import { formatCurrency } from '@/lib/utils';
import { JobOfferActions } from '@/components/pros/JobOfferActions';

export const metadata: Metadata = buildMetadata({ title: 'Job offer | Homigo Pros', path: '/pros/jobs', noindex: true });
export const dynamic = 'force-dynamic';

/**
 * Pro-facing job offer. Shows what the pro needs to decide — pay, time,
 * neighborhood and scope — while withholding the exact street address until
 * the job is claimed.
 */
export default async function JobOfferPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const booking = await getBookingByRef(ref);
  if (!booking) notFound();

  const claimed = Boolean(booking.proId);
  const [pendingIds, pros] = await Promise.all([pendingOfferProIds(ref), listPros('APPROVED')]);
  const offered = pros.filter((p) => pendingIds.includes(p.id));

  // Pro take-home before platform fee — shown up front so there are no surprises.
  const payout = booking.quoteLow ? Math.round(booking.quoteLow * 0.75) : null;

  return (
    <section className="border-b">
      <div className="container py-12 sm:py-16">
        <div className="mx-auto max-w-lg">
          <div className="rounded-3xl border bg-white p-7 shadow-lift dark:bg-ink-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Job offer · {booking.ref}</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.serviceName}</h1>
              </div>
              {claimed && (
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
                  Paid after the job is completed and confirmed.
                </p>
              </div>
            )}

            <div className="mt-6 space-y-3 text-sm">
              <Row icon={<Clock className="h-4 w-4" />} label="When" value={`${booking.date} · ${booking.time}`} />
              <Row icon={<MapPin className="h-4 w-4" />} label="Where" value={booking.city} />
              <Row icon={<Home className="h-4 w-4" />} label="Bedrooms" value={String(booking.bedrooms)} />
              <Row icon={<Bath className="h-4 w-4" />} label="Bathrooms" value={String(booking.bathrooms)} />
              {booking.sqft > 0 && (
                <Row icon={<Home className="h-4 w-4" />} label="Size" value={`${booking.sqft.toLocaleString()} sqft`} />
              )}
            </div>

            {booking.notes && (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
                <p className="font-medium">Customer notes</p>
                <p className="mt-1">{booking.notes}</p>
              </div>
            )}

            <p className="mt-5 text-xs text-slate-400">
              The full address and customer contact are shared as soon as you accept.
            </p>

            <div className="mt-6">
              {claimed ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  This job has already been accepted by another pro.
                </p>
              ) : offered.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  This offer is no longer open.
                </p>
              ) : (
                <JobOfferActions refId={booking.ref} pros={offered.map((p) => ({ id: p.id, name: p.name }))} />
              )}
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-slate-400">
            Accepting is optional — declining never affects future offers.
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed pb-2.5">
      <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon} {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
