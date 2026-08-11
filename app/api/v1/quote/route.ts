import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnalyzer } from '@/lib/vision/analyzer';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { validateFrames } from '@/lib/vision/input';
import { services } from '@/lib/config/services';
import { apiKeyFromRequest, checkQuota, getTenantByApiKey, recordQuote } from '@/lib/tenants/store';

/**
 * POST /api/v1/quote — the product, sold as an API.
 *
 * A cleaning company sends frames from a walkthrough video and gets back
 * minutes, a price in their currency, a supply list and their own margin.
 *
 * Server-to-server only. No CORS headers are set, deliberately: an API key in
 * browser JavaScript is a published API key, and the correct place for this
 * call is the customer's backend.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Higher than the first-party flow — API callers sample longer walkthroughs. */
const MAX_FRAMES = 20;

const schema = z.object({
  frames: z
    .array(z.string().min(32))
    .min(1, 'Add at least one frame')
    .max(MAX_FRAMES, `Up to ${MAX_FRAMES} frames`),
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
  /** Free-form caller-side identifier, echoed back so they can reconcile. */
  reference: z.string().max(120).optional(),
});

function unauthorized() {
  return NextResponse.json(
    { error: 'invalid_api_key', message: 'Send your key as `Authorization: Bearer hk_live_...`.' },
    { status: 401 },
  );
}

export async function POST(req: Request) {
  const tenant = await getTenantByApiKey(apiKeyFromRequest(req));
  if (!tenant) return unauthorized();

  const quota = await checkQuota(tenant);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: 'quota_exceeded',
        message: `You've used all ${quota.limit} quotes for ${quota.period}. Upgrade your plan to continue.`,
        usage: quota,
      },
      { status: 429 },
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
    return NextResponse.json(
      { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 422 },
    );
  }

  const { frames, serviceSlug, reference } = parsed.data;
  const frameError = validateFrames(frames);
  if (frameError) {
    return NextResponse.json({ error: 'invalid_frames', message: frameError }, { status: 422 });
  }

  const analyzer = getAnalyzer();
  const { rooms, warnings } = await analyzer.analyze({ frames, serviceSlug });

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
        message: 'No rooms could be identified in that footage. A slower walkthrough with better lighting usually fixes it.',
        warnings: analysis.warnings,
      },
      { status: 422 },
    );
  }

  const quote = priceFromAnalysis(analysis, { serviceSlug, pricing: tenant.pricing });
  const midpoint = (quote.low + quote.high) / 2;
  await recordQuote(tenant.id, midpoint);

  return NextResponse.json({
    reference,
    currency: quote.currency,
    // What the tenant may show their customer.
    quote: {
      low: quote.low,
      high: quote.high,
      tax: quote.taxAmount,
      totalLow: quote.totalLow,
      totalHigh: quote.totalHigh,
      taxNote: quote.taxNote,
      minutes: quote.minutes,
      hours: quote.hours,
      crewSize: quote.recommendedPros,
    },
    // What they should not: their own cost structure.
    internal: {
      laborCost: quote.proPayout,
      supplyCost: quote.supplyCost,
      margin: quote.platformMargin,
    },
    property: {
      condition: analysis.condition,
      confidence: analysis.confidence,
      rooms: analysis.rooms.map((r) => ({
        type: r.type,
        label: r.label,
        condition: r.condition,
        minutes: r.estimatedMinutes,
        soil: r.soil,
        objects: r.objects,
      })),
    },
    supplies: analysis.supplyPlan,
    warnings: analysis.warnings,
    engine: {
      source: analysis.source,
      calibratedOn: tenant.calibration.sampleSize,
    },
    usage: {
      used: quota.used + 1,
      limit: quota.limit,
      remaining: Math.max(0, quota.remaining - 1),
      period: quota.period,
    },
  });
}
