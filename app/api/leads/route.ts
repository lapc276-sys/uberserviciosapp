import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createLead } from '@/lib/data';
import { rateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * The contact form on the landing page.
 *
 * Deliberately forgiving about what a person types: the field asks for "phone
 * or email" because somebody on a phone gives whichever is nearer to hand, and
 * refusing an email in a field labelled phone loses the lead over a technical
 * distinction the customer never agreed to. Whatever arrives is sorted here.
 */
const schema = z.object({
  name: z.string().min(1).max(120),
  /** Phone or email — the form does not force a choice. */
  phone: z.string().min(3).max(160),
  message: z.string().max(2000).optional(),
  source: z.string().max(60).optional(),
});

/** Enough for someone retrying a failed send; useless for flooding the inbox. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const limit = rateLimit(`lead:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
  }

  const { name, phone, message, source } = parsed.data;
  const looksLikeEmail = phone.includes('@');

  await createLead({
    name,
    email: looksLikeEmail ? phone : undefined,
    phone: looksLikeEmail ? undefined : phone,
    source: source ?? 'web',
    message,
  });

  return NextResponse.json({ ok: true });
}
