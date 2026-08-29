import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnalyzer } from '@/lib/vision/analyzer';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { services } from '@/lib/config/services';
import { saveVisionAnalysis, createLead } from '@/lib/data';
import { framesAreSafe, validateCaptions, FRAME_ERROR, MAX_FRAMES } from '@/lib/vision/input';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  frames: z
    .array(z.string().min(32))
    .min(1, 'Add at least one frame')
    .max(MAX_FRAMES, `Up to ${MAX_FRAMES} frames`),
  captions: z.array(z.string().max(200)).max(MAX_FRAMES).optional(),
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

  const { frames, captions, serviceSlug, city, contact } = parsed.data;
  if (!framesAreSafe(frames)) {
    return NextResponse.json({ error: FRAME_ERROR }, { status: 422 });
  }

  const captionError = validateCaptions(frames, captions);
  if (captionError) {
    return NextResponse.json({ error: captionError }, { status: 422 });
  }

  /**
   * One line per analysis, in the deployment log.
   *
   * When a request dies between the browser and here — a proxy body limit, a
   * request timeout, a container running out of memory — the browser is handed
   * an empty response that names none of those. The only way to tell them
   * apart afterwards is whether this route was reached at all, and how long it
   * had been running when it stopped. Both lines below answer that.
   */
  const started = Date.now();
  const payloadMb = frames.reduce((sum, f) => sum + f.length, 0) / 1_000_000;
  const analyzer = getAnalyzer();
  console.log(
    `[vision] start frames=${frames.length} captioned=${captions?.length ?? 0} payload=${payloadMb.toFixed(2)}MB engine=${analyzer.name}`,
  );

  const { rooms, warnings } = await analyzer.analyze({ frames, captions, serviceSlug });
  console.log(`[vision] done in ${Date.now() - started}ms rooms=${rooms.length}`);

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
