import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import {
  addQualityCheck,
  cancelSession,
  closeForgottenSession,
  closeOpenSegment,
  endSession,
  excludeSegment,
  listSessions,
  listWorkers,
  openSession,
  overheadSummary,
  resolveWorker,
  sessionSpan,
  startRoom,
  startSession,
  SOURCES,
  type Session,
} from '@/lib/activity/store';
import { getVisionAnalysis } from '@/lib/data';
import { jobRooms, findRoom, type JobRoom } from '@/lib/workers/job';
import { durationFor, observationsFrom } from '@/lib/workers/pace';
import { ROOM_TYPES } from '@/lib/vision/types';

/**
 * The job timer, driven from a phone instead of from a chat.
 *
 * The same store already backs the Telegram logger. This exists because a
 * chat needs a free hand and a working signal in somebody else's basement,
 * and a button does not — and because the number this is all for, the gap
 * between arriving and starting the first room, only gets recorded when
 * arriving is its own deliberate action.
 *
 * Who is logging comes from the session cookie, never from the request body.
 * Time data is the asset here, and a body-supplied identity would let anyone
 * write rows against anyone's name, quietly ruining the per-person factor
 * that the whole exercise is meant to produce.
 *
 * The same goes for predictions. When a job is linked, the phone says which
 * room ("bathroom-2") and the server looks up what the engine predicted for
 * it in the stored analysis. A predicted figure the phone could send is a
 * ratio the phone could choose.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Who {
  loggedBy: string;
  proId?: string;
  email: string;
  name?: string;
}

async function whoIsLogging(): Promise<Who | null> {
  const jar = await cookies();
  const [pro, admin] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);
  if (pro?.email) return { loggedBy: pro.email, proId: pro.proId, email: pro.email, name: pro.name };
  if (admin?.email) return { loggedBy: admin.email, email: admin.email };
  return null;
}

const schema = z.object({
  action: z.enum(['start', 'room', 'pause', 'end', 'cancel', 'exclude']),
  /** Required for 'room' when no job is linked. */
  roomType: z.string().optional(),
  /** A room of the linked job, e.g. "bathroom-2". */
  roomKey: z.string().max(40).optional(),
  /** A paid extra of that room, e.g. "oven". */
  taskKey: z.string().max(40).optional(),
  /** Two people in this room at once. */
  together: z.boolean().optional(),
  /** Free text for what was being done, e.g. "el horno". */
  task: z.string().trim().max(120).optional(),
  /** A label for the job, e.g. an address. */
  label: z.string().trim().max(160).optional(),
  /** The quote this job was priced from. */
  analysisId: z.string().max(64).optional(),
  source: z.enum(SOURCES).optional(),
  crewSize: z.number().int().min(1).max(10).optional(),
  arrivalFeeling: z.enum(['good', 'normal', 'tired']).optional(),
  /** On 'end': this job was left open by mistake and is being closed late. */
  forgotten: z.boolean().optional(),
  /** On 'end': false = nothing had to be redone; or the rooms that were. */
  redo: z.boolean().optional(),
  redoRooms: z.array(z.string().max(40)).max(30).optional(),
  /** On 'exclude'. */
  segmentId: z.string().max(64).optional(),
  reason: z.string().trim().max(200).optional(),
});

interface JobView {
  analysisId: string;
  serviceSlug: string;
  region: string | null;
  rooms: JobRoom[];
}

async function loadJob(analysisId: string | undefined): Promise<JobView | null> {
  if (!analysisId) return null;
  const stored = await getVisionAnalysis(analysisId);
  if (!stored || !Array.isArray(stored.analysis?.rooms)) return null;
  return {
    analysisId: stored.id,
    serviceSlug: stored.serviceSlug,
    region: stored.city,
    rooms: jobRooms(stored.analysis, stored.serviceSlug),
  };
}

/**
 * How long this job should take this person, from everything logged so far.
 * Shown on the screen so the cleaner sees the number the app is learning —
 * never sent anywhere near a price.
 */
async function estimateFor(job: JobView, workerId: string) {
  const [sessions, workers] = await Promise.all([listSessions(500), listWorkers()]);
  const { rooms } = observationsFrom(sessions, workers);
  const tenant = workers.find((w) => w.id === workerId)?.tenantId;
  return durationFor(job.rooms, rooms, {
    workerId,
    tenant: tenant ?? undefined,
    region: job.region,
    overhead: overheadSummary(sessions.filter((s) => s.source !== 'test')),
  });
}

