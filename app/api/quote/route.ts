import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listPrice, chargesSalesTax } from '@/lib/pricing/klaudy';
import { services } from '@/lib/config/services';
import { getCityByName } from '@/lib/config/cities';

export const runtime = 'nodejs';

/**
 * The questionnaire price: bedrooms, bathrooms, type of clean.
 *
 * Answers with the owner's own list price — a single number, not a range. The
 * camera path quotes a range because what it measures is genuinely uncertain;
 * this path is reading a price somebody already committed to, and wrapping
 * that in "$99–$127" would invent doubt where none exists and quote under his
 * own number besides.
 *
 * Runs on the server even though the arithmetic is trivial, because the ladder
 * is the business. A public bundle containing it hands a competitor the entire
 * pricing model.
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

  const { bedrooms, bathrooms, serviceSlug, city } = parsed.data;
  const { price, quoted } = listPrice({ bedrooms, bathrooms, serviceSlug });

  const service = services.find((s) => s.slug === serviceSlug)!;

  // Tax is added only when the business actually collects it. Quoting a number
  // the owner does not charge loses the job on price.
  const taxRate = chargesSalesTax() ? (city ? (getCityByName(city)?.salesTax.rate ?? 0) : 0) : 0;
  const taxAmount = Math.round(price * taxRate);

  return NextResponse.json({
    service: service.name,
    currency: 'USD',
    price: price + taxAmount,
    taxAmount: taxAmount || undefined,
    /**
     * False once the property is larger than anything the owner has priced
     * directly. The page turns the number into a starting point rather than a
     * quote, which is the honest thing to show and also the thing that gets
     * the customer to make contact.
     */
     quoted,
  });
}
