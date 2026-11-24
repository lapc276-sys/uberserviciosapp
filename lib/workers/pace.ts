import type { Session, Segment, WorkerRecord } from '../activity/store';
import type { JobRoom } from './job';

/**
 * How fast each person works, learned from their own jobs.
 *
 * The unit of learning is not "minutes for a kitchen" but the ratio between
 * the minutes a room actually took and the minutes the engine predicted for
 * that same room. The prediction already contains the grease, the clutter and
 * the size, so the ratio is comparable across a spotless kitchen and a
 * disgusting one — which is why a person's pace is readable after eight rooms
 * instead of after a year of filling a worker × task × condition table.
 *
 * Four layers, each starting as the one above and becoming itself as it
 * gathers data (docs/APRENDIZAJE.md §5):
 *
 *   reference  the constants in lib/vision/model.ts — hypotheses
 *   global     every company pooled, per region and room type
 *   company    this company's crews against the prediction
 *   worker     this person against their own company
 *
 * None of this reaches a customer's price. A slower cleaner does not make a
 * dearer apartment; these numbers schedule, staff and show people their own
 * strengths. See docs/APRENDIZAJE.md §6.
 *
 * Every threshold below is a hypothesis exactly like the time constants, and
 * is named so it can be found when the data says otherwise.
 */

/** Weight of the prior, in rooms — and the "low confidence" cutoff. */
export const PRIOR_ROOMS = 8;
/** Rooms before an estimate can be called reliable… */
export const HIGH_ROOMS = 30;
/** …and how consistent they must be: median absolute deviation over median. */
export const HIGH_SPREAD = 0.25;
/** A person's recent rooms only, so getting better shows. */
export const WINDOW = 40;
/** A global cell publishes only when several companies fill it. */
export const GLOBAL_MIN_TENANTS = 3;
export const GLOBAL_MIN_ROOMS = 20;
/** Door-to-door jobs before the measured overhead replaces the default. */
export const OVERHEAD_MIN_JOBS = 5;
/**
 * Share of a visit that is not hands-on a room, until it is measured. The
 * middle of the 20–40% that travel, setup and packing usually take.
 */
export const DEFAULT_OVERHEAD_SHARE = 0.3;
/** Jobs are grouped into days where the work happens. */
const DAY_TZ = 'America/New_York';
/** Klaudy's own crews, which have no tenant id. */
const OWN = 'klaudy';

export type Confidence = 'provisional' | 'low' | 'medium' | 'high';
export type Basis = 'reference' | 'global' | 'company' | 'worker';

export interface PaceEstimate {
  /** 1.15 = 15% more time than the layer above expects. */
  factor: number;
  /** Rooms behind the number. */
  samples: number;
  /** Median absolute deviation over median; null below two samples. */
  spread: number | null;
  confidence: Confidence;
  /** Which layer the number actually comes from. */
  basis: Basis;
}

/** One room of one job, with what it took and what was predicted. */
export interface RoomObservation {
  sessionId: string;
  analysisId: string | null;
  workerId: string;
  tenant: string;
  region: string | null;
  serviceSlug: string | null;
  roomKey: string;
  roomType: string;
  actualMinutes: number;
  predictedMinutes: number;
  ratio: number;
  /** Two people at once — never one person's pace. */
  together: boolean;
  startedAt: string;
  // Context that explains variance, all computed rather than asked.
  crewSize: number;
  /** 1 = this person's first job that day. */
  jobOfDay: number;
  /** Door-to-door hours already worked that day. */
  hoursBefore: number;
  /** This person's earlier jobs in the app: experience, measured. */
  jobsBefore: number;
}

/** A paid extra timed on its own: "el horno por dentro". */
export interface TaskObservation {
  sessionId: string;
  workerId: string;
  tenant: string;
  region: string | null;
  roomKey: string;
  roomType: string;
  taskKey: string;
  depth: string | null;
  actualMinutes: number;
  predictedMinutes: number;
  ratio: number;
  together: boolean;
  startedAt: string;
}

/**
 * The one place test data is kept out. Everything that learns calls this, so
 * a synthetic job cannot be forgotten into a calculation somewhere.
 */
export function countsAsData(session: Pick<Session, 'source'>): boolean {
  return session.source !== 'test';
}

