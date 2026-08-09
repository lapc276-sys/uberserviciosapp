import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { updateCalibration } from '@/lib/tenants/store';
import { ROOM_TYPES } from '@/lib/vision/types';

export const runtime = 'nodejs';

/**
 * Writes a fitted time model onto a tenant.
 *
 * This is the endpoint the calibration job will call once a tenant has enough
 * completed jobs to fit against: compare predicted vs. actual minutes, solve
 * for the factor that removes the bias, and store it. Exposed to the admin now
 * so a market can be tuned by hand before the automatic fit exists.
 */
const schema = z.object({
  calibration: z.object({
    globalTimeFactor: z.number().positive().max(5).optional(),
    roomBaseMinutes: z.record(z.enum(ROOM_TYPES), z.number().positive().max(600)).optional(),
    serviceMultiplier: z.record(z.string().max(60), z.number().positive().max(5)).optional(),
    sampleSize: z.number().int().nonnegative().optional(),
  }),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, 'settings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 422 });
  }

  await updateCalibration(id, parsed.data.calibration);
  return NextResponse.json({ ok: true });
}
