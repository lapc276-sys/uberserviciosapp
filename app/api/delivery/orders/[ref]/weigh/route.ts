import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { chargeAfterWeighIn } from '@/lib/delivery/payments';
import { getOrder, updateOrder } from '@/lib/delivery/store';

export const runtime = 'nodejs';

const schema = z.object({
  pounds: z.coerce.number().min(0.5).max(200),
  /** Anything beyond wash & fold: dry cleaning, comforters, stain treatment. */
  extras: z.coerce.number().min(0).max(500).optional(),
});

/**
 * The weigh-in — the moment the price finally exists.
 *
 * The laundromat puts the bags on a scale and posts the weight; the engine
 * prices it, and then either charges the card saved at intake or, if the number
 * outran what the customer was quoted, sends them a link and waits. It never
 * silently takes more money than the estimate promised.
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
    return NextResponse.json({ error: 'Weight must be between 0.5 and 200 lb' }, { status: 422 });
  }

  const order = await getOrder(ref);
  if (!order) return NextResponse.json({ error: 'Unknown order' }, { status: 404 });
  if (order.paymentState === 'PAID') {
    return NextResponse.json({ ok: true, alreadyPaid: true, amount: order.finalTotal });
  }

  const result = await chargeAfterWeighIn(order, { pounds: parsed.data.pounds, extras: parsed.data.extras });
  if (result.ok) await updateOrder(ref, { status: 'READY' });

  return NextResponse.json({
    ok: result.ok,
    state: result.state,
    amount: result.amount,
    confirmUrl: result.confirmUrl,
    reason: result.reason,
  });
}
