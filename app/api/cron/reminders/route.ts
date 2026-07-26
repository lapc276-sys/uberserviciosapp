import { NextResponse } from 'next/server';
import { bookingsBetween, markReminderSent, type BookingRecord } from '@/lib/data';
import { sendEmail, reminderEmail, reviewRequestEmail, winbackEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { getService } from '@/lib/config/services';
import { timezoneForCity } from '@/lib/config/cities';
import { hoursUntil } from '@/lib/timezone';
import { site } from '@/lib/config/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Time-based automation runner (Vercel Cron, hourly — see vercel.json).
 *
 * Every decision resolves the booking's local wall-clock time against its
 * market timezone, so a 2h reminder really is ~2 hours before the appointment
 * whether the customer is in Manhattan or Miami. Each send is guarded by a
 * per-booking flag so it fires exactly once.
 *
 * Secure with CRON_SECRET: Vercel Cron sends `Authorization: Bearer <secret>`.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured (dev/preview) → allow
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);
  return auth === `Bearer ${secret}` || url.searchParams.get('key') === secret;
}

/** Widest candidate window: yesterday-ish through tomorrow, plus win-back reach. */
function utcDateStr(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// Cron runs hourly, so a ±1h band around each target catches every booking once.
const REMIND_24H = { min: 23, max: 25 };
const REMIND_2H = { min: 1, max: 3 };
const REVIEW_AFTER_HOURS = -4; // ~4h after the appointment started
const WINBACK_AFTER_HOURS = -24 * 7;

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 });

  const now = new Date();
  // Pull a generous window (UTC dates bracket every market's local date).
  const candidates = await bookingsBetween(utcDateStr(-10), utcDateStr(2));
  // `suppressed` records marketing sends withheld for opted-out recipients —
  // useful as a compliance signal in production logs.
  const summary = { remind24: 0, remind2: 0, review: 0, followup: 0, suppressed: 0, scanned: candidates.length };

  for (const b of candidates) {
    const tz = timezoneForCity(b.city);
    const hours = hoursUntil(b.date, b.time, tz, now);
    if (hours === null) continue;

    const service = getService(b.serviceSlug);
    const serviceName = service?.name ?? 'cleaning';
    const shortName = service?.shortName ?? 'cleaning';
    const active = b.status === 'SCHEDULED' || b.status === 'IN_PROGRESS';

    // 24h reminder
    if (active && !b.remind24Sent && hours >= REMIND_24H.min && hours <= REMIND_24H.max) {
      const { subject, html } = reminderEmail({ name: b.customerName, serviceName, date: b.date, time: b.time, when: '24h' });
      if (b.customerEmail) await sendEmail({ to: b.customerEmail, subject, html });
      if (b.customerPhone) await sendSms(b.customerPhone, `${site.name}: Reminder — your ${shortName} is tomorrow ${b.date} at ${b.time}. Ref ${b.ref}.`);
      await markReminderSent(b.ref, '24h');
      summary.remind24++;
    }

    // 2h reminder
    if (active && !b.remind2Sent && hours >= REMIND_2H.min && hours <= REMIND_2H.max) {
      const { subject, html } = reminderEmail({ name: b.customerName, serviceName, date: b.date, time: b.time, when: '2h' });
      if (b.customerEmail) await sendEmail({ to: b.customerEmail, subject, html });
      if (b.customerPhone) await sendSms(b.customerPhone, `${site.name}: Your ${shortName} starts in about 2 hours (${b.time}). See you soon! Ref ${b.ref}.`);
      await markReminderSent(b.ref, '2h');
      summary.remind2++;
    }

    // Post-service review request
    if (b.status !== 'CANCELED' && !b.reviewRequestSent && hours <= REVIEW_AFTER_HOURS) {
      const { subject, html } = reviewRequestEmail({ name: b.customerName, serviceName });
      if (b.customerEmail) await sendEmail({ to: b.customerEmail, subject, html });
      await markReminderSent(b.ref, 'review');
      summary.review++;
    }

    // One-week win-back with a discount offer
    if (b.status !== 'CANCELED' && !b.followUpSent && hours <= WINBACK_AFTER_HOURS) {
      const { subject, html } = winbackEmail({ name: b.customerName, email: b.customerEmail });
      if (b.customerEmail) {
        const outcome = await sendEmail({ to: b.customerEmail, subject, html, marketing: true });
        if (outcome === 'suppressed') summary.suppressed++;
      }
      await markReminderSent(b.ref, 'followup');
      summary.followup++;
    }
  }

  return NextResponse.json({ ok: true, ...summary, ranAt: now.toISOString() });
}
