import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { updateBookingStatus, getBookingByRef } from '@/lib/data';
import { forceAssign, offerJob } from '@/lib/dispatch';

export const runtime = 'nodejs';

const schema = z.object({
  status: z.enum(['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']).optional(),
  /**
   * `re-offer` sends a fresh offer round to available pros.
   * `force-assign` overrides the marketplace and hard-assigns the best pro —
   * for when an offer round goes unclaimed and the customer needs coverage.
   */
  action: z.enum(['re-offer', 'force-assign']).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, 'bookings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ref } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 });

  if (parsed.data.status) {
    await updateBookingStatus(ref, parsed.data.status);
  }

  if (parsed.data.action) {
    const booking = await getBookingByRef(ref);
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const dispatchInput = {
      ref,
      serviceSlug: booking.serviceSlug,
      date: booking.date,
      time: booking.time,
      city: booking.city,
      address: booking.address,
    };

    if (parsed.data.action === 'force-assign') {
      const pro = await forceAssign(dispatchInput);
      return NextResponse.json({ ok: true, assignedTo: pro?.name ?? null });
    }

    const result = await offerJob(dispatchInput);
    return NextResponse.json({ ok: true, offeredTo: result.offered.map((p) => p.name) });
  }

  return NextResponse.json({ ok: true });
}