function workerKey(s: Session): string {
  return s.workerId ?? `logged:${s.loggedBy}`;
}

function minutesOf(seg: Segment): number {
  if (!seg.endedAt) return 0;
  return Math.max(0, (new Date(seg.endedAt).getTime() - new Date(seg.startedAt).getTime()) / 60000);
}

function dayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );
}

function hoursBetween(from: string, to: string | undefined): number {
  if (!to) return 0;
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 3600000);
}

interface Context {
  jobOfDay: number;
  hoursBefore: number;
  jobsBefore: number;
}

/** Day position and experience for every session, from the sessions alone. */
function contextFor(sessions: Session[]): Map<string, Context> {
  const byWorker = new Map<string, Session[]>();
  for (const s of sessions) {
    const list = byWorker.get(workerKey(s)) ?? [];
    list.push(s);
    byWorker.set(workerKey(s), list);
  }
  const out = new Map<string, Context>();
  for (const list of byWorker.values()) {
    const sorted = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    sorted.forEach((s, i) => {
      const day = dayOf(s.startedAt);
      const earlier = sorted.slice(0, i).filter((e) => dayOf(e.startedAt) === day);
      out.set(s.id, {
        jobOfDay: earlier.length + 1,
        hoursBefore: Math.round(earlier.reduce((h, e) => h + hoursBetween(e.startedAt, e.endedAt), 0) * 10) / 10,
        jobsBefore: i,
      });
    });
  }
  return out;
}

/**
 * Every room and extra that can be learned from.
 *
 * A room is left out — not guessed at — when any part of it is still running,
 * was marked wrong, or had to be redone: a room with one bad segment has an
 * actual that is not the room's actual, and a fast room that was redone is
 * not fast. Rooms logged before the timer knew its job have no prediction and
 * stay out too; they still count in the plain per-room medians of
 * lib/activity/store.ts.
 */
export function observationsFrom(
  sessions: Session[],
  workers: WorkerRecord[] = [],
): { rooms: RoomObservation[]; tasks: TaskObservation[] } {
  const counted = sessions.filter(countsAsData);
  const tenantOf = new Map(workers.map((w) => [w.id, w.tenantId ?? OWN]));
  const context = contextFor(counted);
  const rooms: RoomObservation[] = [];
  const tasks: TaskObservation[] = [];

  for (const s of counted) {
    const jobRedone = s.quality.some((q) => !q.roomKey && q.result === 'redo');
    if (jobRedone) continue;
    const redone = new Set(s.quality.filter((q) => q.roomKey && q.result === 'redo').map((q) => q.roomKey!));
    const ctx = context.get(s.id)!;
    const tenant = (s.workerId && tenantOf.get(s.workerId)) || OWN;

    const byRoom = new Map<string, Segment[]>();
    for (const seg of s.segments) {
      if (!seg.roomKey) continue;
      const list = byRoom.get(seg.roomKey) ?? [];
      list.push(seg);
      byRoom.set(seg.roomKey, list);
    }

    for (const [roomKey, segs] of byRoom) {
      if (redone.has(roomKey)) continue;
      const together = segs.some((g) => g.together);

      // Extras are their own observations even when the rest of the room is
      // not usable: an oven timed cleanly is an oven timed cleanly.
      const byTask = new Map<string, Segment[]>();
      for (const g of segs) {
        if (!g.taskKey) continue;
        const list = byTask.get(g.taskKey) ?? [];
        list.push(g);
        byTask.set(g.taskKey, list);
      }
      for (const [taskKey, tsegs] of byTask) {
        if (tsegs.some((g) => !g.endedAt || g.excluded)) continue;
        const predicted = tsegs.find((g) => (g.predictedMinutes ?? 0) > 0)?.predictedMinutes ?? 0;
        const actual = tsegs.reduce((m, g) => m + minutesOf(g), 0);
        if (predicted <= 0 || actual <= 0) continue;
        tasks.push({
          sessionId: s.id,
          workerId: workerKey(s),
          tenant,
          region: s.region ?? null,
          roomKey,
          roomType: tsegs[0].roomType,
          taskKey,
          depth: tsegs[0].depth ?? null,
          actualMinutes: round2(actual),
          predictedMinutes: predicted,
          ratio: round3(actual / predicted),
          together,
          startedAt: tsegs[0].startedAt,
        });
      }

      if (segs.some((g) => !g.endedAt || g.excluded)) continue;
      const predicted = segs.find((g) => !g.taskKey && (g.predictedMinutes ?? 0) > 0)?.predictedMinutes ?? 0;
      // Room = everything done in it, extras included, because the room's
      // prediction includes them.
      const actual = segs.reduce((m, g) => m + minutesOf(g), 0);
      if (predicted <= 0 || actual <= 0) continue;

      rooms.push({
        sessionId: s.id,
        analysisId: s.analysisId ?? null,
        workerId: workerKey(s),
        tenant,
        region: s.region ?? null,
        serviceSlug: s.serviceSlug ?? null,
        roomKey,
        roomType: segs[0].roomType,
        actualMinutes: round2(actual),
        predictedMinutes: predicted,
        ratio: round3(actual / predicted),
        together,
        startedAt: segs[0].startedAt,
        crewSize: s.crewSize,
        ...ctx,
      });
    }
  }

  return { rooms, tasks };
}

