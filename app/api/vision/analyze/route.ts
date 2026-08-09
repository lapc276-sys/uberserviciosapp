import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnalyzer } from '@/lib/vision/analyzer';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { services } from '@/lib/config/services';
import { saveVisionAnalysis, createLead } from '@/lib/data';
import { framesAreSafe, FRAME_ERROR } from '@/lib/vision/input';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FRAMES = 12;

const schema = z.object({
  frames: z
    .array(z.string().min(32))
    .min(1, 'Add at least one frame')
    .max(MAX_FRAMES, `Up to ${MAX_FRAMES} frames`),
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
  city: z.string().max(120).optional(),
  contact: z
    .object({
      name: z.string().max(120).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(30).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
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

  const { frames, serviceSlug, city, contact } = parsed.data;
  if (!framesAreSafe(frames)) {
    return NextResponse.json({ error: FRAME_ERROR }, { status: 422 });
  }

  const analyzer = getAnalyzer();
  const { rooms, warnings } = await analyzer.analyze({ frames, serviceSlug });

  const analysis = buildAnalysis(rooms, { serviceSlug, source: analyzer.name, warnings });
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

  return NextResponse.json({ id, analysis, quote });
}
