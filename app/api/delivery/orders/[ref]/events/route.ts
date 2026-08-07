import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { TIME_COMPONENTS, type ComponentMinutes } from '@/lib/delivery/types';
import { outcomeToObservations, paceFactorFor, type JobOutcome } from '@/lib/delivery/metrics';
import { contextForOrder, orderToJob, priceJob } from '@/lib/delivery/orders';
import {
  getOrder,
  listOutcomes,
  recordAccessObservation,
  recordCounterObservation,
  recordOutcome,
  recordPrepObservation,
  setCourierPace,
  toCourierState,
  updateOrder,
  listCouriers,
} from '@/lib/delivery/store';

export const runtime = 'nodejs';

const componentSchema = z.object(
  Object.fromEntries(TIME_COMPONENTS.map((c) => [c, z.coerce.number().min(0).max(240).optional()])) as Record<
    (typeof TIME_COMPONENTS)[number],
    z.ZodOptional<z.ZodNumber>
  >,
);

const schema = z.object({
  courierId: z.string().min(1),
  /** Measured minutes per component. Partial — phones can't time everything. */
  actual: componentSchema,
  actualTotalMinutes: z.coerce.number().min(0.5).max(600),
  /** Minutes between the previous delivery and productive work on this one. */
  idleGapMinutes: z.coerce.number().min(0).max(240).nullable().optional(),
  /** Courier's answer to the one question timings can't always settle. */
  usedElevator: z.boolean().nullable().optional(),
  /** Set by the merchant flow: order placed → actually ready. */
  prepMinutes: z.coerce.number().min(0).max(600).optional(),
});

/**
 * Closing the loop — the endpoint that makes the engine better.
 *
 * Everything here is a byproduct of doing the job: when the courier arrived,
 * when they got back to the vehicle, how long they stood at the counter. From
 * one POST the system writes an access observation against the building, a
 * counter observation against the merchant, a predicted-vs-actual outcome for
 * calibration, and an updated personal pace for the courier.
 *
 * Without this route, the constants in lib/delivery/* stay guesses forever.
 * With it, every delivery is a training sample nobody had to be asked for.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  // Note: the courier app authenticates through the same magic-link mechanism
  // as pros (lib/pro-auth). Until that ships, this is dispatcher-only.
  if (!session || !can(session.role, 'bookings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ref } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 });
  }

  const order = await getOrder(ref);
  if (!order) return NextResponse.json({ error: 'Unknown order' }, { status: 404 });

  const ctx = await contextForOrder(order);
  const job = orderToJob(order);
  const couriers = await listCouriers();
  const courierRecord = couriers.find((c) => c.id === parsed.data.courierId);
  if (!ctx || !job || !courierRecord) {
    return NextResponse.json({ error: 'Order or courier is not resolvable' }, { status: 409 });
  }

  // What the engine *said* would happen, recomputed against the same inputs.
  const predicted = priceJob(job, toCourierState(courierRecord), ctx).estimate;

  const outcome: JobOutcome = {
    ref: order.ref,
    courierId: courierRecord.id,
    merchantId: order.merchantId,
    buildingId: order.buildingId,
    predicted: predicted.components,
    actual: parsed.data.actual as Partial<ComponentMinutes>,
    predictedTotalMinutes: predicted.totalMinutes,
    actualTotalMinutes: parsed.data.actualTotalMinutes,
    idleGapMinutes: parsed.data.idleGapMinutes ?? null,
    completedAt: new Date().toISOString(),
  };

  const observations = outcomeToObservations(outcome, order.floor);
  await Promise.all([
    recordOutcome(outcome),
    observations.counter ? recordCounterObservation(observations.counter) : Promise.resolve(),
    observations.access
      ? recordAccessObservation({ ...observations.access, usedElevator: parsed.data.usedElevator ?? null })
      : Promise.resolve(),
    parsed.data.prepMinutes != null
      ? recordPrepObservation({
          merchantId: order.merchantId,
          weekday: new Date(order.placedAt).getDay(),
          hour: new Date(order.placedAt).getHours(),
          minutes: parsed.data.prepMinutes,
          at: new Date().toISOString(),
        })
      : Promise.resolve(),
  ]);

  // A courier's pace is a dispatch input, not a performance review: it decides
  // who gets the job with the tight window.
  const pace = paceFactorFor(courierRecord.id, await listOutcomes());
  await setCourierPace(courierRecord.id, pace);
  await updateOrder(ref, { status: 'DELIVERED', courierId: courierRecord.id });

  return NextResponse.json({
    ok: true,
    predictedMinutes: predicted.totalMinutes,
    actualMinutes: parsed.data.actualTotalMinutes,
    errorMinutes: Math.round((predicted.totalMinutes - parsed.data.actualTotalMinutes) * 10) / 10,
    paceFactor: pace,
    learned: {
      accessObservation: Boolean(observations.access),
      counterObservation: Boolean(observations.counter),
      prepObservation: parsed.data.prepMinutes != null,
    },
  });
}
