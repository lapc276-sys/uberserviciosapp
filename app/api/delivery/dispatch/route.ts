import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { getOrder, listOrders } from '@/lib/delivery/store';
import { contextForOrder, courierStates, orderToJob, planForOrder, priceJob } from '@/lib/delivery/orders';
import { bestBatchPartner, type BatchCandidate } from '@/lib/delivery/batching';
import { timeline } from '@/lib/delivery/time-model';

export const runtime = 'nodejs';

const liveCourier = z.object({
  id: z.string(),
  freeInMinutes: z.coerce.number().min(0).max(240).optional(),
  activeJobs: z.coerce.number().min(0).max(10).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  freeAt: z.object({ lat: z.number(), lng: z.number() }).optional(),
});

const schema = z.object({
  ref: z.string().min(3),
  /** Live fleet state from the courier app — where they are, when they're free. */
  couriers: z.array(liveCourier).max(50).optional(),
  leg: z.enum(['pickup', 'return']).optional(),
  /** Also look for a batching partner among open orders. */
  considerBatch: z.boolean().optional(),
});

/**
 * Runs the engine for one order and returns the whole reasoning, not a verdict.
 *
 * A dispatcher (or an automated loop) gets the ranked couriers with the numbers
 * behind each rank, whether the offer should be held back until the order is
 * nearly ready, whether a second order should ride along, and what the job
 * ought to pay given the work it actually contains. Everything is inspectable,
 * because a dispatch system nobody can argue with is a dispatch system nobody
 * trusts.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, 'bookings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 });
  }

  const order = await getOrder(parsed.data.ref);
  if (!order) return NextResponse.json({ error: 'Unknown order' }, { status: 404 });

  const planned = await planForOrder(order, parsed.data.couriers ?? [], { leg: parsed.data.leg });
  if (!planned) {
    return NextResponse.json(
      { error: 'Cannot plan this order — it needs coordinates and at least one located courier' },
      { status: 409 },
    );
  }

  const { priced, plan } = planned;

  // ── Batching: is there a second order worth carrying? ─────────────────────
  let batch = null;
  if (parsed.data.considerBatch && plan.best) {
    const ctx = await contextForOrder(order);
    const open = await listOrders({ limit: 25 });
    const couriers = await courierStates(parsed.data.couriers ?? []);
    const courier = couriers.find((c) => c.id === plan.best!.courier.id) ?? couriers[0];

    const pool: BatchCandidate[] = [];
    for (const candidate of open) {
      if (candidate.ref === order.ref || candidate.status === 'DELIVERED' || candidate.status === 'CANCELED') continue;
      const candidateCtx = await contextForOrder(candidate);
      const job = orderToJob(candidate);
      if (!candidateCtx || !job) continue;
      pool.push({ job: priceJob(job, courier, candidateCtx).job, ctx: candidateCtx });
    }

    if (ctx && pool.length > 0) {
      const found = bestBatchPartner({ job: priced.job, ctx }, pool, courier);
      batch = found
        ? { partnerRef: found.partner.job.ref, decision: found.decision }
        : { partnerRef: null, decision: null };
    }
  }

  return NextResponse.json({
    ref: order.ref,
    pay: priced.pay,
    estimate: priced.estimate,
    timeline: timeline(priced.estimate, plan.best?.courier.freeInMinutes ?? 0),
    complexity: priced.appraisal.complexity,
    verdict: priced.appraisal.verdict,
    fairPay: priced.appraisal.fairPay,
    hold: plan.hold,
    payWarning: plan.payWarning,
    candidates: plan.candidates.map((c) => ({
      courierId: c.courier.id,
      name: c.courier.name,
      score: c.score,
      dollarsPerMinute: c.estimate.dollarsPerMinute,
      deliverAtMinutes: c.deliverAtMinutes,
      idleGapMinutes: c.idleGapMinutes,
      repositionMinutes: c.repositionMinutes,
      waitMinutes: c.waitMinutes,
      rationale: c.rationale,
    })),
    batch,
  });
}
