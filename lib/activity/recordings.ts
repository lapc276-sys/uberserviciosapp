import { prisma, isDbConfigured } from '../db';
import { storageConfig, uploadUrl } from '../storage/s3';
import { enqueueJob } from '../pipeline/jobs';
import { pieceName, type PieceKind } from '../recording/format';
import { sessionLoggedBy } from './store';

/**
 * Hands-free recordings of a job: the RAW layer of the dataset.
 *
 * What is kept here is what was observed, never what anyone concluded from
 * it: each independent video segment with the checksum the phone computed,
 * each sensor chunk, every interruption, and the clock offset that puts all
 * of it on one time axis. Interpretations — model predictions, human labels,
 * quality findings — live in their own tables and point back here. Rows in
 * this file are written once and not edited; the bytes in the bucket are not
 * touched after upload (docs/DATOS.md).
 *
 * Postgres when configured, memory otherwise, like everything else.
 */

export type { PieceKind };

/** Only what MediaRecorder actually produces on phones. */
export const RECORDING_TYPES = ['video/webm', 'video/mp4'] as const;

/** Capture settings, from the environment so they can change without a release. */
export interface CaptureConfig {
  segmentSeconds: number;
  videoBitsPerSecond: number;
  maxHeight: number;
  frameRate: number;
}

function intEnv(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
}

/**
 * 30-second segments of 480p at 15 fps and 0.8 Mbit/s: set, not measured on
 * a phone. Recognising "she is cleaning the oven" needs no more, and three
 * hours of it is about a gigabyte. Battery and heat over a whole job are
 * still to be measured (CLAUDE.md, "Manos libres").
 */
export function captureConfig(env: Record<string, string | undefined> = process.env): CaptureConfig {
  return {
    segmentSeconds: intEnv(env, 'RECORDING_SEGMENT_SECONDS', 30, 5, 600),
    videoBitsPerSecond: intEnv(env, 'RECORDING_VIDEO_BITRATE', 800_000, 100_000, 8_000_000),
    maxHeight: intEnv(env, 'RECORDING_MAX_HEIGHT', 480, 240, 2160),
    frameRate: intEnv(env, 'RECORDING_FPS', 15, 5, 60),
  };
}

// ── Consent ─────────────────────────────────────────────────────────────────

/**
 * The words people agree to, versioned: a consent is only as good as the
 * sentence it was given to, so changing the sentence means asking again.
 * To be read by a lawyer before anything is recorded at scale.
 */
export const CONSENT_VERSION = '2026-11-v1';
export const CONSENT_TEXT = {
  worker:
    'Acepto que, mientras trabajo con manos libres, el teléfono grabe video sin sonido y datos de movimiento para medir tiempos y mejorar el sistema. Puedo pausar la cámara cuando quiera y pedir que se borre lo grabado.',
  customer: 'El cliente sabe que el teléfono va a grabar video sin sonido dentro de su casa durante este trabajo.',
} as const;

interface MemoryConsent {
  kind: 'worker' | 'customer';
  workerId: string;
  sessionId?: string;
  version: string;
  withdrawnAt?: string;
}

const memoryConsents: MemoryConsent[] = [];

export async function hasWorkerConsent(workerId: string): Promise<boolean> {
  if (!isDbConfigured || !prisma) {
    return memoryConsents.some((c) => c.kind === 'worker' && c.workerId === workerId && c.version === CONSENT_VERSION && !c.withdrawnAt);
  }
  const row = await prisma.recordingConsent.findFirst({
    where: { kind: 'worker', workerId, version: CONSENT_VERSION, withdrawnAt: null },
  });
  return Boolean(row);
}

export async function hasCustomerConsent(sessionId: string): Promise<boolean> {
  if (!isDbConfigured || !prisma) {
    return memoryConsents.some((c) => c.kind === 'customer' && c.sessionId === sessionId && !c.withdrawnAt);
  }
  const row = await prisma.recordingConsent.findFirst({ where: { kind: 'customer', sessionId, withdrawnAt: null } });
  return Boolean(row);
}

export async function recordConsent(
  kind: 'worker' | 'customer',
  workerId: string,
  recordedBy: string,
  sessionId?: string,
): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memoryConsents.push({ kind, workerId, sessionId, version: CONSENT_VERSION });
    return;
  }
  await prisma.recordingConsent.create({
    data: { kind, workerId, sessionId, version: CONSENT_VERSION, statement: CONSENT_TEXT[kind], video: true, audio: false, recordedBy },
  });
}

// ── Recordings ──────────────────────────────────────────────────────────────

export interface RecordingRecord {
  id: string;
  sessionId: string;
  /** t0 on the server clock: monotonic ms from the phone are added to this. */
  startedAt: string;
  endedAt?: string;
  mimeType: string;
  chunkSeconds: number;
  storagePrefix?: string;
  clockOffsetMs?: number;
  clockRttMs?: number;
  /** Indexes confirmed, per kind. */
  pieces: { video: number[]; sensors: number[] };
}

