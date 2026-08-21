import { prisma, isDbConfigured } from '../db';
import type { RoomType } from '../vision/types';

/**
 * Live time logging, persisted the same two ways as everything else: Postgres
 * when configured, memory otherwise, so this works on day one with no
 * infrastructure.
 *
 * One rule shapes the whole module: a session has at most one open segment.
 * Starting a room closes whatever was running, because in the field people
 * walk from the kitchen into the bathroom and say "bathroom" — they do not
 * stop to close the previous one, and a logger that required them to would be
 * abandoned by the third job.
 */

export interface Segment {
  id: string;
  roomType: RoomType | string;
  task?: string;
  startedAt: string;
  endedAt?: string;
  minutes?: number;
}

export interface Session {
  id: string;
  loggedBy: string;
  label?: string;
  serviceSlug?: string;
  startedAt: string;
  endedAt?: string;
  totalMinutes?: number;
  segments: Segment[];
}

const memory: Session[] = [];

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(row: any): Session {
  return {
    id: row.id,
    loggedBy: row.loggedBy,
    label: row.label ?? undefined,
    serviceSlug: row.serviceSlug ?? undefined,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString(),
    totalMinutes: row.totalMinutes ?? undefined,
    segments: (row.segments ?? []).map((s: any) => ({
      id: s.id,
      roomType: s.roomType,
      task: s.task ?? undefined,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString(),
      minutes: s.minutes ?? undefined,
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The session still running for this person, if any. */
export async function openSession(loggedBy: string): Promise<Session | null> {
  if (!isDbConfigured || !prisma) {
    return memory.find((s) => s.loggedBy === loggedBy && !s.endedAt) ?? null;
  }
  const row = await prisma.activitySession.findFirst({
    where: { loggedBy, endedAt: null },
    orderBy: { startedAt: 'desc' },
    include: { segments: { orderBy: { startedAt: 'asc' } } },
  });
  return row ? fromRow(row) : null;
}

export async function startSession(loggedBy: string, label?: string, serviceSlug?: string): Promise<Session> {
  // Only one job at a time. An abandoned session left open would silently
  // swallow the next job's segments.
  const existing = await openSession(loggedBy);
  if (existing) await endSession(loggedBy);

  if (!isDbConfigured || !prisma) {
    const session: Session = {
      id: id('as'),
      loggedBy,
      label,
      serviceSlug,
      startedAt: new Date().toISOString(),
      segments: [],
    };
    memory.unshift(session);
    return session;
  }

  const row = await prisma.activitySession.create({
    data: { loggedBy, label, serviceSlug },
    include: { segments: true },
  });
  return fromRow(row);
}

export interface StartRoomResult {
  session: Session;
  /** The segment that was auto-closed, so the reply can confirm it. */
  closed?: Segment;
}

export async function startRoom(
  loggedBy: string,
  roomType: string,
  task?: string,
): Promise<StartRoomResult> {
  const session = (await openSession(loggedBy)) ?? (await startSession(loggedBy));
  const closed = await closeOpenSegment(loggedBy);
  const now = new Date();

  if (!isDbConfigured || !prisma) {
    const target = memory.find((s) => s.id === session.id)!;
    target.segments.push({ id: id('sg'), roomType, task, startedAt: now.toISOString() });
    return { session: target, closed };
  }

  await prisma.activitySegment.create({
    data: { sessionId: session.id, roomType, task, startedAt: now },
  });
  return { session: (await openSession(loggedBy))!, closed };
}

/** Closes the running segment and returns it, or null if none was open. */
export async function closeOpenSegment(loggedBy: string): Promise<Segment | undefined> {
  const session = await openSession(loggedBy);
  if (!session) return undefined;
  const open = session.segments.find((s) => !s.endedAt);
  if (!open) return undefined;

  const endedAt = new Date().toISOString();
  const minutes = minutesBetween(open.startedAt, endedAt);

  if (!isDbConfigured || !prisma) {
    const target = memory.find((s) => s.id === session.id)!;
    const seg = target.segments.find((s) => s.id === open.id)!;
    seg.endedAt = endedAt;
    seg.minutes = minutes;
    return seg;
  }

  await prisma.activitySegment.update({
    where: { id: open.id },
    data: { endedAt: new Date(endedAt), minutes },
  });
  return { ...open, endedAt, minutes };
}

export async function endSession(loggedBy: string): Promise<Session | null> {
  await closeOpenSegment(loggedBy);
  const session = await openSession(loggedBy);
  if (!session) return null;

  const total = session.segments.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  const endedAt = new Date().toISOString();

  if (!isDbConfigured || !prisma) {
    const target = memory.find((s) => s.id === session.id)!;
    target.endedAt = endedAt;
    target.totalMinutes = total;
    return target;
  }

  const row = await prisma.activitySession.update({
    where: { id: session.id },
    data: { endedAt: new Date(endedAt), totalMinutes: total },
    include: { segments: { orderBy: { startedAt: 'asc' } } },
  });
  return fromRow(row);
}

/** Throws away an open session — for a false start, not for a real job. */
export async function cancelSession(loggedBy: string): Promise<boolean> {
  const session = await openSession(loggedBy);
  if (!session) return false;

  if (!isDbConfigured || !prisma) {
    const i = memory.findIndex((s) => s.id === session.id);
    if (i >= 0) memory.splice(i, 1);
    return true;
  }
  await prisma.activitySession.delete({ where: { id: session.id } });
  return true;
}

export async function listSessions(limit = 100): Promise<Session[]> {
  if (!isDbConfigured || !prisma) return memory.slice(0, limit);
  const rows = await prisma.activitySession.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { segments: { orderBy: { startedAt: 'asc' } } },
  });
  return rows.map(fromRow);
}

export interface RoomTiming {
  roomType: string;
  /** Closed segments only — an unfinished room has no duration yet. */
  samples: number;
  medianMinutes: number;
  meanMinutes: number;
  minMinutes: number;
  maxMinutes: number;
}

/**
 * Real minutes per room type, which is what the shipped ROOM_BASE_MINUTES
 * constants are currently guessing at.
 *
 * Median rather than mean is the headline, because one job where someone left
 * the timer running through lunch would drag an average badly and there will
 * not be enough samples for that to wash out for a long time.
 */
export function roomTimings(sessions: Session[]): RoomTiming[] {
  const byRoom = new Map<string, number[]>();

  for (const session of sessions) {
    for (const seg of session.segments) {
      if (typeof seg.minutes !== 'number' || seg.minutes <= 0) continue;
      const list = byRoom.get(seg.roomType) ?? [];
      list.push(seg.minutes);
      byRoom.set(seg.roomType, list);
    }
  }

  return [...byRoom.entries()]
    .map(([roomType, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
      return {
        roomType,
        samples: sorted.length,
        medianMinutes: median,
        meanMinutes: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        minMinutes: sorted[0],
        maxMinutes: sorted[sorted.length - 1],
      };
    })
    .sort((a, b) => b.samples - a.samples);
}
