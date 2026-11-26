'use client';

import { pieceName, type PieceKind } from '@/lib/recording/format';
import { crc32, splitForZip, zipParts, type ZipEntry } from '@/lib/recording/zip';

/**
 * The phone's own copy of a hands-free recording, in IndexedDB.
 *
 * Every piece — a video segment or a sensor chunk — is written here first
 * and deleted only once the server has confirmed it landed in the bucket. A
 * dropped signal in a basement therefore costs a delay, never film; a page
 * that dies mid-job leaves its pieces here for the next time the timer
 * opens; and with no bucket configured at all, this is where the whole
 * recording lives until it is exported as a ZIP.
 *
 * Events are kept until the recording is forgotten, not just until they are
 * sent: an export has to describe its own interruptions without asking the
 * server.
 *
 * IndexedDB rather than memory because three hours of video is around a
 * gigabyte, which a phone's browser tab would not survive holding in RAM.
 */

const DB = 'klaudy-recordings';
const VERSION = 2;
/** v1: one recorder per recording, pieces that only played joined together. */
const LEGACY = 'chunks';
const RECORDINGS = 'recordings';
const PIECES = 'pieces';
const EVENTS = 'events';

export interface LocalRecording {
  recordingId: string;
  sessionId?: string;
  mimeType: string;
  uploads: boolean;
  t0EpochMs: number;
  startedAt: string;
  clockOffsetMs?: number;
  clockRttMs?: number;
  capture?: unknown;
  device?: unknown;
  /** Set once the server was told it ended. */
  stoppedAt?: string;
  /** Where the last piece ended, for closing it later from a recovery. */
  endMonoMs?: number;
  /**
   * Written every minute while a page is recording it. A recording with a
   * fresh heartbeat belongs to a live page — maybe another tab — and is not
   * a leftover to recover, however much of it is still on the phone.
   */
  heartbeatAt?: number;
}

/** A page that has not touched its recording in this long is gone. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;

export interface LocalPiece {
  recordingId: string;
  kind: PieceKind;
  index: number;
  mimeType: string;
  blob: Blob;
  bytes: number;
  sha256: string;
  crc32: number;
  monoStartMs: number;
  monoEndMs: number;
  samples?: number;
  streams?: string[];
  createdAt: number;
}

export interface LocalEvent {
  recordingId: string;
  seq: number;
  kind: string;
  monoMs: number;
  clientUtcMs: number;
  data?: Record<string, unknown>;
  posted: boolean;
}

interface LegacyChunk {
  recordingId: string;
  index: number;
  mimeType: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // The v1 store is left exactly as it was: what is in it is somebody's
      // film, and it can still be saved from the recovery card.
      if (!db.objectStoreNames.contains(LEGACY)) db.createObjectStore(LEGACY, { keyPath: ['recordingId', 'index'] });
      if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS, { keyPath: 'recordingId' });
      if (!db.objectStoreNames.contains(PIECES)) db.createObjectStore(PIECES, { keyPath: ['recordingId', 'kind', 'index'] });
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: ['recordingId', 'seq'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    let result: T | undefined;
    req.onsuccess = () => {
      result = req.result;
    };
    // Resolved on commit, not on success: a write that "succeeded" in a
    // transaction that then aborted (the disk filled) did not happen.
    tx.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? req.error);
    };
  });
}

const ofRecording = (id: string) => IDBKeyRange.bound([id], [id, []]);

// ── Recordings ──────────────────────────────────────────────────────────────

export async function putRecording(rec: LocalRecording): Promise<void> {
  await run(RECORDINGS, 'readwrite', (s) => s.put(rec));
}

export async function getLocalRecording(recordingId: string): Promise<LocalRecording | null> {
  return (await run<LocalRecording | undefined>(RECORDINGS, 'readonly', (s) => s.get(recordingId))) ?? null;
}

export async function updateRecording(recordingId: string, patch: Partial<LocalRecording>): Promise<void> {
  const current = await getLocalRecording(recordingId);
  if (current) await putRecording({ ...current, ...patch });
}

export async function listLocalRecordings(): Promise<LocalRecording[]> {
  return run<LocalRecording[]>(RECORDINGS, 'readonly', (s) => s.getAll() as IDBRequest<LocalRecording[]>);
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Rejects with a QuotaExceededError when the phone is full. */
export async function putPiece(piece: LocalPiece): Promise<void> {
  await run(PIECES, 'readwrite', (s) => s.put(piece));
}

export async function deletePiece(recordingId: string, kind: PieceKind, index: number): Promise<void> {
  await run(PIECES, 'readwrite', (s) => s.delete([recordingId, kind, index]));
}

