import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { saveTrainingSample } from '@/lib/vision/training';
import { assessQuality } from '@/lib/vision/quality';
import { services } from '@/lib/config/services';

export const runtime = 'nodejs';
export const maxDuration = 30;

const analysisSchema = z.object({
  rooms: z.array(z.any()).max(40),
  totalMinutes: z.number().min(0).max(10000),
  recommendedPros: z.number().min(0).max(20),
  suppliesNeeded: z.array(z.string()).max(40),
  condition: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  warnings: z.array(z.string()).max(20),
});

const schema = z.object({
  serviceSlug: z.string().refine((s) => services.some((x) => x.slug === s), 'Unknown service'),
  city: z.string().max(120).optional(),
  propertyType: z.string().max(40).optional(),
  consentName: z.string().min(2).max(120),
  consentTraining: z.boolean().default(false),
  frameCount: z.number().min(1).max(50),
  predicted: analysisSchema,
  corrected: analysisSchema,
  afterAnalysis: analysisSchema.optional(),
  actualMinutes: z.coerce.number().int().min(1).max(1440),
  // Operator context — optional, but the most differentiated signal we collect.
  jobSequence: z.coerce.number().int().min(1).max(20).optional(),
  hoursWorkedToday: z.coerce.number().min(0).max(24).optional(),
  crewSize: z.coerce.number().int().min(1).max(10).optional(),
  startHour: z.coerce.number().int().min(0).max(23).optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * Saves a field-captured training sample.
 *
 * Requires a signed-in pro or admin — samples must be traceable to whoever
 * captured them, both to weight the label's reliability and because an
 * anonymous submission endpoint would let anyone poison the training set.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const [proSession, adminSession] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);

  const capturedBy = proSession?.proId ?? adminSession?.email;
  if (!capturedBy) {
    return NextResponse.json({ error: 'Please sign in to capture samples.' }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid sample' },
      { status: 422 },
    );
  }

  const data = parsed.data;

  // Quality is derived server-side from the corrected before-state and the
  // after-walkthrough, so the score can't be inflated by the client.
  let quality: ReturnType<typeof assessQuality> | null = null;
  if (data.afterAnalysis) {
    quality = assessQuality(data.corrected as never, data.afterAnalysis as never);
  }

  const id = await saveTrainingSample({
    capturedBy,
    serviceSlug: data.serviceSlug,
    city: data.city,
    propertyType: data.propertyType,
    consentName: data.consentName,
    consentTraining: data.consentTraining,
    frameCount: data.frameCount,
    predicted: data.predicted as never,
    corrected: data.corrected as never,
    afterAnalysis: data.afterAnalysis as never,
    qualityScore: quality?.score,
    actualMinutes: data.actualMinutes,
    jobSequence: data.jobSequence,
    hoursWorkedToday: data.hoursWorkedToday,
    crewSize: data.crewSize,
    startHour: data.startHour,
    notes: data.notes,
  });

  return NextResponse.json({ ok: true, id, quality });
}
