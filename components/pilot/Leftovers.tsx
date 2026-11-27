'use client';

import { useEffect, useState } from 'react';
import { ACTIVE_RECORDINGS, postEvents, post, uploadPieces } from './capture';
import {
  HEARTBEAT_STALE_MS,
  eventsOf,
  exportLegacy,
  exportRecording,
  forgetLegacy,
  forgetRecording,
  legacyRecordings,
  listLocalRecordings,
  markPosted,
  piecesOf,
  putEvent,
  updateRecording,
  type LocalEvent,
  type LocalRecording,
} from './recordingStore';

/**
 * Video a closed page left on the phone.
 *
 * A browser tab can die mid-job — the battery, an incoming call, the OS
 * reclaiming memory — and whatever it had written to the phone is still
 * there. When the timer opens again, this uploads it, sends the log it
 * kept, and closes the recording where its last piece ended (not "now").
 * Only what cannot be uploaded is shown, with a way to save it as a file.
 */

interface Item {
  recordingId: string;
  pieces: number;
  bytes: number;
  uploads: boolean;
  legacy?: boolean;
  saved?: boolean;
}

// One scan at a time, even if the card is mounted twice in a row.
let scanning: Promise<Item[]> | null = null;

async function recover(rec: LocalRecording): Promise<Item | null> {
  let uploaded = 0;
  let refused = false;
  if (rec.uploads) {
    const result = await uploadPieces(rec.recordingId);
    uploaded = result.uploaded;
    refused = result.refused;
  }
  const events: LocalEvent[] = await eventsOf(rec.recordingId).catch(() => []);
  if (uploaded > 0) {
    // Said in the log itself, so the pipeline knows these arrived late.
    const seq = (events[events.length - 1]?.seq ?? 0) + 1;
    const note: LocalEvent = {
      recordingId: rec.recordingId,
      seq,
      kind: 'recovered',
      monoMs: rec.endMonoMs ?? 0,
      clientUtcMs: Date.now(),
      data: { uploaded },
      posted: false,
    };
    await putEvent(note).catch(() => {});
    events.push(note);
  }
  const unsent = events.filter((e) => !e.posted);
  if (unsent.length > 0 && !refused && (await postEvents(rec.recordingId, unsent))) {
    await markPosted(rec.recordingId, unsent.map((e) => e.seq)).catch(() => {});
  }

  const left = await piecesOf(rec.recordingId).catch(() => []);
  if (!rec.stoppedAt && !refused && (left.length === 0 || !rec.uploads)) {
    const ok = await post({ action: 'stop', recordingId: rec.recordingId, ...(rec.endMonoMs ? { endMonoMs: rec.endMonoMs } : {}) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      rec.stoppedAt = new Date().toISOString();
      await updateRecording(rec.recordingId, { stoppedAt: rec.stoppedAt }).catch(() => {});
    }
  }

  const allSent = (await eventsOf(rec.recordingId).catch(() => [])).every((e) => e.posted);
  if (left.length === 0) {
    if (rec.uploads && rec.stoppedAt && allSent) await forgetRecording(rec.recordingId).catch(() => {});
    return null;
  }
  return { recordingId: rec.recordingId, pieces: left.length, bytes: left.reduce((n, p) => n + p.bytes, 0), uploads: rec.uploads && !refused };
}

async function scan(): Promise<Item[]> {
  const [recordings, legacy] = await Promise.all([
    listLocalRecordings().catch(() => [] as LocalRecording[]),
    legacyRecordings().catch(() => []),
  ]);
  const items: Item[] = [];
  for (const rec of recordings) {
    // Still being filmed, here or in another tab: not a leftover.
    if (ACTIVE_RECORDINGS.has(rec.recordingId)) continue;
    if (!rec.stoppedAt && rec.heartbeatAt && Date.now() - rec.heartbeatAt < HEARTBEAT_STALE_MS) continue;
    const item = await recover(rec).catch(() => null);
    if (item) items.push(item);
  }
  for (const l of legacy) items.push({ recordingId: l.recordingId, pieces: l.pieces, bytes: l.bytes, uploads: false, legacy: true });
  return items;
}

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export function Leftovers({ scanKey = 0 }: { scanKey?: number }) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let cancelled = false;
    scanning ??= scan().finally(() => {
      scanning = null;
    });
    void scanning.then((found) => !cancelled && setItems(found));
    return () => {
      cancelled = true;
    };
  }, [scanKey]);

  if (items.length === 0) return null;
  const update = (id: string, patch: Partial<Item> | null) =>
    setItems((all) => (patch ? all.map((i) => (i.recordingId === id ? { ...i, ...patch } : i)) : all.filter((i) => i.recordingId !== id)));

  return (
    <div className="space-y-3" data-testid="leftovers">
      {items.map((item) => (
        <div key={item.recordingId} className="rounded-2xl border-2 border-amber-300 p-4 text-sm dark:border-amber-900/60">
          <p className="font-medium">Quedó video de un trabajo anterior en este teléfono</p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            {item.pieces} {item.pieces === 1 ? 'parte' : 'partes'} · {mb(item.bytes)}
            {item.uploads ? '. Se sube sola cuando haya señal.' : '.'}
          </p>
          <button
            type="button"
            onClick={async () => {
              const name = `trabajo-${item.recordingId.slice(-6)}`;
              const n = item.legacy ? await exportLegacy(item.recordingId, name) : await exportRecording(item.recordingId, name);
              update(item.recordingId, n ? { saved: true } : null);
            }}
            className="mt-3 min-h-[48px] w-full rounded-xl border-2 font-semibold dark:border-white/20"
          >
            Guardar en el teléfono
          </button>
          {item.saved && (
            <button
              type="button"
              onClick={async () => {
                if (item.legacy) await forgetLegacy(item.recordingId);
                else await forgetRecording(item.recordingId);
                update(item.recordingId, null);
              }}
              className="mt-1 min-h-[40px] w-full text-xs text-slate-500 underline"
            >
              Ya lo tengo a salvo: liberar espacio
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
