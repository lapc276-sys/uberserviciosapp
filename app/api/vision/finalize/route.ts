import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { sanityCheckEstimate } from '@/lib/vision/sanity';
import { services } from '@/lib/config/services';
import { saveVisionAnalysis, createLead } from '@/lib/data';
import { RATE_LIMITS, limitRequest, rateLimitResponse } from '@/lib/rate-limit';
import { getTimeModel, marketFor } from '@/lib/vision/time-model-store';
import { FLOOR_TYPES, PET_KINDS } from '@/lib/vision/tasks';
import { ROOM_TYPES, SOIL_DIMENSIONS } from '@/lib/vision/types';

export const runtime = 'nodejs';

/**
 * Prices a walkthrough that has already been analysed room by room.
 *
 * The guided walk sends each room to the model as it is filmed, so the customer
 * gets feedback while still standing in the room. By the end every observation
 * is already paid for — re-analysing the whole home to produce one number would
 * double the model spend to learn nothing new.
 *
 * So this endpoint takes the observations back and only does the arithmetic:
 * time model, task plan, supplies, price. No model call, which is also why it
 * shares the cheap `quote` budget rather than the expensive `vision` one.
 */
const observationSchema = z.object({
  type: z.enum(ROOM_TYPES),
  confidence: z.number().min(0).max(1),
  soil: z.record(z.enum(SOIL_DIMENSIONS), z.number().min(0).max(100)),
  objects: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        count: z.number().min(1).max(20),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(25),
  notes: z.string().max(400).optional(),
});

const schema = z.object({
  rooms: z.array(observationSchema).min(1).max(40),
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
  city: z.string().max(120).optional(),
  frameCount: z.number().int().min(0).max(400).optional(),
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

export async function POST(req: Request) {
  const limit = limitRequest(req, 'finalize', RATE_LIMITS.quote);
  if (!limit.ok) return rateLimitResponse(limit);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 422 });
  }

  const { rooms, serviceSlug, city, frameCount, preferences, property, contact } = parsed.data;

  const model = await getTimeModel(marketFor(city));
  const analysis = buildAnalysis(rooms as never, {
    serviceSlug,
    // Every observation here came from the model during the walk; saying
    // otherwise in the audit trail would misreport where the numbers came from.
    source: 'vision-llm',
    model,
    preferences,
    property,
  });

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
    frameCount: frameCount ?? 0,
    analysis,
    quote,
    contactEmail: contact?.email,
  });

  if (contact?.email || contact?.phone) {
    await createLead({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      source: 'vision_walkthrough',
      message: `Guided walkthrough · ${analysis.rooms.length} rooms · ${analysis.totalMinutes} min · $${quote.low}-$${quote.high}`,
    });
  }

  return NextResponse.json({ id, analysis, quote });
}