/**
 * Rooms as the team did them. Two people in one room each log the whole
 * elapsed time, so the room's person-minutes are their sum — counted once,
 * for the company, and never for either person's pace.
 */
export function teamObservations(rooms: RoomObservation[]): RoomObservation[] {
  const solo = rooms.filter((r) => !r.together);
  const shared = new Map<string, RoomObservation>();
  for (const r of rooms) {
    if (!r.together) continue;
    const key = `${r.analysisId ?? r.sessionId}|${r.roomKey}`;
    const prev = shared.get(key);
    if (!prev) {
      shared.set(key, { ...r });
      continue;
    }
    prev.actualMinutes = round2(prev.actualMinutes + r.actualMinutes);
    prev.ratio = round3(prev.actualMinutes / prev.predictedMinutes);
  }
  return [...solo, ...shared.values()];
}

// ── Statistics ──────────────────────────────────────────────────────────────

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median absolute deviation over the median: robust "how consistent". */
export function spreadOf(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = median(values);
  if (!(m > 0)) return null;
  return round2(median(values.map((v) => Math.abs(v - m))) / m);
}

export function confidenceFor(samples: number, spread: number | null): Confidence {
  if (samples === 0) return 'provisional';
  if (samples < PRIOR_ROOMS) return 'low';
  if (samples < HIGH_ROOMS || spread === null || spread > HIGH_SPREAD) return 'medium';
  return 'high';
}

/**
 * Starts as the prior and becomes the data: with 0 rooms it is the prior,
 * with 8 it is half and half, with 40 it is 83% the person. A day where the
 * timer ran through lunch cannot give anyone an extreme number.
 */
export function blend(values: number[], prior: number, weight = PRIOR_ROOMS): number {
  if (values.length === 0) return prior;
  return (values.length * median(values) + weight * prior) / (values.length + weight);
}

function estimate(values: number[], prior: PaceEstimate, basis: Basis): PaceEstimate {
  if (values.length === 0) return prior;
  const spread = spreadOf(values);
  return {
    factor: round2(blend(values, prior.factor)),
    samples: values.length,
    spread,
    confidence: confidenceFor(values.length, spread),
    basis,
  };
}

const REFERENCE: PaceEstimate = { factor: 1, samples: 0, spread: null, confidence: 'provisional', basis: 'reference' };

