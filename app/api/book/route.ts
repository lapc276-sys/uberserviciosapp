import { NextResponse } from 'next/server';
import { z } from 'zod';
import { calculateQuote } from '@/lib/quote';
import { getService } from '@/lib/config/services';

export const runtime = 'nodejs';

const schema = z.object({
  serviceSlug: z.string().min(1),
  bedrooms: z.coerce.number().min(0).max(10),
  bathrooms: z.coerce.number().min(0).max(10),
  sqft: z.coerce.number().min(0).max(20000).optional(),
  frequency: z.enum(['one_time', 'weekly', 'biweekly', 'monthly']).default('one_time'),
  date: z.string().min(1),
  time: z.string().min(1),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(30),
  address: z.string().min(4).max(240),
  city: z.string().min(2).max(120),
  notes: z.string().max(1000).optional(),
});

/**
 * Booking intake. Validates, prices, and returns a confirmation.
 * In production this persists to the DB and fires the automation pipeline
 * (email + SMS + calendar + pro dispatch + invoice). Those side
 * effects are stubbed behind env-gated integrations — see lib/automations.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 });
  }

  const data = parsed.data;
  const service = getService(data.serviceSlug);
  if (!service) {
    return NextResponse.json({ error: 'Unknown service' }, { status: 404 });
  }

  const quote = calculateQuote(data);
  const bookingId = `HMG-${Date.now().toString(36).toUpperCase()}`;

  // Persist the booking (Prisma when DATABASE_URL is set, else in-memory).
  const { createBooking, createLead } = await import('@/lib/data');
  try {
    await createBooking({
      ref: bookingId,
      serviceSlug: data.serviceSlug,
      serviceName: service.name,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      sqft: data.sqft,
      frequency: data.frequency,
      date: data.date,
      time: data.time,
      quoteLow: quote?.low ?? null,
      quoteHigh: quote?.high ?? null,
      notes: data.notes,
      name: data.name,
      email: data.email,
      phone: data.phone,
      address: data.address,
      city: data.city,
    });
    await createLead({ name: data.name, email: data.email, phone: data.phone, source: 'booking' });
  } catch (err) {
    console.error('[book] persistence error', err);
    return NextResponse.json({ error: 'Could not save booking. Please try again.' }, { status: 500 });
  }

  // Automation pipeline (no-op unless integration keys are configured).
  const { runBookingAutomations } = await import('@/lib/automations');
  await runBookingAutomations({ bookingId, ...data, quote });

  return NextResponse.json({
    ok: true,
    bookingId,
    service: service.name,
    quote,
    message: `Booking confirmed. A confirmation was sent to ${data.email}.`,
  });
}