/** Everything the screen needs to render, in one shape. */
async function state(who: Who, preview?: string, withEstimate = false) {
  const session = await openSession(who.loggedBy);
  const job = await loadJob(session?.analysisId ?? preview);
  let estimate = null;
  if (job && withEstimate) {
    const worker = session?.workerId
      ? { id: session.workerId }
      : await resolveWorker({ proId: who.proId, email: who.email, name: who.name });
    estimate = await estimateFor(job, worker.id);
  }
  if (!session) return { session: null, openSegment: null, span: null, job, estimate, otherJob: null };

  // A link to a different job while one is still open: almost always a "Me
  // voy" forgotten yesterday. Say so instead of silently timing the old one.
  const otherJob = preview && preview !== session.analysisId ? ((await loadJob(preview)) ?? { analysisId: preview, serviceSlug: '', region: null, rooms: [] }) : null;

  return {
    session,
    openSegment: session.segments.find((s) => !s.endedAt) ?? null,
    span: sessionSpan(session),
    job,
    estimate,
    otherJob,
  };
}

export async function GET(req: Request) {
  const who = await whoIsLogging();
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const preview = new URL(req.url).searchParams.get('analysis') ?? undefined;
  return NextResponse.json(await state(who, preview, true));
}

export async function POST(req: Request) {
  const who = await whoIsLogging();
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { loggedBy } = who;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
  }
  const body = parsed.data;

  switch (body.action) {
    case 'start': {
      const job = await loadJob(body.analysisId);
      if (body.analysisId && !job) return NextResponse.json({ error: 'unknown_job' }, { status: 422 });
      const worker = await resolveWorker({ proId: who.proId, email: who.email, name: who.name });
      await startSession(loggedBy, body.label, job?.serviceSlug, {
        workerId: worker.id,
        analysisId: job?.analysisId,
        region: job?.region ?? undefined,
        source: body.source,
        crewSize: body.crewSize,
        arrivalFeeling: body.arrivalFeeling,
      });
      break;
    }

    case 'room': {
      const session = await openSession(loggedBy);
      const job = await loadJob(session?.analysisId);

      if (job && body.roomKey) {
        const room = findRoom(job.rooms, body.roomKey);
        if (!room) return NextResponse.json({ error: 'unknown_room' }, { status: 422 });
        // Any object of the room the walkthrough saw — the paid extras on the
        // buttons, and the rest by voice in hands-free mode.
        const extra = body.taskKey ? room.tasks.find((e) => e.taskKey === body.taskKey) : undefined;
        if (body.taskKey && !extra) return NextResponse.json({ error: 'unknown_task' }, { status: 422 });
        await startRoom(loggedBy, room.type, extra?.label ?? body.task, {
          roomKey: room.key,
          taskKey: extra?.taskKey,
          depth: extra?.depth,
          predictedMinutes: extra ? extra.predictedMinutes : room.predictedMinutes,
          together: body.together,
        });
        break;
      }

      if (!body.roomType || !(ROOM_TYPES as readonly string[]).includes(body.roomType)) {
        return NextResponse.json({ error: 'unknown_room' }, { status: 422 });
      }
      await startRoom(loggedBy, body.roomType, body.task, { together: body.together });
      break;
    }

    // Stopping a room without starting another. This is not a nicety: it is
    // how the minutes spent carrying equipment back to the van get counted as
    // overhead instead of being charged to whichever room was last open.
    case 'pause':
      await closeOpenSegment(loggedBy);
      break;

    case 'end': {
      const finished = body.forgotten ? await closeForgottenSession(loggedBy) : await endSession(loggedBy);
      if (finished && !body.forgotten) await recordRedo(finished, body.redo, body.redoRooms);
      return NextResponse.json({
        session: null,
        openSegment: null,
        span: null,
        job: null,
        estimate: null,
        finished: finished ? { session: finished, span: sessionSpan(finished) } : null,
      });
    }

    case 'exclude': {
      if (!body.segmentId) return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
      const ok = await excludeSegment(loggedBy, body.segmentId, body.reason ?? '');
      if (!ok) return NextResponse.json({ error: 'unknown_segment' }, { status: 404 });
      break;
    }

    case 'cancel':
      await cancelSession(loggedBy);
      break;
  }

  return NextResponse.json(await state(who));
}

/**
 * The cleaner's own answer to "¿hubo que repetir algo?". A room redone is
 * left out of their pace — fast and redone is not fast — and is kept, so the
 * rooms that get redone become visible.
 */
async function recordRedo(session: Session, redo: boolean | undefined, rooms: string[] | undefined) {
  const known = new Set(session.segments.map((s) => s.roomKey).filter(Boolean));
  const named = (rooms ?? []).filter((k) => known.has(k));
  if (named.length) {
    for (const roomKey of named) await addQualityCheck(session.id, { roomKey, result: 'redo', by: 'worker' });
    return;
  }
  if (redo === true) await addQualityCheck(session.id, { result: 'redo', by: 'worker' });
  if (redo === false) await addQualityCheck(session.id, { result: 'ok', by: 'worker' });
}
