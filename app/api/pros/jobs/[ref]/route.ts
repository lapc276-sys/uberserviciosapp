import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { acceptJobOffer, declineJobOffer, getBookingByRef, getProById } from '@/lib/data';
import { sendSms } from '@/lib/sms';
import { site } from '@/lib/config/site';

export const runtime = 'nodejs';

const schema = z.object({ action: z.enum(['accept', 'decline']) });

/**
 * Pro responds to a job offer. Identity comes from the session cookie, never
 * from the request body — the SMS link identifies the job, not the person.
 * First accept wins; later ones get an explicit 409.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const jar = await cookies();
  const session = await verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Please sign in to respond.' }, { status: 401 });

  const { ref } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 });

  if (parsed.data.action === 'decline') {
    await declineJobOffer(ref, session.proId);
    return NextResponse.json({ ok: true, status: 'declined' });
  }

  const result = await acceptJobOffer(ref, session.proId);
  if (!result.ok) {
    const message =
      result.reason === 'already_claimed'
        ? 'Another pro already accepted this job.'
        : result.reason === 'not_eligible'
          ? 'Your account is not approved for jobs yet.'
          : result.reason === 'not_offered'
            ? 'This job wasn’t offered to you.'
            : 'That job could not be found.';
    // 403 when the pro has no claim to the job; 409 when it was simply taken.
    const status = result.reason === 'not_offered' || result.reason === 'not_eligible' ? 403 : 409;
    return NextResponse.json({ error: message, reason: result.reason }, { status });
  }

  // Only now does the pro get the address and customer contact.
  const [booking, pro] = await Promise.all([getBookingByRef(ref), getProById(session.proId)]);
  if (booking && pro?.phone) {
    await sendSms(
      pro.phone,
      `${site.name}: Job confirmed — ${booking.serviceName} on ${booking.date} at ${booking.time}. ${booking.address}, ${booking.city}. Customer: ${booking.customerName} ${booking.customerPhone}. Ref ${ref}.`,
    );
  }

  return NextResponse.json({ ok: true, status: 'accepted' });
}
