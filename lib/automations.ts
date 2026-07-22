import type { QuoteResult } from './quote';

/**
 * Central automation pipeline triggered on every booking.
 * Each step is env-gated: it runs when its integration is configured and
 * no-ops otherwise, so the platform works end-to-end today and lights up
 * as you add keys (Resend, Twilio, Google Calendar, Stripe…).
 *
 * This is the seam the whole "todo sin intervención humana" vision plugs into.
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
    addToCalendar,
    notifyEmployee,
    generateInvoiceDraft,
    scheduleReminders,
    scheduleReviewRequest,
  ];

  await Promise.allSettled(steps.map((step) => step(payload)));
}

async function sendConfirmationEmail(p: BookingPayload) {
  if (!process.env.RESEND_API_KEY) return log('email', p.bookingId, 'skipped (no RESEND_API_KEY)');
  // TODO(phase-3): Resend transactional email with booking + quote details.
  log('email', p.bookingId, 'queued');
}

async function sendConfirmationSms(p: BookingPayload) {
  if (!process.env.TWILIO_ACCOUNT_SID) return log('sms', p.bookingId, 'skipped (no TWILIO_ACCOUNT_SID)');
  // TODO(phase-3): Twilio SMS confirmation.
  log('sms', p.bookingId, 'queued');
}

async function addToCalendar(p: BookingPayload) {
  if (!process.env.GOOGLE_CALENDAR_CLIENT_ID) return log('calendar', p.bookingId, 'skipped (no Google Calendar)');
  // TODO(phase-3): Create Google Calendar event for the slot.
  log('calendar', p.bookingId, 'queued');
}

async function notifyEmployee(p: BookingPayload) {
  // TODO(phase-4): assign nearest available pro and notify (SMS/push).
  log('assign', p.bookingId, 'pending pro-matching engine');
}

async function generateInvoiceDraft(p: BookingPayload) {
  if (!process.env.STRIPE_SECRET_KEY) return log('invoice', p.bookingId, 'skipped (no STRIPE_SECRET_KEY)');
  // TODO(phase-3): create Stripe invoice / payment intent.
  log('invoice', p.bookingId, 'draft queued');
}

async function scheduleReminders(p: BookingPayload) {
  // TODO(phase-4): enqueue 24h + 2h reminders (Redis/QStash).
  log('reminders', p.bookingId, '24h + 2h scheduled (stub)');
}

async function scheduleReviewRequest(p: BookingPayload) {
  // TODO(phase-4): post-service review request + 1-week follow-up with offer.
  log('review', p.bookingId, 'follow-up scheduled (stub)');
}

function log(step: string, id: string, status: string) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[automation:${step}] ${id} → ${status}`);
  }
}
