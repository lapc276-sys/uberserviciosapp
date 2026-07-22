import { NextResponse } from 'next/server';
import { z } from 'zod';
import { calculateQuote } from '@/lib/quote';

export const runtime = 'nodejs';

const schema = z.object({
  serviceSlug: z.string().min(1),
  bedrooms: z.coerce.number().min(0).max(10),
  bathrooms: z.coerce.number().min(0).max(10),
  sqft: z.coerce.number().min(0).max(20000).optional(),
  frequency: z.enum(['one_time', 'weekly', 'biweekly', 'monthly']).optional(),
});

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

  const quote = calculateQuote(parsed.data);
  if (!quote) {
    return NextResponse.json({ error: 'Unknown service' }, { status: 404 });
  }
  return NextResponse.json({ quote });
}
