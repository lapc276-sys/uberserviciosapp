import { NextResponse } from 'next/server';
import { z } from 'zod';
import { acceptJobOffer, declineJobOffer } from '@/lib/data';

export const runtime = 'nodejs';

const schema = z.object({
  proId: z.string().min(1),
  action: z.enum(['accept', 'decline']),
});

/**
 * Pro responds to a job offer. First accept wins; later ones get a clear
 * "already claimed" rather than silently losing the job.
 *
 * NOTE: pros are identified by id from their SMS link. Before launch this
 * should move behind a real pro login (magic link / OTP) — tracked for the
 * pro-auth milestone.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 422 });
  }

  if (parsed.data.action === 'decline') {
    await declineJobOffer(ref, parsed.data.proId);
    return NextResponse.json({ ok: true, status: 'declined' });
  }

  const result = await acceptJobOffer(ref, parsed.data.proId);
  if (!result.ok) {
    const message =
      result.reason === 'already_claimed'
        ? 'Another pro already accepted this job.'
        : result.reason === 'not_eligible'
          ? 'Your account is not approved for jobs yet.'
          : 'That job could not be found.';
    return NextResponse.json({ error: message, reason: result.reason }, { status: 409 });
  }

  return NextResponse.json({ ok: true, status: 'accepted' });
}
