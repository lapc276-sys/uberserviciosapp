import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { buildMetadata } from '@/lib/seo';
import { getOrder } from '@/lib/delivery/store';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({ title: 'Your order', path: '/orders', noindex: true });
export const dynamic = 'force-dynamic';

/**
 * Where the texts land: card saved, payment approved, order status.
 *
 * Deliberately shows the *minimum*. An order ref travels through SMS, gets
 * forwarded and screenshotted, and is short enough to guess — so this page
 * never renders the address, the phone number or the customer's name. Status
 * and money only.
 */
export default async function OrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ card?: string; paid?: string }>;
}) {
  const { ref } = await params;
  const query = await searchParams;
  const order = await getOrder(ref);
  if (!order) notFound();

  const banner =
    query.paid === '1'
      ? { tone: 'good', text: 'Payment received — your laundry is on its way back.' }
      : query.card === 'saved'
        ? { tone: 'good', text: 'Card saved. Nothing has been charged — we bill after your laundry is weighed.' }
        : query.card === 'canceled'
          ? { tone: 'warn', text: 'Card setup was canceled. We can’t schedule the pickup until it’s saved.' }
          : null;

  const paymentCopy: Record<string, string> = {
    AWAITING_CARD: 'Waiting for a card — nothing charged yet',
    CARD_ON_FILE: 'Card saved · charged after the weigh-in',
    NEEDS_CONFIRMATION: 'Needs your approval before we charge',
    PAID: 'Paid',
    FAILED: 'Payment didn’t go through',
  };

  return (
    <section className="mx-auto max-w-lg px-4 py-16">
      <p className="text-xs uppercase tracking-widest text-slate-400">{site.name} · Laundry</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Order {order.ref}</h1>

      {banner && (
        <div
          className={`mt-6 rounded-2xl p-4 text-sm ${
            banner.tone === 'good'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
          }`}
        >
          {banner.text}
        </div>
      )}

      <dl className="mt-8 space-y-4 rounded-2xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <dt className="text-sm text-slate-500 dark:text-slate-400">Status</dt>
          <dd className="font-medium">{order.status.toLowerCase().replace(/_/g, ' ')}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-sm text-slate-500 dark:text-slate-400">Bags</dt>
          <dd className="font-medium">{order.items}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-sm text-slate-500 dark:text-slate-400">
            {order.finalTotal != null ? 'Total' : 'Estimate'}
          </dt>
          <dd className="font-medium tabular-nums">
            {order.finalTotal != null
              ? `$${order.finalTotal.toFixed(2)}`
              : order.estimateLow != null && order.estimateHigh != null
                ? `$${order.estimateLow.toFixed(2)}–$${order.estimateHigh.toFixed(2)}`
                : '—'}
          </dd>
        </div>
        {order.weighedPounds != null && (
          <div className="flex items-center justify-between">
            <dt className="text-sm text-slate-500 dark:text-slate-400">Weighed</dt>
            <dd className="font-medium tabular-nums">{order.weighedPounds} lb</dd>
          </div>
        )}
        <div className="flex items-center justify-between border-t pt-4">
          <dt className="text-sm text-slate-500 dark:text-slate-400">Payment</dt>
          <dd className="font-medium">{paymentCopy[order.paymentState] ?? order.paymentState}</dd>
        </div>
      </dl>

      {order.paymentState === 'NEEDS_CONFIRMATION' && order.confirmUrl && (
        <a
          href={order.confirmUrl}
          className="mt-6 block rounded-xl bg-brand-600 px-5 py-3 text-center font-medium text-white hover:bg-brand-700"
        >
          Approve ${order.finalTotal?.toFixed(2)} and get it delivered
        </a>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Questions? Text us back or call {site.phone}. We only charge after your laundry is weighed, and never more than
        your estimate without asking first.
      </p>
    </section>
  );
}
