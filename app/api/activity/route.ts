import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import {
  cancelSession,
  closeOpenSegment,
  endSession,
  openSession,
  sessionSpan,
  startRoom,
  startSession,
} from '@/lib/activity/store';
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
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function whoIsLogging(): Promise<string | null> {
  const jar = await cookies();
  const [pro, admin] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);
  return pro?.email || admin?.email || null;
}

const schema = z.object({
  action: z.enum(['start', 'room', 'pause', 'end', 'cancel']),
  /** Required for 'room'. */
  roomType: z.string().optional(),
  /** Free text for what was being done, e.g. "el horno". */
  task: z.string().trim().max(120).optional(),
  /** A label for the job, e.g. an address. */
  label: z.string().trim().max(160).optional(),
});

/** Everything the screen needs to render, in one shape. */
async function state(loggedBy: string) {
  const session = await openSession(loggedBy);
  if (!session) return { session: null, openSegment: null, span: null };

  return {
    session,
    openSegment: session.segments.find((s) => !s.endedAt) ?? null,
    span: sessionSpan(session),
  };
}

export async function GET() {
  const loggedBy = await whoIsLogging();
  if (!loggedBy) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await state(loggedBy));
}

export async function POST(req: Request) {
  const loggedBy = await whoIsLogging();
  if (!loggedBy) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
  }
  const { action, roomType, task, label } = parsed.data;

  switch (action) {
    case 'start':
      await startSession(loggedBy, label);
      break;

    case 'room': {
      if (!roomType || !(ROOM_TYPES as readonly string[]).includes(roomType)) {
        return NextResponse.json({ error: 'unknown_room' }, { status: 422 });
      }
      await startRoom(loggedBy, roomType, task);
      break;
    }

    // Stopping a room without starting another. This is not a nicety: it is
    // how the minutes spent carrying equipment back to the van get counted as
    // overhead instead of being charged to whichever room was last open.
    case 'pause':
      await closeOpenSegment(loggedBy);
      break;

    case 'end': {
      const finished = await endSession(loggedBy);
      return NextResponse.json({
        session: null,
        openSegment: null,
        span: null,
        finished: finished ? { session: finished, span: sessionSpan(finished) } : null,
      });
    }

    case 'cancel':
      await cancelSession(loggedBy);
      break;
  }

  return NextResponse.json(await state(loggedBy));
}
