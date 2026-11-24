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

/**
 * field: a real job. practice: a measuring day, real minutes but no customer.
 * test: automated tests and demos — never part of any calculation
 * (`countsAsData` in lib/workers/pace.ts is the one filter).
 */
export const SOURCES = ['field', 'practice', 'test'] as const;
export type Source = (typeof SOURCES)[number];

export interface Segment {
  id: string;
  roomType: RoomType | string;
  task?: string;
  /** Which room of the walkthrough, e.g. "bathroom-2". */
  roomKey?: string;
  /** A paid extra timed apart: catalogue object + depth. */
  taskKey?: string;
  depth?: string;
  /** The engine's minutes for this room or extra, frozen at the start. */
  predictedMinutes?: number;
  together?: boolean;
  excluded?: boolean;
  excludedReason?: string;
  startedAt: string;
  endedAt?: string;
  minutes?: number;
}

export type QualityResult = 'ok' | 'redo';
export type QualitySource = 'customer' | 'photos' | 'worker' | 'supervisor';

export interface QualityRecord {
  id: string;
  /** Null = the whole job. */
  roomKey?: string;
  result: QualityResult;
  by: QualitySource;
  score?: number;
  note?: string;
  createdAt: string;
}

export interface Session {
  id: string;
  loggedBy: string;
  label?: string;
  serviceSlug?: string;
  workerId?: string;
  /** The quote this job was priced from — the predicted half of every ratio. */
  analysisId?: string;
  source: Source;
  region?: string;
  crewSize: number;
  arrivalFeeling?: string;
  /** Closed after the fact: rooms count, door-to-door does not. */
  closedLate?: boolean;
  startedAt: string;
  endedAt?: string;
  totalMinutes?: number;
  segments: Segment[];
  quality: QualityRecord[];
}

/** The person, once, whichever door they log from. See prisma `Worker`. */
export interface WorkerRecord {
  id: string;
  tenantId?: string;
  proId?: string;
  email?: string;
  telegramChatId?: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/** Everything a new session can know about its job up front. */
export interface SessionContext {
  workerId?: string;
  analysisId?: string;
  serviceSlug?: string;
  source?: Source;
  region?: string;
  crewSize?: number;
  arrivalFeeling?: string;
}

/** What a room segment can know about the room. */
export interface SegmentDetail {
  roomKey?: string;
  taskKey?: string;
  depth?: string;
  predictedMinutes?: number;
  together?: boolean;
}

const memory: Session[] = [];
const memoryWorkers: WorkerRecord[] = [];

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
    workerId: row.workerId ?? undefined,
    analysisId: row.analysisId ?? undefined,
    source: (SOURCES as readonly string[]).includes(row.source) ? row.source : 'field',
    region: row.region ?? undefined,
    crewSize: row.crewSize ?? 1,
    arrivalFeeling: row.arrivalFeeling ?? undefined,
    closedLate: row.closedLate || undefined,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString(),
    totalMinutes: row.totalMinutes ?? undefined,
    segments: (row.segments ?? []).map((s: any) => ({
      id: s.id,
      roomType: s.roomType,
      task: s.task ?? undefined,
      roomKey: s.roomKey ?? undefined,
      taskKey: s.taskKey ?? undefined,
      depth: s.depth ?? undefined,
      predictedMinutes: s.predictedMinutes ?? undefined,
      together: s.together || undefined,
      excluded: s.excluded || undefined,
      excludedReason: s.excludedReason ?? undefined,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString(),
      minutes: s.minutes ?? undefined,
    })),
    quality: (row.qualityChecks ?? []).map((q: any) => ({
      id: q.id,
      roomKey: q.roomKey ?? undefined,
      result: q.result === 'redo' ? 'redo' : 'ok',
      by: q.by,
      score: q.score ?? undefined,
      note: q.note ?? undefined,
      createdAt: q.createdAt.toISOString(),
    })),
  };
}

function workerFromRow(row: any): WorkerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId ?? undefined,
    proId: row.proId ?? undefined,
    email: row.email ?? undefined,
    telegramChatId: row.telegramChatId ?? undefined,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const INCLUDE = {
  segments: { orderBy: { startedAt: 'asc' as const } },
  qualityChecks: { orderBy: { createdAt: 'asc' as const } },
};

/**
 * The person behind a login, created the first time they log anything.
 *
 * Matched on whichever handle the door provides — a pro id, an email, a
 * Telegram chat — so the cleaner who uses the web timer on Monday and the
 * voice bot on Tuesday stays one person with one pace.
 */
