import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnalyzer } from '@/lib/vision/analyzer';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { sanityCheckEstimate } from '@/lib/vision/sanity';
import { services } from '@/lib/config/services';
import { saveVisionAnalysis, createLead } from '@/lib/data';
import { RATE_LIMITS, limitRequest, rateLimitResponse } from '@/lib/rate-limit';
import { getTimeModel, marketFor } from '@/lib/vision/time-model-store';
import { FLOOR_TYPES, PET_KINDS } from '@/lib/vision/tasks';
import { buildWalkthrough } from '@/lib/vision/walkthrough';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FRAMES = 12;
/** ~1.2MB per frame ceiling; the client downscales before upload. */
const MAX_FRAME_CHARS = 1_600_000;

const schema = z.object({
  frames: z
    .array(z.string().min(32))
    .min(1, 'Add at least one frame')
    .max(MAX_FRAMES, `Up to ${MAX_FRAMES} frames`),
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
  city: z.string().max(120).optional(),
  /** Answers from the guided walkthrough. Every one of these moves the price. */
  preferences: z
    .object({
      requested: z.array(z.string().max(60)).max(60).optional(),
      declined: z.array(z.string().max(60)).max(60).optional(),
    })
    .optional(),
  property: z
    .object({
      floorTypes: z.array(z.enum(FLOOR_TYPES)).max(7).optional(),
      pets: z.array(z.enum(PET_KINDS)).max(3).optional(),
    })
    .optional(),
  contact: z
    .object({
      name: z.string().max(120).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(30).optional(),
    })
    .optional(),
});

function framesAreSafe(frames: string[]): boolean {
  return frames.every(
    (f) =>
      f.length <= MAX_FRAME_CHARS &&
      (f.startsWith('data:image/jpeg;base64,') ||
        f.startsWith('data:image/png;base64,') ||
        f.startsWith('data:image/webp;base64,') ||
        f.startsWith('https://')),
  );
}

export async function POST(req: Request) {
  // Checked before parsing: this endpoint is unauthenticated and every call
  // that reaches the analyzer spends money, so the cheapest possible rejection
  // has to come first.
  const limit = limitRequest(req, 'vision', RATE_LIMITS.vision);
  if (!limit.ok) {
    return rateLimitResponse(
      limit,
      'You’ve reached the limit for video quotes. Try again later, or book with our quick questionnaire.',
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 422 },
    );
  }

  const { frames, serviceSlug, city, contact, preferences, property } = parsed.data;
  if (!framesAreSafe(frames)) {
    return NextResponse.json({ error: 'Frames must be JPEG, PNG or WebP images.' }, { status: 422 });
  }

  const analyzer = getAnalyzer();
  const { rooms, warnings } = await analyzer.analyze({ frames, serviceSlug });

  // Prices come from this market's calibrated model when one is active, and
  // from the built-in hypothesis otherwise.
  const model = await getTimeModel(marketFor(city));
  const analysis = buildAnalysis(rooms, {
    serviceSlug,
    source: analyzer.name,
    warnings,
    model,
    preferences,
    property,
  });
  if (analysis.rooms.length === 0) {
    return NextResponse.json(
      {
        error:
          'We couldn’t identify any rooms in that footage. Try a slower walkthrough with better lighting, or book with our quick questionnaire.',
        warnings: analysis.warnings,
      },
      { status: 422 },
    );
  }

  const quote = priceFromAnalysis(analysis, { serviceSlug, city });

  // Second opinion from the questionnaire engine. It cannot see soil, so it is
  // never exactly right — but a threefold disagreement means one of them is
  // broken, and a broken vision read produces a confident number rather than an
  // error. Warn instead of quoting it silently.
  const sanity = sanityCheckEstimate(analysis, { serviceSlug, city, low: quote.low, high: quote.high });
  if (sanity.warningEs) analysis.warnings.push(sanity.warningEs);

  const id = await saveVisionAnalysis({
    serviceSlug,
    city,
    frameCount: frames.length,
    analysis,
    quote,
    contactEmail: contact?.email,
  });

  // A video walkthrough is high purchase intent — capture it even if they
  // abandon before booking.
  if (contact?.email || contact?.phone) {
    await createLead({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      source: 'vision_quote',
      message: `Video quote · ${analysis.rooms.length} rooms · ${analysis.totalMinutes} min · $${quote.low}-$${quote.high}`,
    });
  }

  // The script for the rest of the conversation: what to ask, what to film
  // again, and what we saw. Property questions are dropped once answered so the
  // app never asks about the dog twice.
  const walkthrough = buildWalkthrough(analysis, serviceSlug, {
    askProperty: !property?.floorTypes?.length && !property?.pets?.length,
  });

  return NextResponse.json({ id, analysis, quote, walkthrough });
}
