import { prisma, isDbConfigured } from '../db';
import { storageConfig, uploadUrl } from '../storage/s3';

/**
 * Hands-free recordings of a job, kept the same two ways as everything else:
 * Postgres when configured, memory otherwise.
 *
 * Only the bookkeeping lives here — when the video started (its t=0 on the
 * same clock as the segments), which pieces reached the bucket. The video
 * itself goes from the phone straight to the bucket with a signed URL.
 */

export interface RecordingRecord {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  mimeType: string;
  chunkSeconds: number;
  storagePrefix?: string;
  chunkIndexes: number[];
  kilobytes: number;
}

const memory: RecordingRecord[] = [];

/** Only what MediaRecorder actually produces on phones. */
export const RECORDING_TYPES = ['video/webm', 'video/mp4'] as const;

export function extensionFor(mimeType: string): 'webm' | 'mp4' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function id(): string {
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
    chunkIndexes: row.chunkIndexes ?? [],
    kilobytes: row.kilobytes ?? 0,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function startRecording(sessionId: string, mimeType: string, chunkSeconds: number): Promise<RecordingRecord> {
  const uploads = storageConfig() !== null;
  if (!isDbConfigured || !prisma) {
    const rid = id();
    const record: RecordingRecord = {
      id: rid,
      sessionId,
      startedAt: new Date().toISOString(),
      mimeType,
      chunkSeconds,
      storagePrefix: uploads ? `recordings/${sessionId}/${rid}` : undefined,
      chunkIndexes: [],
      kilobytes: 0,
    };
    memory.unshift(record);
    return record;
  }
  const row = await prisma.jobRecording.create({ data: { sessionId, mimeType, chunkSeconds } });
  if (!uploads) return fromRow(row);
  const updated = await prisma.jobRecording.update({
    where: { id: row.id },
    data: { storagePrefix: `recordings/${sessionId}/${row.id}` },
  });
  return fromRow(updated);
}

export async function getRecording(recordingId: string): Promise<RecordingRecord | null> {
  if (!isDbConfigured || !prisma) return memory.find((r) => r.id === recordingId) ?? null;
  const row = await prisma.jobRecording.findUnique({ where: { id: recordingId } }).catch(() => null);
  return row ? fromRow(row) : null;
}

export async function listRecordings(sessionIds: string[]): Promise<RecordingRecord[]> {
  if (sessionIds.length === 0) return [];
  if (!isDbConfigured || !prisma) return memory.filter((r) => sessionIds.includes(r.sessionId));
  const rows = await prisma.jobRecording.findMany({ where: { sessionId: { in: sessionIds } }, orderBy: { startedAt: 'asc' } });
  return rows.map(fromRow);
}

/** The object key of one 30-second piece. */
export function chunkKey(record: RecordingRecord, index: number): string | null {
  if (!record.storagePrefix) return null;
  return `${record.storagePrefix}/${String(index).padStart(5, '0')}.${extensionFor(record.mimeType)}`;
}

/** A signed URL the phone PUTs one piece to, or null when video stays on the phone. */
export function chunkUploadUrl(record: RecordingRecord, index: number): string | null {
  const config = storageConfig();
  const key = chunkKey(record, index);
  if (!config || !key) return null;
  return uploadUrl(key, config);
}

/** The phone says a piece landed. Idempotent: a retried confirmation counts once. */
export async function markChunkUploaded(record: RecordingRecord, index: number, kilobytes: number): Promise<void> {
  if (record.chunkIndexes.includes(index)) return;
  const kb = Math.max(0, Math.min(200_000, Math.round(kilobytes)));
  if (!isDbConfigured || !prisma) {
    const target = memory.find((r) => r.id === record.id);
    if (!target) return;
    target.chunkIndexes.push(index);
    target.kilobytes += kb;
    return;
  }
  await prisma.jobRecording.update({
    where: { id: record.id },
    data: { chunkIndexes: { push: index }, kilobytes: { increment: kb } },
  });
}

export async function stopRecording(record: RecordingRecord): Promise<void> {
  if (record.endedAt) return;
  const endedAt = new Date();
  if (!isDbConfigured || !prisma) {
    const target = memory.find((r) => r.id === record.id);
    if (target) target.endedAt = endedAt.toISOString();
    return;
  }
  await prisma.jobRecording.update({ where: { id: record.id }, data: { endedAt } });
}

/**
 * Where a segment sits in the video: seconds from the recording's start.
 * Null when the segment began before the camera did.
 */
export function videoOffsetSeconds(record: Pick<RecordingRecord, 'startedAt'>, at: string): number | null {
  const offset = (new Date(at).getTime() - new Date(record.startedAt).getTime()) / 1000;
  return offset >= 0 ? Math.round(offset) : null;
}