function newestFirst<T extends { startedAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ── Layers ──────────────────────────────────────────────────────────────────

function publishable(cell: RoomObservation[]): boolean {
  return cell.length >= GLOBAL_MIN_ROOMS && new Set(cell.map((r) => r.tenant)).size >= GLOBAL_MIN_TENANTS;
}

/**
 * Every company pooled. Falls back from region + room type, to room type, to
 * everything, and to the reference when no cell is full enough.
 *
 * A cell needs several companies, not just many rooms: a "global average"
 * one company filled is that company's numbers, readable by its competitors.
 * Nothing here carries a name or a company — only ratios and their context.
 */
export function globalPace(
  rooms: RoomObservation[],
  { region, roomType }: { region?: string | null; roomType?: string } = {},
): PaceEstimate {
  const team = teamObservations(rooms);
  const cells: RoomObservation[][] = [];
  if (region && roomType) cells.push(team.filter((r) => r.region === region && r.roomType === roomType));
  if (roomType) cells.push(team.filter((r) => r.roomType === roomType));
  cells.push(team);

  for (const cell of cells) {
    if (!publishable(cell)) continue;
    const ratios = cell.map((r) => r.ratio);
    const spread = spreadOf(ratios);
    return {
      factor: round2(median(ratios)),
      samples: cell.length,
      spread,
      confidence: confidenceFor(cell.length, spread),
      basis: 'global',
    };
  }
  return REFERENCE;
}

/**
 * One company's crews against the prediction. Per room type it leans on the
 * company's own overall figure first, and only that leans on the global one:
 * three kitchens say more about this company's kitchens when read beside its
 * forty other rooms than beside other companies' kitchens.
 */
export function companyPace(
  rooms: RoomObservation[],
  tenant: string = OWN,
  { roomType, region }: { roomType?: string; region?: string | null } = {},
): PaceEstimate {
  const own = teamObservations(rooms.filter((r) => r.tenant === tenant));
  const overall = estimate(
    own.map((r) => r.ratio),
    globalPace(rooms, { region }),
    'company',
  );
  if (!roomType) return overall;
  return estimate(
    own.filter((r) => r.roomType === roomType).map((r) => r.ratio),
    overall,
    'company',
  );
}

/**
 * One person against their own company: 1.10 = 10% slower than the team on
 * the same rooms. Only their recent solo rooms count, and each is divided by
 * the team's figure for that kind of room — somebody sent to the hard
 * bathrooms is not thereby slow, because the prediction already said hard.
 */
export function workerPace(
  rooms: RoomObservation[],
  workerId: string,
  { tenant = OWN, roomType }: { tenant?: string; roomType?: string } = {},
): PaceEstimate {
  const mine = newestFirst(rooms.filter((r) => r.workerId === workerId && !r.together));
  // Against what the team actually did, not the blended team estimate: the
  // blend leans towards the reference while data is thin, and dividing by it
  // would make a team of one look faster than itself.
  const team = teamObservations(rooms.filter((r) => r.tenant === tenant));
  const teamOverall = team.length ? median(team.map((r) => r.ratio)) : 1;
  const teamFactor = new Map<string, number>();
  const relative = (r: RoomObservation): number => {
    if (!teamFactor.has(r.roomType)) {
      const same = team.filter((t) => t.roomType === r.roomType).map((t) => t.ratio);
      teamFactor.set(r.roomType, same.length ? median(same) : teamOverall);
    }
    return r.ratio / teamFactor.get(r.roomType)!;
  };

  const sameAsTeam: PaceEstimate = { ...REFERENCE, basis: 'company' };
  const overall = estimate(mine.slice(0, WINDOW).map(relative), sameAsTeam, 'worker');
  if (!roomType) return overall;
  return estimate(
    mine.filter((r) => r.roomType === roomType).slice(0, WINDOW).map(relative),
    overall,
    'worker',
  );
}

// ── Using it ────────────────────────────────────────────────────────────────

export interface DurationEstimate {
  /** Door to door, which is what gets scheduled and billed. */
  minutes: number;
  /** Hands on the rooms. */
  handsOnMinutes: number;
  overheadShare: number;
  /** False while the overhead is the default rather than measured. */
  overheadMeasured: boolean;
  basis: Basis;
  confidence: Confidence;
  /** Rooms behind the weakest layer used. */
  samples: number;
}

const ORDER: Confidence[] = ['provisional', 'low', 'medium', 'high'];

/**
 * How long this job will take this person — or the team, without a person.
 *
 * The ratios were measured as hands-on time against the engine's billable
 * prediction, so the hands-on figure is scaled back up by the overhead share
 * to get the visit. Until any company data exists the engine's own total is
 * returned untouched and labelled as the reference it is.
 *
 * For scheduling and staffing. Never for a customer's price.
 */
export function durationFor(
  job: JobRoom[],
  rooms: RoomObservation[],
  {
    tenant = OWN,
    region,
    workerId,
    overhead,
  }: {
    tenant?: string;
    region?: string | null;
    workerId?: string;
    overhead?: { samples: number; medianShare: number | null };
  } = {},
): DurationEstimate {
  const predicted = job.reduce((m, r) => m + r.predictedMinutes, 0);
  const company = companyPace(rooms, tenant, { region });
  if (company.basis === 'reference') {
    return {
      minutes: Math.round(predicted),
      handsOnMinutes: Math.round(predicted * (1 - DEFAULT_OVERHEAD_SHARE)),
      overheadShare: DEFAULT_OVERHEAD_SHARE,
      overheadMeasured: false,
      basis: 'reference',
      confidence: 'provisional',
      samples: 0,
    };
  }

  let handsOn = 0;
  let weakest: PaceEstimate = company;
  let usedWorker = false;
  for (const room of job) {
    const team = companyPace(rooms, tenant, { roomType: room.type, region });
    let factor = team.factor;
    if (workerId) {
      const person = workerPace(rooms, workerId, { tenant, roomType: room.type });
      factor *= person.factor;
      // Somebody new adds nothing yet: the estimate is the team's, and so is
      // its confidence — not "provisional" because one person is new.
      if (person.basis === 'worker') {
        usedWorker = true;
        if (ORDER.indexOf(person.confidence) < ORDER.indexOf(weakest.confidence)) weakest = person;
      }
    }
    if (ORDER.indexOf(team.confidence) < ORDER.indexOf(weakest.confidence)) weakest = team;
    handsOn += room.predictedMinutes * factor;
  }

  const measured = Boolean(overhead && overhead.samples >= OVERHEAD_MIN_JOBS && overhead.medianShare !== null);
  const share = measured ? Math.min(0.6, Math.max(0, overhead!.medianShare!)) : DEFAULT_OVERHEAD_SHARE;

  return {
    minutes: Math.round(handsOn / (1 - share)),
    handsOnMinutes: Math.round(handsOn),
    overheadShare: round2(share),
    overheadMeasured: measured,
    basis: usedWorker ? 'worker' : 'company',
    confidence: weakest.confidence,
    samples: weakest.samples,
  };
}

// ── What the admin sees ─────────────────────────────────────────────────────

export interface WorkerPaceRow {
  workerId: string;
  name: string;
  jobs: number;
  /** Rooms that count towards their pace. */
  rooms: number;
  overall: PaceEstimate;
  byRoomType: { roomType: string; pace: PaceEstimate }[];
  /** Room types where they beat their own average, and where they trail it. */
  strongest: string | null;
  weakest: string | null;
  /** Rooms left out because they had to be redone. */
  redone: number;
}

/** Below this, a room type is not called a strength or a weakness. */
const STRENGTH_MIN_ROOMS = 3;

export function paceTable(sessions: Session[], workers: WorkerRecord[]): WorkerPaceRow[] {
  const { rooms } = observationsFrom(sessions, workers);
  const counted = sessions.filter(countsAsData);
  const names = new Map(workers.map((w) => [w.id, w.name]));
  const tenantOf = new Map(workers.map((w) => [w.id, w.tenantId ?? OWN]));
  const ids = [...new Set(counted.map(workerKey))];

  return ids
    .map((id) => {
      const tenant = tenantOf.get(id) ?? OWN;
      const mine = rooms.filter((r) => r.workerId === id && !r.together);
      const types = [...new Set(mine.map((r) => r.roomType))];
      const overall = workerPace(rooms, id, { tenant });
      const byRoomType = types.map((roomType) => ({ roomType, pace: workerPace(rooms, id, { tenant, roomType }) }));
      const judged = byRoomType
        .filter((t) => mine.filter((r) => r.roomType === t.roomType).length >= STRENGTH_MIN_ROOMS)
        .sort((a, b) => a.pace.factor - b.pace.factor);
      const sessionsOf = counted.filter((s) => workerKey(s) === id);
      return {
        workerId: id,
        name: names.get(id) ?? id.replace(/^logged:/, ''),
        jobs: sessionsOf.length,
        rooms: mine.length,
        overall,
        byRoomType,
        strongest: judged.length >= 2 ? judged[0].roomType : null,
        weakest: judged.length >= 2 ? judged[judged.length - 1].roomType : null,
        redone: sessionsOf.reduce((n, s) => n + s.quality.filter((q) => q.result === 'redo').length, 0),
      };
    })
    .sort((a, b) => b.rooms - a.rooms);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