export async function resolveWorker(handle: {
  proId?: string;
  email?: string;
  telegramChatId?: string;
  name?: string;
  tenantId?: string;
}): Promise<WorkerRecord> {
  const email = handle.email?.trim().toLowerCase() || undefined;
  const name = handle.name?.trim() || email?.split('@')[0] || (handle.telegramChatId ? `Telegram ${handle.telegramChatId}` : 'Sin nombre');

  if (!isDbConfigured || !prisma) {
    const found = memoryWorkers.find(
      (w) =>
        (handle.proId && w.proId === handle.proId) ||
        (email && w.email === email) ||
        (handle.telegramChatId && w.telegramChatId === handle.telegramChatId),
    );
    if (found) {
      found.proId ??= handle.proId;
      found.email ??= email;
      found.telegramChatId ??= handle.telegramChatId;
      return found;
    }
    const worker: WorkerRecord = {
      id: id('wk'),
      tenantId: handle.tenantId,
      proId: handle.proId,
      email,
      telegramChatId: handle.telegramChatId,
      name,
      active: true,
      createdAt: new Date().toISOString(),
    };
    memoryWorkers.push(worker);
    return worker;
  }

  const or = [
    handle.proId ? { proId: handle.proId } : null,
    email ? { email } : null,
    handle.telegramChatId ? { telegramChatId: handle.telegramChatId } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  const existing = or.length ? await prisma.worker.findFirst({ where: { OR: or } }) : null;
  if (existing) {
    // Fill in a handle seen for the first time, never overwrite one.
    const fill = {
      ...(handle.proId && !existing.proId ? { proId: handle.proId } : {}),
      ...(email && !existing.email ? { email } : {}),
      ...(handle.telegramChatId && !existing.telegramChatId ? { telegramChatId: handle.telegramChatId } : {}),
    };
    if (Object.keys(fill).length === 0) return workerFromRow(existing);
    const row = await prisma.worker.update({ where: { id: existing.id }, data: fill }).catch(() => existing);
    return workerFromRow(row);
  }

  const row = await prisma.worker.create({
    data: { tenantId: handle.tenantId, proId: handle.proId, email, telegramChatId: handle.telegramChatId, name },
  });
  return workerFromRow(row);
}

export async function listWorkers(): Promise<WorkerRecord[]> {
  if (!isDbConfigured || !prisma) return [...memoryWorkers];
  const rows = await prisma.worker.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(workerFromRow);
}

/** The session still running for this person, if any. */
export async function openSession(loggedBy: string): Promise<Session | null> {
  if (!isDbConfigured || !prisma) {
    return memory.find((s) => s.loggedBy === loggedBy && !s.endedAt) ?? null;
  }
  const row = await prisma.activitySession.findFirst({
    where: { loggedBy, endedAt: null },
    orderBy: { startedAt: 'desc' },
    include: INCLUDE,
  });
  return row ? fromRow(row) : null;
}

export async function startSession(
  loggedBy: string,
  label?: string,
  serviceSlug?: string,
  context: SessionContext = {},
): Promise<Session> {
  // Only one job at a time. An abandoned session left open would silently
  // swallow the next job's segments.
  const existing = await openSession(loggedBy);
  if (existing) await endSession(loggedBy);

  const fields = {
    workerId: context.workerId,
    analysisId: context.analysisId,
    source: context.source ?? 'field',
    region: context.region,
    crewSize: Math.max(1, Math.min(10, Math.round(context.crewSize ?? 1))),
    arrivalFeeling: context.arrivalFeeling,
  };
  const service = serviceSlug ?? context.serviceSlug;

  if (!isDbConfigured || !prisma) {
    const session: Session = {
      id: id('as'),
      loggedBy,
      label,
      serviceSlug: service,
      ...fields,
      startedAt: new Date().toISOString(),
      segments: [],
      quality: [],
    };
    memory.unshift(session);
    return session;
  }

  const row = await prisma.activitySession.create({
    data: { loggedBy, label, serviceSlug: service, ...fields },
    include: INCLUDE,
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
  detail: SegmentDetail = {},
): Promise<StartRoomResult> {
  const session = (await openSession(loggedBy)) ?? (await startSession(loggedBy));
  const closed = await closeOpenSegment(loggedBy);
  const now = new Date();
  const fields = {
    roomKey: detail.roomKey,
    taskKey: detail.taskKey,
    depth: detail.depth,
    predictedMinutes: detail.predictedMinutes,
    together: detail.together || undefined,
  };

  if (!isDbConfigured || !prisma) {
    const target = memory.find((s) => s.id === session.id)!;
    target.segments.push({ id: id('sg'), roomType, task, ...fields, startedAt: now.toISOString() });
    return { session: target, closed };
  }

  await prisma.activitySegment.create({
    data: { sessionId: session.id, roomType, task, ...fields, together: Boolean(detail.together), startedAt: now },
  });
  return { session: (await openSession(loggedBy))!, closed };
}

/**
 * Marks a segment as wrong — the timer left running through lunch — so it
 * stops counting. Marked, never deleted: ground truth that can be edited
 * without a trace is not ground truth. Only the person's own segments, from
 * their recent jobs.
 */
export async function excludeSegment(loggedBy: string, segmentId: string, reason: string): Promise<boolean> {
  const recent = (await listSessionsBy(loggedBy, 10)).find((s) => s.segments.some((g) => g.id === segmentId));
  if (!recent) return false;
  const why = reason.trim().slice(0, 200) || 'marcado como incorrecto';

  if (!isDbConfigured || !prisma) {
    const seg = memory.find((s) => s.id === recent.id)?.segments.find((g) => g.id === segmentId);
    if (!seg) return false;
    seg.excluded = true;
    seg.excludedReason = why;
    return true;
  }
  await prisma.activitySegment.update({ where: { id: segmentId }, data: { excluded: true, excludedReason: why } });
  return true;
}

/** Records whether the work was good enough to count. */
export async function addQualityCheck(
  sessionId: string,
  check: { roomKey?: string; result: QualityResult; by: QualitySource; score?: number; note?: string },
): Promise<QualityRecord | null> {
  const record = {
    roomKey: check.roomKey,
    result: check.result,
    by: check.by,
    score: check.score,
    note: check.note?.slice(0, 500),
  };

  if (!isDbConfigured || !prisma) {
    const session = memory.find((s) => s.id === sessionId);
    if (!session) return null;
    const saved: QualityRecord = { id: id('qc'), ...record, createdAt: new Date().toISOString() };
    session.quality.push(saved);
    return saved;
  }
  const row = await prisma.qualityCheck.create({ data: { sessionId, ...record } }).catch(() => null);
  return row
    ? { id: row.id, ...record, createdAt: row.createdAt.toISOString() }
    : null;
}

async function listSessionsBy(loggedBy: string, limit: number): Promise<Session[]> {
  if (!isDbConfigured || !prisma) return memory.filter((s) => s.loggedBy === loggedBy).slice(0, limit);
  const rows = await prisma.activitySession.findMany({
    where: { loggedBy },
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: INCLUDE,
  });
  return rows.map(fromRow);
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
  return finish(session, new Date().toISOString(), false);
}

/**
 * Closes a job somebody forgot to close — found still open when the next job
 * starts. Closing it "now" would record a twenty-hour visit and wreck the
 * overhead median, so it ends where its last room ended, the room that was
 * left running is marked wrong (nobody knows when it really stopped), and
 * the job is flagged so its door-to-door is never read as a measurement.
 */
export async function closeForgottenSession(loggedBy: string): Promise<Session | null> {
  const session = await openSession(loggedBy);
  if (!session) return null;
  const running = session.segments.find((s) => !s.endedAt);
  if (running) {
    await closeOpenSegment(loggedBy);
    await excludeSegment(loggedBy, running.id, 'se quedó abierto');
  }
  const ends = session.segments
    .filter((s) => s.endedAt && s.id !== running?.id)
    .map((s) => s.endedAt!)
    .sort();
  const fresh = (await openSession(loggedBy)) ?? session;
  return finish(fresh, ends[ends.length - 1] ?? session.startedAt, true);
}

async function finish(session: Session, endedAt: string, closedLate: boolean): Promise<Session> {
  const total = session.segments.reduce((sum, s) => sum + (s.excluded ? 0 : (s.minutes ?? 0)), 0);

  if (!isDbConfigured || !prisma) {
    const target = memory.find((s) => s.id === session.id)!;
    target.endedAt = endedAt;
    target.totalMinutes = total;
    if (closedLate) target.closedLate = true;
    return target;
  }

  const row = await prisma.activitySession.update({
    where: { id: session.id },
    data: { endedAt: new Date(endedAt), totalMinutes: total, closedLate },
    include: INCLUDE,
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
    include: INCLUDE,
  });
  return rows.map(fromRow);
}

export interface SessionSpan {
  /** Sum of the closed segments: time with hands on a room. */
  taskMinutes: number;
  /** Arrival to departure. Null while the job is still running. */
  doorToDoorMinutes: number | null;
  /** Everything billed that no room segment covers. */
  overheadMinutes: number | null;
  /** 0–1. Null until the job is closed. */
  overheadShare: number | null;
}

/**
 * The two numbers whose difference is the missing constant.
 *
 * `totalMinutes` on a session is the sum of its room segments — a stopwatch
 * held per task. The elapsed time from arrival to departure is a different
 * number, and the gap between them is travel inside the property, hauling
 * equipment in, moving furniture, packing up: 20–40% of a cleaning day, and
 * every minute of it billed.
 *
 * This is why `lib/vision/model.ts` must not be recalibrated down to stopwatch
 * figures, and the gap can only be observed when somebody marks arriving
 * separately from starting the first room. The screen at /pilot/tiempo makes
 * that its first button for exactly this reason.
 */
export function sessionSpan(session: Session): SessionSpan {
  // A segment marked wrong (the timer ran through lunch) is neither room time
  // nor overhead: it comes out of both sides.
  const taskMinutes = session.segments.reduce((sum, s) => sum + (s.excluded ? 0 : (s.minutes ?? 0)), 0);
  const struck = session.segments.reduce((sum, s) => sum + (s.excluded ? (s.minutes ?? 0) : 0), 0);

  if (!session.endedAt) {
    return { taskMinutes, doorToDoorMinutes: null, overheadMinutes: null, overheadShare: null };
  }

  const doorToDoorMinutes = Math.max(0, minutesBetween(session.startedAt, session.endedAt) - struck);
  // Clamped at zero: rounding each side independently can put the sum of the
  // parts a minute above the whole, and a negative overhead is nonsense that
  // would poison any average built on it.
  const overheadMinutes = Math.max(0, doorToDoorMinutes - taskMinutes);

  return {
    taskMinutes,
    doorToDoorMinutes,
    overheadMinutes,
    overheadShare: doorToDoorMinutes > 0 ? overheadMinutes / doorToDoorMinutes : null,
  };
}

export interface OverheadSummary {
  /** Finished jobs where both numbers exist and the span is plausible. */
  samples: number;
  medianShare: number | null;
  taskMinutes: number;
  doorToDoorMinutes: number;
}

/**
 * Overhead across finished jobs, which is the figure the time model needs.
 *
 * A job logged as arrive-and-immediately-start-the-kitchen produces a zero
 * overhead that is an artefact of how it was logged, not a measurement. Those
 * are counted — refusing them would bias the result upward — but the median is
 * the headline so a handful cannot drag the number on a dataset this small.
 */
export function overheadSummary(sessions: Session[]): OverheadSummary {
  const spans = sessions
    // A job closed after the fact never saw its own packing-up.
    .filter((s) => s.endedAt && !s.closedLate)
    .map(sessionSpan)
    .filter((s) => s.doorToDoorMinutes !== null && s.doorToDoorMinutes > 0 && s.taskMinutes > 0);

  if (spans.length === 0) {
    return { samples: 0, medianShare: null, taskMinutes: 0, doorToDoorMinutes: 0 };
  }

  const shares = spans.map((s) => s.overheadShare ?? 0).sort((a, b) => a - b);
  const mid = Math.floor(shares.length / 2);

  return {
    samples: spans.length,
    medianShare: shares.length % 2 === 0 ? (shares[mid - 1] + shares[mid]) / 2 : shares[mid],
    taskMinutes: spans.reduce((sum, s) => sum + s.taskMinutes, 0),
    doorToDoorMinutes: spans.reduce((sum, s) => sum + (s.doorToDoorMinutes ?? 0), 0),
  };
}

/**
 * How fast one person works relative to everybody logging jobs.
 *
 * 0.85 means this person finishes a room in 85% of the time the whole dataset
 * takes on the same kind of room. Compared room type by room type rather than
 * on totals, because somebody who happens to be sent to small bathrooms is not
 * thereby faster.
 *
 * Null below `minRooms`, and the threshold is not decoration: with three
 * segments this number is noise with a decimal point on it, and a time factor
 * that confident is how a quote ends up 30% wrong for one person.
 */
export function personalFactor(
  sessions: Session[],
  loggedBy: string,
  minRooms = 8,
): { factor: number; samples: number } | null {
  const everyone = roomTimings(sessions);
  const baseline = new Map(everyone.map((t) => [t.roomType, t.medianMinutes]));

  const ratios: number[] = [];
  for (const session of sessions) {
    if (session.loggedBy !== loggedBy) continue;
    for (const seg of session.segments) {
      const base = baseline.get(seg.roomType);
      if (!base || base <= 0) continue;
      if (typeof seg.minutes !== 'number' || seg.minutes <= 0) continue;
      ratios.push(seg.minutes / base);
    }
  }

  if (ratios.length < minRooms) return null;

  const sorted = ratios.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return { factor: Math.round(median * 100) / 100, samples: ratios.length };
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