interface MemoryPiece {
  kind: PieceKind;
  index: number;
  sha256: string;
  bytes: number;
  monoStartMs: number;
  monoEndMs: number;
}

interface MemoryRecording extends RecordingRecord {
  capture?: unknown;
  device?: unknown;
  receipts: MemoryPiece[];
  events: { seq?: number; kind: string; monoMs?: number; data?: unknown }[];
}

const memory: MemoryRecording[] = [];

export function extensionFor(mimeType: string): 'webm' | 'mp4' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function rid(): string {
  return `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(row: any): RecordingRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString(),
    mimeType: row.mimeType,
    chunkSeconds: row.chunkSeconds,
    storagePrefix: row.storagePrefix ?? undefined,
    clockOffsetMs: row.clockOffsetMs ?? undefined,
    clockRttMs: row.clockRttMs ?? undefined,
    pieces: {
      video: (row.segments ?? []).map((s: any) => s.index),
      sensors: (row.sensorChunks ?? []).map((s: any) => s.index),
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const WITH_PIECES = { segments: { select: { index: true } }, sensorChunks: { select: { index: true } } };

export interface StartInput {
  mimeType: string;
  chunkSeconds: number;
  /** t0 on the server clock, from recordingStart(). */
  startedAt: Date;
  clockOffsetMs?: number;
  clockRttMs?: number;
  capture?: Record<string, unknown>;
  device?: Record<string, unknown>;
}

export async function startRecording(sessionId: string, input: StartInput): Promise<RecordingRecord> {
  const uploads = storageConfig() !== null;
  if (!isDbConfigured || !prisma) {
    const id = rid();
    const record: MemoryRecording = {
      id,
      sessionId,
      startedAt: input.startedAt.toISOString(),
      mimeType: input.mimeType,
      chunkSeconds: input.chunkSeconds,
      storagePrefix: uploads ? `recordings/${sessionId}/${id}` : undefined,
      clockOffsetMs: input.clockOffsetMs,
      clockRttMs: input.clockRttMs,
      capture: input.capture,
      device: input.device,
      pieces: { video: [], sensors: [] },
      receipts: [],
      events: [],
    };
    memory.unshift(record);
    return record;
  }
  const row = await prisma.jobRecording.create({
    data: {
      sessionId,
      startedAt: input.startedAt,
      mimeType: input.mimeType,
      chunkSeconds: input.chunkSeconds,
      clockOffsetMs: input.clockOffsetMs,
      clockRttMs: input.clockRttMs,
      capture: (input.capture ?? undefined) as object | undefined,
      device: (input.device ?? undefined) as object | undefined,
    },
  });
  const final = uploads
    ? await prisma.jobRecording.update({
        where: { id: row.id },
        data: { storagePrefix: `recordings/${sessionId}/${row.id}` },
        include: WITH_PIECES,
      })
    : { ...row, segments: [], sensorChunks: [] };
  return fromRow(final);
}

export async function getRecording(recordingId: string): Promise<RecordingRecord | null> {
  if (!recordingId || recordingId.length > 64) return null;
  if (!isDbConfigured || !prisma) return memory.find((r) => r.id === recordingId) ?? null;
  const row = await prisma.jobRecording.findUnique({ where: { id: recordingId }, include: WITH_PIECES }).catch(() => null);
  return row ? fromRow(row) : null;
}

/**
 * The recording, if it belongs to a job this person logged — open or closed.
 * Closed counts: pieces left on a phone by a page that died are uploaded the
 * next time the timer opens, after the job has ended.
 */
export async function ownRecording(loggedBy: string, recordingId: string): Promise<RecordingRecord | null> {
  const record = await getRecording(recordingId);
  if (!record) return null;
  return (await sessionLoggedBy(record.sessionId)) === loggedBy ? record : null;
}

/** <prefix>/video/00001.webm, <prefix>/sensors/00001.jsonl.gz */
export function pieceKey(record: Pick<RecordingRecord, 'storagePrefix' | 'mimeType'>, kind: PieceKind, index: number): string | null {
  if (!record.storagePrefix) return null;
  return `${record.storagePrefix}/${pieceName(kind, index, record.mimeType)}`;
}

export function pieceContentType(record: Pick<RecordingRecord, 'mimeType'>, kind: PieceKind): string {
  return kind === 'video' ? record.mimeType : 'application/gzip';
}

/** A signed URL the phone PUTs one piece to, or null when nothing leaves the phone. */
export function pieceUploadUrl(record: RecordingRecord, kind: PieceKind, index: number): string | null {
  const config = storageConfig();
  const key = pieceKey(record, kind, index);
  if (!config || !key) return null;
  return uploadUrl(key, config);
}

export interface PieceReceipt {
  index: number;
  bytes: number;
  sha256: string;
  monoStartMs: number;
  monoEndMs: number;
  samples?: number;
  streams?: string[];
}

/**
 * The phone says a piece is in the bucket. Written once: a repeated
 * confirmation of the same index keeps the first row, because a raw record
 * that can be overwritten is not raw. A repeat that disagrees with the first
 * — a different checksum for the same index — is not silently dropped
 * either: it is written down as an event for the pipeline to look at.
 */
export async function recordPiece(record: RecordingRecord, kind: PieceKind, receipt: PieceReceipt): Promise<'recorded' | 'repeat' | 'conflict'> {
  const objectKey = pieceKey(record, kind, receipt.index);
  if (!objectKey) return 'repeat';

  if (!isDbConfigured || !prisma) {
    const target = memory.find((r) => r.id === record.id);
    if (!target) return 'repeat';
    const first = target.receipts.find((p) => p.kind === kind && p.index === receipt.index);
    if (first) {
      if (first.sha256 === receipt.sha256) return 'repeat';
      target.events.push({ kind: 'piece_conflict', data: { kind, index: receipt.index, first: first.sha256, second: receipt.sha256 } });
      return 'conflict';
    }
    target.receipts.push({ kind, ...receipt });
    target.pieces[kind].push(receipt.index);
    return 'recorded';
  }

  const common = {
    recordingId: record.id,
    index: receipt.index,
    objectKey,
    bytes: Math.round(receipt.bytes),
    sha256: receipt.sha256,
    monoStartMs: receipt.monoStartMs,
    monoEndMs: receipt.monoEndMs,
  };
  try {
    if (kind === 'video') {
      await prisma.videoSegment.create({ data: { ...common, mimeType: record.mimeType } });
    } else {
      await prisma.sensorChunk.create({ data: { ...common, samples: receipt.samples ?? 0, streams: receipt.streams ?? [] } });
    }
    return 'recorded';
  } catch {
    const where = { recordingId_index: { recordingId: record.id, index: receipt.index } };
    const first =
      kind === 'video'
        ? await prisma.videoSegment.findUnique({ where, select: { sha256: true } })
        : await prisma.sensorChunk.findUnique({ where, select: { sha256: true } });
    if (!first) throw new Error('piece could not be recorded');
    if (first.sha256 === receipt.sha256) return 'repeat';
    await prisma.recordingEvent.create({
      data: { recordingId: record.id, kind: 'piece_conflict', data: { kind, index: receipt.index, first: first.sha256, second: receipt.sha256 } },
    });
    return 'conflict';
  }
}

export interface EventInput {
  /** The phone's counter; absent for events the server writes. */
  seq?: number;
  kind: string;
  monoMs?: number;
  clientUtcMs?: number;
  data?: Record<string, unknown>;
}

/**
 * Interruptions, privacy pauses, telemetry: as they happened. The same event
 * may arrive more than once — retried, beaconed from a closing page, then
 * recovered the next day — and is kept once, by its sequence number.
 */
export async function addEvents(recordingId: string, events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  if (!isDbConfigured || !prisma) {
    const rec = memory.find((r) => r.id === recordingId);
    if (!rec) return;
    for (const e of events) {
      if (e.seq !== undefined && rec.events.some((x) => x.seq === e.seq)) continue;
      rec.events.push({ seq: e.seq, kind: e.kind, monoMs: e.monoMs, data: e.data });
    }
    return;
  }
  await prisma.recordingEvent.createMany({
    data: events.map((e) => ({
      recordingId,
      seq: e.seq,
      kind: e.kind,
      monoMs: e.monoMs,
      clientUtcMs: e.clientUtcMs,
      data: (e.data ?? undefined) as object | undefined,
    })),
    skipDuplicates: true,
  });
}

/**
 * Closes a recording and hands it to the pipeline, which checks every piece
 * against its checksum before anything is built on it.
 *
 * `endMonoMs` is where the phone's last piece ended. A recording closed by
 * the recovery of a page that died ends there, not when somebody happened
 * to open the timer again the next morning.
 */
export async function stopRecording(record: RecordingRecord, endMonoMs?: number): Promise<void> {
  if (record.endedAt) return;
  const start = new Date(record.startedAt).getTime();
  const now = Date.now();
  const endedAt = new Date(endMonoMs !== undefined && endMonoMs >= 0 ? Math.min(now, start + endMonoMs) : now);
  if (!isDbConfigured || !prisma) {
    const target = memory.find((r) => r.id === record.id);
    if (target) target.endedAt = endedAt.toISOString();
    return;
  }
  await prisma.jobRecording.update({ where: { id: record.id }, data: { endedAt } });
  // Validation waits a little: the last pieces may still be on their way.
  await enqueueJob('validate_recording', { recordingId: record.id }, new Date(now + 10 * 60_000));
}

/**
 * Where a moment of the job sits in the video: milliseconds from the
 * recording's t0. Null when it happened before the camera started.
 */
export function videoOffsetMs(record: Pick<RecordingRecord, 'startedAt'>, at: string): number | null {
  const offset = new Date(at).getTime() - new Date(record.startedAt).getTime();
  return offset >= 0 ? offset : null;
}

/** Test hook: what the memory store holds for a recording. */
export function memoryRecording(recordingId: string): MemoryRecording | undefined {
  return memory.find((r) => r.id === recordingId);
}