/** Oldest first, both kinds interleaved: the order they were captured. */
export async function piecesOf(recordingId: string): Promise<LocalPiece[]> {
  const all = await run<LocalPiece[]>(PIECES, 'readonly', (s) => s.getAll(ofRecording(recordingId)) as IDBRequest<LocalPiece[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt || a.index - b.index);
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function putEvent(event: LocalEvent): Promise<void> {
  await run(EVENTS, 'readwrite', (s) => s.put(event));
}

export async function eventsOf(recordingId: string): Promise<LocalEvent[]> {
  const all = await run<LocalEvent[]>(EVENTS, 'readonly', (s) => s.getAll(ofRecording(recordingId)) as IDBRequest<LocalEvent[]>);
  return all.sort((a, b) => a.seq - b.seq);
}

export async function markPosted(recordingId: string, seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  const want = new Set(seqs);
  const events = (await eventsOf(recordingId)).filter((e) => want.has(e.seq) && !e.posted);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(EVENTS, 'readwrite');
    const store = tx.objectStore(EVENTS);
    for (const e of events) store.put({ ...e, posted: true });
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

/** Frees the phone: the recording, its pieces and its events. */
export async function forgetRecording(recordingId: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDINGS, PIECES, EVENTS], 'readwrite');
    tx.objectStore(RECORDINGS).delete(recordingId);
    tx.objectStore(PIECES).delete(ofRecording(recordingId));
    tx.objectStore(EVENTS).delete(ofRecording(recordingId));
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

// ── Export ──────────────────────────────────────────────────────────────────

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

const encoder = new TextEncoder();

/**
 * Saves what is on the phone as a ZIP: every segment and sensor chunk under
 * the same names they would have in the bucket, plus a manifest.json with
 * their checksums, time windows, the clock fix and every event. The archive
 * is the same dataset unit an upload would have produced — the pipeline can
 * ingest either.
 *
 * Returns how many pieces were saved (0 = nothing left on the phone).
 */
export async function exportRecording(recordingId: string, filename: string): Promise<number> {
  const [rec, pieces, events] = await Promise.all([getLocalRecording(recordingId), piecesOf(recordingId), eventsOf(recordingId)]);
  if (pieces.length === 0) return 0;
  const groups = splitForZip(pieces.map((p) => ({ piece: p, size: p.bytes })));
  groups.forEach((group, i) => {
    const manifest = {
      format: 'klaudy-recording/1',
      recordingId,
      sessionId: rec?.sessionId,
      mimeType: rec?.mimeType ?? pieces[0].mimeType,
      startedAt: rec?.startedAt,
      t0EpochMs: rec?.t0EpochMs,
      clockOffsetMs: rec?.clockOffsetMs,
      clockRttMs: rec?.clockRttMs,
      capture: rec?.capture,
      device: rec?.device,
      part: { number: i + 1, of: groups.length },
      pieces: group.map(({ piece: p }) => ({
        file: pieceName(p.kind, p.index, p.mimeType),
        kind: p.kind,
        index: p.index,
        bytes: p.bytes,
        sha256: p.sha256,
        monoStartMs: p.monoStartMs,
        monoEndMs: p.monoEndMs,
        samples: p.samples,
        streams: p.streams,
      })),
      events: events.map(({ seq, kind, monoMs, clientUtcMs, data }) => ({ seq, kind, monoMs, clientUtcMs, data })),
    };
    const json = encoder.encode(JSON.stringify(manifest, null, 2));
    const entries: ZipEntry[] = [
      { name: 'manifest.json', size: json.length, crc32: crc32(json), data: json, modified: new Date() },
      ...group.map(({ piece: p }) => ({
        name: pieceName(p.kind, p.index, p.mimeType),
        size: p.bytes,
        crc32: p.crc32,
        data: p.blob,
        modified: new Date(p.createdAt),
      })),
    ];
    const { parts } = zipParts(entries);
    const suffix = groups.length > 1 ? `-parte-${i + 1}` : '';
    save(new Blob(parts as BlobPart[], { type: 'application/zip' }), `${filename}${suffix}.zip`);
  });
  return pieces.length;
}

// ── Legacy (v1) ─────────────────────────────────────────────────────────────

/** Recordings left in the v1 store, with how many pieces each. */
export async function legacyRecordings(): Promise<{ recordingId: string; pieces: number; bytes: number }[]> {
  const all = await run<LegacyChunk[]>(LEGACY, 'readonly', (s) => s.getAll() as IDBRequest<LegacyChunk[]>).catch(() => []);
  const by = new Map<string, { recordingId: string; pieces: number; bytes: number }>();
  for (const c of all) {
    const entry = by.get(c.recordingId) ?? { recordingId: c.recordingId, pieces: 0, bytes: 0 };
    entry.pieces += 1;
    entry.bytes += c.blob.size;
    by.set(c.recordingId, entry);
  }
  return [...by.values()];
}

/** v1 pieces came from one recorder, so joined in order they still play. */
export async function exportLegacy(recordingId: string, filename: string): Promise<number> {
  const all = await run<LegacyChunk[]>(LEGACY, 'readonly', (s) => s.getAll(ofRecording(recordingId)) as IDBRequest<LegacyChunk[]>);
  if (all.length === 0) return 0;
  all.sort((a, b) => a.index - b.index);
  const type = all[0].mimeType;
  save(new Blob(all.map((c) => c.blob), { type }), `${filename}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  return all.length;
}

export async function forgetLegacy(recordingId: string): Promise<void> {
  await run(LEGACY, 'readwrite', (s) => s.delete(ofRecording(recordingId)));
}
