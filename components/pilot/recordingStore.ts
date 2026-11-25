'use client';

/**
 * The phone's own copy of a hands-free recording, in IndexedDB.
 *
 * Every 30-second piece is written here first and deleted only once the
 * bucket has confirmed it. A dropped signal in a basement therefore costs a
 * delay, never film; and with no bucket configured at all, this is where the
 * whole video lives until it is saved to the phone at the end.
 *
 * IndexedDB rather than memory because three hours of video is around a
 * gigabyte, which a phone's browser tab would not survive holding in RAM.
 */

const DB = 'klaudy-recordings';
const STORE = 'chunks';

interface StoredChunk {
  recordingId: string;
  index: number;
  mimeType: string;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: ['recordingId', 'index'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putChunk(chunk: StoredChunk): Promise<void> {
  await run('readwrite', (s) => s.put(chunk));
}

export async function deleteChunk(recordingId: string, index: number): Promise<void> {
  await run('readwrite', (s) => s.delete([recordingId, index]));
}

export async function chunksOf(recordingId: string): Promise<StoredChunk[]> {
  const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
  const all = await run<StoredChunk[]>('readonly', (s) => s.getAll(range) as IDBRequest<StoredChunk[]>);
  return all.sort((a, b) => a.index - b.index);
}

/**
 * Saves what is still on the phone as one file. Pieces from one recorder
 * concatenate into a playable video, which is why they are kept in order and
 * from a single recorder per recording.
 */
export async function downloadRecording(recordingId: string, filename: string): Promise<number> {
  const chunks = await chunksOf(recordingId);
  if (chunks.length === 0) return 0;
  const type = chunks[0].mimeType;
  const blob = new Blob(
    chunks.map((c) => c.blob),
    { type },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return chunks.length;
}

/** Frees the phone once the video has been saved somewhere else. */
export async function forgetRecording(recordingId: string): Promise<void> {
  const chunks = await chunksOf(recordingId);
  for (const c of chunks) await deleteChunk(recordingId, c.index);
}
