import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnalyzer } from '@/lib/vision/analyzer';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { validateFrames, validateCaptions, MAX_FRAMES } from '@/lib/vision/input';
import { services } from '@/lib/config/services';
import { checkQuota, getTenantBySlug, recordQuote } from '@/lib/tenants/store';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/public/quote/[slug] — the endpoint behind a tenant's hosted page.
 *
 * Unlike /api/v1/quote this takes no API key, because the caller is a
 * homeowner's browser and a key shipped to a browser is a published key. The
 * tenant is identified by the public slug in the URL instead.
 *
 * That trade has one consequence which drives everything below: anyone can
 * call this. So it is rate limited by address, and — the part that actually
 * matters — it returns nothing about the tenant's costs. The v1 response
 * carries labor cost and margin because the recipient is the tenant's own
 * server. Here the recipient is their customer, who must never be one
 * devtools panel away from learning what the job costs to fulfil.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Enough for a genuine visitor retrying; useless for burning a month's quota. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const schema = z.object({
  frames: z.array(z.string().min(32)).min(1).max(MAX_FRAMES),
  captions: z.array(z.string().max(200)).max(MAX_FRAMES).optional(),
  /**
   * What the customer asked us to pay attention to, in their own words.
   *
   * Passed to the model as context, never as instruction: it says where to
   * look carefully, not what to conclude. "La cocina está impecable" must not
   * talk the analyzer out of the grease in front of it.
   */
  focus: z.string().max(400).optional(),
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const tenant = await getTenantBySlug(slug);
  // Same answer for "no such company" and "deactivated": the slug is public,
  // and confirming which accounts exist invites enumeration for no benefit.
  if (!tenant) {
    return NextResponse.json({ error: 'not_found', message: 'This quote page is not available.' }, { status: 404 });
  }

  const limit = rateLimit(`pubquote:${slug}:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many estimates from this device. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const quota = await checkQuota(tenant);
  if (!quota.allowed) {
    // Deliberately vague: the visitor is not the account holder and should not
    // be told the business has hit a billing limit.
    return NextResponse.json(
      { error: 'unavailable', message: 'Instant estimates are temporarily unavailable. Please get in touch directly.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', message: parsed.error.issues[0]?.message }, { status: 422 });
  }

  const { frames, captions, serviceSlug } = parsed.data;
  const frameError = validateFrames(frames) ?? validateCaptions(frames, captions);
  if (frameError) {
    return NextResponse.json({ error: 'invalid_frames', message: frameError }, { status: 422 });
  }

  const analyzer = getAnalyzer();
  const { rooms, warnings } = await analyzer.analyze({ frames, captions, focus: parsed.data.focus, serviceSlug });

  const analysis = buildAnalysis(rooms, {
    serviceSlug,
    source: analyzer.name,
    warnings,
    calibration: tenant.calibration,
    supplyCostMultiplier: tenant.pricing.supplyCostMultiplier,
  });

  if (analysis.rooms.length === 0) {
    return NextResponse.json(
      {
        error: 'no_rooms_detected',
        message: 'We couldn’t make out any rooms in that video. A slower walkthrough with the lights on usually does it.',
      },
      { status: 422 },
    );
  }

  const quote = priceFromAnalysis(analysis, { serviceSlug, pricing: tenant.pricing });
  await recordQuote(tenant.id, (quote.low + quote.high) / 2);

  // Customer-facing fields only. No laborCost, no supplyCost, no margin.
  return NextResponse.json({
    currency: quote.currency,
    low: quote.low,
    high: quote.high,
    tax: quote.taxAmount,
    totalLow: quote.totalLow,
    totalHigh: quote.totalHigh,
    taxNote: quote.taxNote,
    minutes: quote.minutes,
    hours: quote.hours,
    crewSize: quote.recommendedPros,
    condition: analysis.condition,
    confidence: analysis.confidence,
    rooms: analysis.rooms.map((r) => ({
      label: r.label,
      condition: r.condition,
      minutes: r.estimatedMinutes,
    })),
    warnings: analysis.warnings,
  });
}
