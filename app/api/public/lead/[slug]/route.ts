import { NextResponse } from 'next/server';
import { z } from 'zod';
import { services } from '@/lib/config/services';
import { createTenantLead, getTenantBySlug } from '@/lib/tenants/store';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/public/lead/[slug] — the customer asks the company to get in touch.
 *
 * This is the step that makes the whole thing worth paying for. An estimate
 * nobody follows up on is a demo; a named person with a phone number and a
 * priced job attached is a booking waiting to happen.
 *
 * The quote figures are re-sent by the client rather than recomputed here.
 * They are display values on a lead card, not an agreement — the company
 * confirms the price when they call — so trusting them costs nothing, and
 * re-running the analysis would burn a second quota unit for no gain.
 */

export const runtime = 'nodejs';

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().trim().max(40).optional(),
    address: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(1000).optional(),
    serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
    quoteLow: z.number().int().nonnegative().max(10_000_000),
    quoteHigh: z.number().int().nonnegative().max(10_000_000),
    currency: z.string().length(3),
    minutes: z.number().int().nonnegative().max(100_000),
    condition: z.string().max(40).optional(),
  })
  // A company that can't reach the customer has no lead at all, so one
  // channel is required even though both are individually optional.
  .refine((d) => Boolean(d.email) || Boolean(d.phone), {
    message: 'Add an email or a phone number so they can reach you.',
    path: ['email'],
  });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const limit = rateLimit(`publead:${slug}:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Check the form' },
      { status: 422 },
    );
  }

  const d = parsed.data;
  await createTenantLead({
    tenantId: tenant.id,
    name: d.name,
    email: d.email || undefined,
    phone: d.phone,
    address: d.address,
    notes: d.notes,
    serviceSlug: d.serviceSlug,
    quoteLow: d.quoteLow,
    quoteHigh: d.quoteHigh,
    currency: d.currency,
    minutes: d.minutes,
    condition: d.condition,
  });

  return NextResponse.json({ ok: true, company: tenant.branding.displayName });
}
