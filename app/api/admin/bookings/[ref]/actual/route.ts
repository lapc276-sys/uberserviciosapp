import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { recordActualMinutes } from '@/lib/data';

export const runtime = 'nodejs';

const schema = z.object({
  minutes: z.coerce.number().int().min(1).max(1440),
});

/**
 * Records how long a job actually took. This is the ground truth that makes
 * the AI time model improvable — see /admin/vision.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, 'bookings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ref } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Minutes must be between 1 and 1440' }, { status: 422 });
  }

  await recordActualMinutes(ref, parsed.data.minutes);
  return NextResponse.json({ ok: true });
}
