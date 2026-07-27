import { prisma, isDbConfigured } from './db';
import { payoutToPro, isStripeConfigured } from './stripe';
import { PRO_PAYOUT_SHARE } from './vision/pricing';
import { sendSms } from './sms';
import { site } from './config/site';
import type { BookingRecord } from './data';

/**
 * Pro earnings.
 *
 * Payouts are created exactly once per booking (unique constraint on
 * bookingId + a Stripe idempotency key derived from the ref), so retries and
 * double-clicks on "mark complete" can't pay a job twice.
 */

export interface PayoutRecord {
  bookingRef: string;
  proId: string;
  proName: string;
  amount: number; // cents
  status: 'PENDING' | 'PAID' | 'FAILED';
  createdAt: string;
}

const memoryPayouts: PayoutRecord[] = [];

/** The pro's share of a completed job, in whole dollars. */
export function payoutAmountFor(booking: BookingRecord): number {
  const gross =
    booking.quoteLow && booking.quoteHigh
      ? (booking.quoteLow + booking.quoteHigh) / 2
      : (booking.quoteLow ?? 0);
  return Math.round(gross * PRO_PAYOUT_SHARE);
}

export interface PayoutResult {
  created: boolean;
  paid: boolean;
  amount: number;
  reason?: string;
}

/**
 * Issues the pro's payout for a completed booking. Safe to call repeatedly —
 * an existing payout short-circuits.
 */
export async function issuePayout(booking: BookingRecord): Promise<PayoutResult> {
  if (!booking.proId) return { created: false, paid: false, amount: 0, reason: 'no_pro_assigned' };

  const amount = payoutAmountFor(booking);
  if (amount <= 0) return { created: false, paid: false, amount: 0, reason: 'no_amount' };

  // ── In-memory path ────────────────────────────────────────────────────────
  if (!isDbConfigured || !prisma) {
    if (memoryPayouts.some((p) => p.bookingRef === booking.ref)) {
      return { created: false, paid: false, amount, reason: 'already_issued' };
    }
    memoryPayouts.unshift({
      bookingRef: booking.ref,
      proId: booking.proId,
      proName: booking.proName ?? '',
      amount: amount * 100,
      status: isStripeConfigured ? 'PENDING' : 'PENDING',
      createdAt: new Date().toISOString(),
    });
    return { created: true, paid: false, amount, reason: isStripeConfigured ? undefined : 'stripe_not_configured' };
  }

  // ── Database path ─────────────────────────────────────────────────────────
  const dbBooking = await prisma.booking.findUnique({
    where: { ref: booking.ref },
    include: { pro: true, payout: true },
  });
  if (!dbBooking?.pro) return { created: false, paid: false, amount, reason: 'no_pro_assigned' };
  if (dbBooking.payout) return { created: false, paid: false, amount, reason: 'already_issued' };

  const payout = await prisma.payout.create({
    data: {
      bookingId: dbBooking.id,
      proId: dbBooking.pro.id,
      amount: amount * 100,
    },
  });

  const accountId = dbBooking.pro.stripeAccountId;
  if (!accountId) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'FAILED', failureReason: 'Pro has not completed payout onboarding' },
    });
    if (dbBooking.pro.phone) {
      await sendSms(
        dbBooking.pro.phone,
        `${site.name}: You earned $${amount} on ${booking.ref}, but we need your bank details to pay you. Finish setup: ${site.url}/pros/payouts`,
      );
    }
    return { created: true, paid: false, amount, reason: 'onboarding_incomplete' };
  }

  const transfer = await payoutToPro({ accountId, amountUsd: amount, bookingRef: booking.ref });
  if (!transfer) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: isStripeConfigured ? 'FAILED' : 'PENDING', failureReason: isStripeConfigured ? 'Transfer failed' : null },
    });
    return { created: true, paid: false, amount, reason: isStripeConfigured ? 'transfer_failed' : 'stripe_not_configured' };
  }

  await prisma.payout.update({
    where: { id: payout.id },
    data: { status: 'PAID', stripeTransferId: transfer.id, paidAt: new Date() },
  });

  if (dbBooking.pro.phone) {
    await sendSms(dbBooking.pro.phone, `${site.name}: $${amount} is on its way for job ${booking.ref}. Thanks for the great work!`);
  }

  return { created: true, paid: true, amount };
}

export interface ProEarnings {
  paidCents: number;
  pendingCents: number;
  jobs: number;
}

export async function earningsForPro(proId: string): Promise<ProEarnings> {
  if (!isDbConfigured || !prisma) {
    const mine = memoryPayouts.filter((p) => p.proId === proId);
    return {
      paidCents: mine.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0),
      pendingCents: mine.filter((p) => p.status !== 'PAID').reduce((s, p) => s + p.amount, 0),
      jobs: mine.length,
    };
  }

  const [paid, pending, jobs] = await Promise.all([
    prisma.payout.aggregate({ _sum: { amount: true }, where: { proId, status: 'PAID' } }),
    prisma.payout.aggregate({ _sum: { amount: true }, where: { proId, status: { not: 'PAID' } } }),
    prisma.payout.count({ where: { proId } }),
  ]);

  return {
    paidCents: paid._sum.amount ?? 0,
    pendingCents: pending._sum.amount ?? 0,
    jobs,
  };
}

export async function setProStripeAccount(proId: string, accountId: string): Promise<void> {
  if (!isDbConfigured || !prisma) return;
  await prisma.pro.update({ where: { id: proId }, data: { stripeAccountId: accountId } });
}

export async function getProStripeAccount(proId: string): Promise<string | null> {
  if (!isDbConfigured || !prisma) return null;
  const pro = await prisma.pro.findUnique({ where: { id: proId } });
  return pro?.stripeAccountId ?? null;
}
