import { NextResponse } from 'next/server';
import { z } from 'zod';
import { calculateQuote } from '@/lib/quote';
import { services } from '@/lib/config/services';

export const runtime = 'nodejs';

/**
 * The questionnaire price: bedrooms, bathrooms, house or flat.
 *
 * Runs on the server rather than in the browser even though the arithmetic is
 * trivial, because the rates are the business. Shipping `HOURLY_RATE_USD` and
 * every per-service multiplier into a public bundle hands a competitor the
 * whole pricing model, and hands a customer the ability to see the margin.
 */
const schema = z.object({
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
  bedrooms: z.number().int().min(0).max(10),
  bathrooms: z.number().int().min(0).max(10),
  /**
   * Rough floor area, when the questionnaire offers it.
   *
   * Optional because most people do not know their square footage, and forcing
   * a guess produces a worse number than leaving it out — the per-room terms
   * already carry most of the signal.
   */
  sqft: z.number().int().min(0).max(20_000).optional(),
  frequency: z.enum(['one_time', 'weekly', 'biweekly', 'monthly']).optional(),
  city: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' }, { status: 422 });
  }

  const quote = calculateQuote(parsed.data);
  if (!quote) {
    return NextResponse.json({ error: 'unknown_service' }, { status: 422 });
  }

  // Customer-facing fields only: no labour cost, no margin. Same rule as the
  // hosted tenant page — the browser asking belongs to the customer.
  return NextResponse.json({
    service: quote.service,
    currency: quote.currency,
    low: quote.low,
    high: quote.high,
    totalLow: quote.totalLow,
    totalHigh: quote.totalHigh,
    taxAmount: quote.taxAmount,
    taxNote: quote.taxNote,
    estimatedMinutes: quote.estimatedMinutes,
    recommendedPros: quote.recommendedPros,
  });
}
