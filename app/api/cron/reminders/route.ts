import { NextResponse } from 'next/server';
import { bookingsDueFor, markReminderSent } from '@/lib/data';
import { sendEmail, reminderEmail, reviewRequestEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { getService } from '@/lib/config/services';
import { site } from '@/lib/config/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Time-based automation runner. Intended to be hit on a schedule (Vercel Cron,
 * see vercel.json). Sends 24h + 2h reminders and post-service review requests,
 * each guarded by a per-booking flag so it fires exactly once.
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

function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 });

  const today = dateStr(0);
  const tomorrow = dateStr(1);
  const summary = { remind24: 0, remind2: 0, review: 0 };

  // 24h reminders
  for (const b of await bookingsDueFor('24h', today, tomorrow)) {
    const service = getService(b.serviceSlug);
    const { subject, html } = reminderEmail({ name: b.customerName, serviceName: service?.name ?? 'cleaning', date: b.date, time: b.time, when: '24h' });
    if (b.customerEmail) await sendEmail({ to: b.customerEmail, subject, html });
    if (b.customerPhone) await sendSms(b.customerPhone, `${site.name}: Reminder — your ${service?.shortName ?? 'cleaning'} is tomorrow ${b.date} at ${b.time}. Ref ${b.ref}.`);
    await markReminderSent(b.ref, '24h');
    summary.remind24++;
  }

  // 2h reminders
  for (const b of await bookingsDueFor('2h', today, tomorrow)) {
    const service = getService(b.serviceSlug);
    const { subject, html } = reminderEmail({ name: b.customerName, serviceName: service?.name ?? 'cleaning', date: b.date, time: b.time, when: '2h' });
    if (b.customerEmail) await sendEmail({ to: b.customerEmail, subject, html });
    if (b.customerPhone) await sendSms(b.customerPhone, `${site.name}: Your ${service?.shortName ?? 'cleaning'} is today at ${b.time}. See you soon! Ref ${b.ref}.`);
    await markReminderSent(b.ref, '2h');
    summary.remind2++;
  }

  // Post-service review requests (bookings whose date has passed)
  for (const b of await bookingsDueFor('review', today, tomorrow)) {
    const service = getService(b.serviceSlug);
    const { subject, html } = reviewRequestEmail({ name: b.customerName, serviceName: service?.name ?? 'cleaning' });
    if (b.customerEmail) await sendEmail({ to: b.customerEmail, subject, html });
    await markReminderSent(b.ref, 'review');
    summary.review++;
  }

  return NextResponse.json({ ok: true, ...summary, ranAt: new Date().toISOString() });
}
