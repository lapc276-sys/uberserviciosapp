import type { QuoteResult } from './quote';
import { getService } from './config/services';
import { sendEmail, bookingConfirmationEmail } from './email';
import { sendSms } from './sms';
import { createInvoiceForBooking } from './stripe';
import { createInvoice } from './data';
import { site } from './config/site';

/**
 * Central automation pipeline triggered on every booking (Phase 3).
 * Each step is env-gated: it runs when its integration is configured and
 * no-ops (dry-run) otherwise, so the platform works end-to-end today and
 * lights up as you add keys (Resend, Twilio, Stripe, Google Calendar…).
 *
 * Time-based automations (24h/2h reminders, post-service review requests)
 * are driven by the cron endpoint at /api/cron/reminders.
 */
export interface BookingPayload {
  bookingId: string;
  serviceSlug: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  date: string;
  time: string;
  frequency: string;
  notes?: string;
  quote: QuoteResult | null;
}

export async function runBookingAutomations(payload: BookingPayload): Promise<void> {
  const steps = [
    sendConfirmationEmail,
    sendConfirmationSms,
    createBookingInvoice,
    addToCalendar,
    notifyEmployee,
  ];
  await Promise.allSettled(steps.map((step) => step(payload)));
}

async function sendConfirmationEmail(p: BookingPayload) {
  const service = getService(p.serviceSlug);
  const { subject, html } = bookingConfirmationEmail({
    name: p.name,
    ref: p.bookingId,
    serviceName: service?.name ?? 'Cleaning',
    date: p.date,
    time: p.time,
    quoteLow: p.quote?.low,
    quoteHigh: p.quote?.high,
  });
  await sendEmail({ to: p.email, subject, html });
}

async function sendConfirmationSms(p: BookingPayload) {
  const service = getService(p.serviceSlug);
  const body = `${site.name}: You're booked! ${service?.shortName ?? 'Cleaning'} on ${p.date} at ${p.time}. Ref ${p.bookingId}. We'll remind you before. Reply or call ${site.phone}.`;
  await sendSms(p.phone, body);
}

async function createBookingInvoice(p: BookingPayload) {
  const service = getService(p.serviceSlug);
  const amount = p.quote ? Math.round((p.quote.low + p.quote.high) / 2) : service?.pricing.base ?? 0;
  try {
    const stripeInvoice = await createInvoiceForBooking({
      ref: p.bookingId,
      email: p.email,
      name: p.name,
      serviceName: service?.name ?? 'Cleaning',
      amount,
    });
    // Persist the invoice record (with Stripe id when Stripe is configured).
    await createInvoice({
      ref: p.bookingId,
      amount: stripeInvoice?.amount ?? amount * 100,
      stripeId: stripeInvoice?.invoiceId,
      status: stripeInvoice ? 'SENT' : 'DRAFT',
    });
  } catch (err) {
    console.error('[automation:invoice] error', err);
  }
}

async function addToCalendar(p: BookingPayload) {
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) return log('calendar', p.bookingId, 'skipped (no Google Calendar)');
  // TODO(phase-4): create Google Calendar event for the slot.
  log('calendar', p.bookingId, 'queued');
}

async function notifyEmployee(p: BookingPayload) {
  const { assignAndNotify } = await import('./dispatch');
  const pro = await assignAndNotify({
    ref: p.bookingId,
    serviceSlug: p.serviceSlug,
    date: p.date,
    time: p.time,
    city: p.city,
    address: p.address,
  });
  log('assign', p.bookingId, pro ? `assigned to ${pro.name}` : 'no available pro');
}

function log(step: string, id: string, status: string) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[automation:${step}] ${id} → ${status}`);
  }
}
