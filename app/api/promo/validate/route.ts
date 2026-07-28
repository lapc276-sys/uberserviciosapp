import { NextResponse } from 'next/server';
import { z } from 'zod';
import { evaluatePromo } from '@/lib/marketing/promos';
import { calculateQuote } from '@/lib/quote';
import { getCityByName } from '@/lib/config/cities';

export const runtime = 'nodejs';

const schema = z.object({
  code: z.string().min(1).max(40),
  serviceSlug: z.string().min(1),
  bedrooms: z.coerce.number().min(0).max(10),
  bathrooms: z.coerce.number().min(0).max(10),
  sqft: z.coerce.number().min(0).max(20000).optional(),
  frequency: z.enum(['one_time', 'weekly', 'biweekly', 'monthly']).optional(),
  city: z.string().max(120).optional(),
});

/**
 * Previews a promo code so the customer sees the discount before committing.
 * The booking endpoint re-validates independently — this is for UX, not trust.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Enter a code to apply.' }, { status: 422 });
  }

  const { code, city, ...quoteInput } = parsed.data;
  const quote = calculateQuote({ ...quoteInput, city });
  if (!quote) return NextResponse.json({ ok: false, message: 'Unknown service.' }, { status: 404 });

  const evaluation = evaluatePromo(code, {
    subtotal: Math.round((quote.low + quote.high) / 2),
    serviceSlug: parsed.data.serviceSlug,
    citySlug: city ? getCityByName(city)?.slug : undefined,
  });

  return NextResponse.json({
    ok: evaluation.ok,
    message: evaluation.message ?? 'That code isn’t valid.',
    discount: evaluation.discount,
  });
}
