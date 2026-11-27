'use client';

import { bestOffset, motionLine, orientationLine, type ClockFix, type ClockSample } from '@/lib/recording/format';
import { crc32 } from '@/lib/recording/zip';
import { deletePiece, markPosted, piecesOf, putEvent, type LocalEvent, type LocalPiece } from './recordingStore';

/**
 * The phone's half of the raw layer: independent video segments, sensor
 * chunks, a clock fix, and a log of everything that interrupted them.
 *
 * Nothing here decides anything about the work. It records what the camera
 * and the sensors delivered, with enough bookkeeping — checksums, monotonic
 * time windows, sequence numbers — that months later anyone can tell exactly
 * what was captured, what was lost, and why.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

export const post = (body: Record<string, unknown>) =>
  fetch('/api/recordings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Recordings this page is filming right now. The recovery card skips them:
 * uploading a live recording's pieces from two places, or closing it as a
 * leftover, would be the recovery code damaging the recording it exists to
 * protect. Other tabs are told apart by the heartbeat (recordingStore.ts).
 */
export const ACTIVE_RECORDINGS = new Set<string>();

// ── Clock ───────────────────────────────────────────────────────────────────

/** The phone's monotonic clock as an epoch. Unlike Date.now(), it never jumps. */
export function monoEpoch(): number {
  return performance.timeOrigin + performance.now();
}

/** A handful of round trips to the server; the fastest one is kept. */
export async function syncClock(rounds = 5): Promise<ClockFix | null> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < rounds; i++) {
    try {
      const sentMs = monoEpoch();
      const res = await fetch('/api/recordings?clock=1', { cache: 'no-store' });
      const receivedMs = monoEpoch();
      if (!res.ok) continue;
      const { serverNow } = (await res.json()) as { serverNow: number };
      samples.push({ sentMs, receivedMs, serverMs: serverNow });
    } catch {
      // Offline: fewer samples, or none, and the recording says so.
    }
  }
  return bestOffset(samples);
}

/** Event timestamps are high-resolution on current browsers; a few old ones still give epoch ms. */
function eventMono(timeStamp: number): number {
  return timeStamp > 1e12 ? timeStamp - performance.timeOrigin : timeStamp;
}

// ── Checksums ───────────────────────────────────────────────────────────────

/** SHA-256 for the pipeline to check the bucket against; CRC-32 for a ZIP export. One read for both. */
export async function digest(blob: Blob): Promise<{ bytes: number; sha256: string; crc32: number }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return { bytes: bytes.length, sha256: hex, crc32: crc32(bytes) };
}

// ── Video ───────────────────────────────────────────────────────────────────

export interface CapturedSegment {
  index: number;
  blob: Blob;
  monoStartMs: number;
  monoEndMs: number;
}

/** How long two recorders run at once at each cut, so no frame falls between segments. */
const OVERLAP_MS = 300;

interface Live {
  recorder: MediaRecorder;
  index: number;
  startMs: number;
  endMs: number | null;
  parts: Blob[];
}

/**
 * Independent segments: every N seconds a NEW MediaRecorder starts on the
 * same camera stream, and the previous one stops a moment later. Each
 * segment is a complete file with its own header — it plays, uploads and is
 * processed on its own, and losing one loses thirty seconds, not everything
 * after it.
 *
 * That is the difference from MediaRecorder's own timeslice, which the first
 * version used: its pieces are fragments of ONE file and only the first
 * carries the header, so piece 7 alone is unreadable and a gap in the middle
 * spoils the rest.
 *
 * The overlap means neighbouring segments share a few hundred milliseconds.
 * Each one's monotonic window is recorded, so the overlap is known, not
 * guessed, and nothing falls in a crack between two files.
 */
export class SegmentRecorder {
  private live: Live | null = null;
  private closing: Promise<void>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private next: number;

  constructor(
    private readonly stream: MediaStream,
    private readonly opts: {
      mimeType: string;
      videoBitsPerSecond: number;
      segmentMs: number;
      /** performance.now() at the recording's t0. */
      t0: number;
      onSegment: (segment: CapturedSegment) => void;
      onError: (error: string) => void;
    },
  ) {
    this.next = 1;
  }

  get running(): boolean {
    return this.live !== null;
  }

  start(): void {
    if (this.live) return;
    this.live = this.open();
    this.schedule();
  }

  private now(): number {
    return performance.now() - this.opts.t0;
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.rotate(), this.opts.segmentMs);
  }

  private open(): Live {
    const recorder = new MediaRecorder(this.stream, {
      mimeType: this.opts.mimeType,
      videoBitsPerSecond: this.opts.videoBitsPerSecond,
    });
    const live: Live = { recorder, index: this.next++, startMs: this.now(), endMs: null, parts: [] };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) live.parts.push(e.data);
    };
    recorder.onstart = () => {
      live.startMs = this.now();
    };
    recorder.onerror = (e) => {
      const name = (e as unknown as { error?: { name?: string } }).error?.name;
      this.opts.onError(name ?? 'recorder_error');
    };
    recorder.start();
    return live;
  }

  /** Stops one recorder; resolves once its file has been handed over. */
  private close(live: Live): Promise<void> {
    return new Promise((resolve) => {
      const hand = () => {
        if (live.parts.length > 0) {
          this.opts.onSegment({
            index: live.index,
            blob: new Blob(live.parts, { type: this.opts.mimeType.split(';')[0] }),
            monoStartMs: round1(live.startMs),
            monoEndMs: round1(live.endMs ?? this.now()),
          });
        }
        resolve();
      };
      if (live.recorder.state === 'inactive') return hand();
      // The last data arrives in a final dataavailable, before 'stop'.
      live.recorder.addEventListener('stop', hand, { once: true });
      live.endMs = this.now();
      try {
        live.recorder.stop();
      } catch {
        hand();
      }
    });
  }

  private track(p: Promise<void>): void {
    this.closing.push(p);
    void p.finally(() => {
      this.closing = this.closing.filter((x) => x !== p);
    });
  }

  private rotate(): void {
    const previous = this.live;
    if (!previous) return;
    try {
      this.live = this.open();
    } catch {
      // Could not start the next one: keep the current one running rather
      // than lose the camera, and try again at the next cut.
      this.opts.onError('rotate_failed');
      this.schedule();
      return;
    }
    this.track(new Promise<void>((r) => setTimeout(r, OVERLAP_MS)).then(() => this.close(previous)));
    this.schedule();
  }

  /** Ends the current segment — for a privacy pause, or the end of the job. */
  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const live = this.live;
    this.live = null;
    if (live) this.track(this.close(live));
    await Promise.all(this.closing);
  }
}

// ── Sensors ─────────────────────────────────────────────────────────────────

export interface CapturedSensors {
  index: number;
  blob: Blob;
  samples: number;
  streams: string[];
  monoStartMs: number;
  monoEndMs: number;
}

let sensorPermission: 'granted' | 'denied' | 'unknown' = 'unknown';

/** iPhone asks for motion permission, and only inside a tap: call this from one. */
export function unlockSensors(): void {
  const g = globalThis as unknown as {
    DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
    DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
  };
  if (typeof g.DeviceMotionEvent?.requestPermission !== 'function') {
    sensorPermission = 'granted';
    return;
  }
  g.DeviceMotionEvent.requestPermission()
    .then((r) => {
      sensorPermission = r === 'granted' ? 'granted' : 'denied';
    })
    .catch(() => {
      sensorPermission = 'denied';
    });
  g.DeviceOrientationEvent?.requestPermission?.().catch(() => {});
}

/** Why the sensors are not being recorded, or null when they can be. */
export function sensorsUnavailable(): string | null {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'no_sensors';
  if (typeof CompressionStream === 'undefined') return 'no_compression';
  if (sensorPermission === 'denied') return 'permission_denied';
  return null;
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const out = await new Response(stream).blob();
  return new Blob([out], { type: 'application/gzip' });
}

/**
 * Accelerometer, gyroscope and orientation at whatever rate the phone gives
 * them (about 60 Hz on Android), written as JSONL and gzipped every N
 * seconds. Its own timer, not the video's: the sensors keep running through
 * a privacy pause, and they line up with the video by time.
 */
export class SensorRecorder {
  private lines: string[] = [];
  private streams = new Set<string>();
  private startMs = 0;
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cutting: Promise<void> = Promise.resolve();

  private readonly onMotion = (e: DeviceMotionEvent) => {
    this.lines.push(motionLine(eventMono(e.timeStamp) - this.t0, e));
    this.streams.add('motion');
  };

  private readonly onOrientation = (e: DeviceOrientationEvent) => {
    // A desktop fires one empty event and then nothing.
    if (e.alpha === null && e.beta === null && e.gamma === null) return;
    this.lines.push(orientationLine(eventMono(e.timeStamp) - this.t0, e));
    this.streams.add('orientation');
  };

  constructor(
    private readonly t0: number,
    private readonly chunkMs: number,
    private readonly onChunk: (chunk: CapturedSensors) => void,
  ) {}

  start(): void {
    this.startMs = performance.now() - this.t0;
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrientation);
    this.timer = setInterval(() => {
      this.cutting = this.cutting.then(() => this.cut());
    }, this.chunkMs);
  }

  private async cut(): Promise<void> {
    const end = performance.now() - this.t0;
    const lines = this.lines;
    const streams = [...this.streams];
    const start = this.startMs;
    this.lines = [];
    this.streams = new Set();
    this.startMs = end;
    if (lines.length === 0) return;
    const blob = await gzip(`${lines.join('\n')}\n`);
    this.onChunk({ index: ++this.index, blob, samples: lines.length, streams, monoStartMs: round1(start), monoEndMs: round1(end) });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.cutting = this.cutting.then(() => this.cut());
    await this.cutting;
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

function wire(e: LocalEvent) {
  return { seq: e.seq, kind: e.kind, monoMs: e.monoMs, clientUtcMs: e.clientUtcMs, data: e.data };
}

export async function postEvents(recordingId: string, events: LocalEvent[]): Promise<boolean> {
  try {
    for (let i = 0; i < events.length; i += 200) {
      const res = await post({ action: 'events', recordingId, events: events.slice(i, i + 200).map(wire) });
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The recording's diary. Every event is written to the phone first and sent
 * in small batches; the server keeps one copy per sequence number, so
 * sending one twice is harmless — which is what lets a closing page beacon
 * whatever is left without knowing whether it arrived.
 */
export class EventLog {
  private seq = 0;
  private unsent: LocalEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<boolean> | null = null;

  constructor(
    private readonly recordingId: string,
    private readonly t0: number,
  ) {}

  add(kind: string, data?: Record<string, unknown>): void {
    const event: LocalEvent = {
      recordingId: this.recordingId,
      seq: ++this.seq,
      kind,
      monoMs: round1(performance.now() - this.t0),
      clientUtcMs: Date.now(),
      data,
      posted: false,
    };
    this.unsent.push(event);
    void putEvent(event).catch(() => {});
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 5000);
  }

  flush(): Promise<boolean> {
    if (this.sending) return this.sending;
    // Nothing to send is not a send in progress: returning early here keeps
    // a finished, empty flush from being mistaken for a running one forever.
    if (this.unsent.length === 0) return Promise.resolve(true);
    const send = async () => {
      while (this.unsent.length > 0) {
        const batch = this.unsent.slice(0, 200);
        if (!(await postEvents(this.recordingId, batch))) return false;
        this.unsent.splice(0, batch.length);
        await markPosted(this.recordingId, batch.map((e) => e.seq)).catch(() => {});
      }
      return true;
    };
    this.sending = send().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  /** Test hook: how many events are waiting to be sent. */
  get pending(): number {
    return this.unsent.length;
  }

  /** The page is closing: the browser sends this after the page is gone. */
  beacon(): void {
    if (this.unsent.length === 0 || typeof navigator.sendBeacon !== 'function') return;
    // A string goes as text/plain, which every browser lets a beacon carry;
    // the route parses the body as JSON either way. Not marked as sent: a
    // beacon is a hope, not a receipt — recovery sends them again.
    navigator.sendBeacon(
      '/api/recordings',
      JSON.stringify({ action: 'events', recordingId: this.recordingId, events: this.unsent.slice(0, 200).map(wire) }),
    );
  }
}

// ── Uploads ─────────────────────────────────────────────────────────────────

export interface FlushResult {
  uploaded: number;
  left: number;
  /** The server will not take them at all: uploads are off, or it no longer knows the recording. */
  refused: boolean;
}

/**
 * Uploads every piece still on the phone, oldest first, and deletes each one
 * only after the server has written down its receipt. Stops at the first
 * failure — no signal — and leaves the rest for the next try.
 */
export async function uploadPieces(recordingId: string, onUploaded?: () => void): Promise<FlushResult> {
  const pieces = await piecesOf(recordingId).catch(() => [] as LocalPiece[]);
  let uploaded = 0;
  for (const p of pieces) {
    try {
      const signed = await post({ action: 'piece-url', recordingId, kind: p.kind, index: p.index });
      if (signed.status === 404 || signed.status === 409) return { uploaded, left: pieces.length - uploaded, refused: true };
      if (!signed.ok) break;
      const { url, contentType } = (await signed.json()) as { url: string; contentType: string };
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: p.blob });
      if (!put.ok) break;
      const confirmed = await post({
        action: 'uploaded',
        recordingId,
        kind: p.kind,
        index: p.index,
        bytes: p.bytes,
        sha256: p.sha256,
        monoStartMs: p.monoStartMs,
        monoEndMs: p.monoEndMs,
        ...(p.kind === 'sensors' ? { samples: p.samples, streams: p.streams } : {}),
      });
      if (!confirmed.ok) break;
      await deletePiece(recordingId, p.kind, p.index);
      uploaded += 1;
      onUploaded?.();
    } catch {
      break; // No signal: the piece waits on the phone for the next try.
    }
  }
  return { uploaded, left: pieces.length - uploaded, refused: false };
}

// ── What the phone is, and how it is doing ──────────────────────────────────

type Nav = Navigator & {
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
  connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
  deviceMemory?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
};

/** The phone, without anything that identifies its owner. */
export function deviceInfo(): Record<string, unknown> {
  const nav = navigator as Nav;
  return {
    userAgent: nav.userAgent.slice(0, 300),
    platform: nav.userAgentData?.platform ?? null,
    mobile: nav.userAgentData?.mobile ?? null,
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
    timeOrigin: performance.timeOrigin,
  };
}

/** A snapshot for the log, every minute: what drains, what fills, what drops. */
export async function telemetry(track: MediaStreamTrack | null, pending: number): Promise<Record<string, unknown>> {
  const nav = navigator as Nav;
  const [battery, storage] = await Promise.all([
    nav.getBattery ? nav.getBattery().catch(() => null) : Promise.resolve(null),
    navigator.storage?.estimate ? navigator.storage.estimate().catch(() => null) : Promise.resolve(null),
  ]);
  const settings = track?.getSettings();
  return {
    battery: battery ? { level: battery.level, charging: battery.charging } : null,
    storage: storage ? { usage: storage.usage ?? null, quota: storage.quota ?? null } : null,
    network: nav.connection
      ? { type: nav.connection.effectiveType ?? null, downlink: nav.connection.downlink ?? null, saveData: nav.connection.saveData ?? null }
      : null,
    online: navigator.onLine,
    track: track
      ? { width: settings?.width ?? null, height: settings?.height ?? null, frameRate: settings?.frameRate ?? null, state: track.readyState, muted: track.muted }
      : null,
    pending,
  };
}

/**
 * CPU pressure, where the browser offers it (Chrome): the nearest the web
 * gets to "the phone is overheating". A phone strapped to a head for three
 * hours in a hot kitchen will throttle, and a dropped frame rate in the
 * video should be explainable afterwards.
 */
export function watchPressure(onChange: (state: string) => void): () => void {
  const PO = (globalThis as unknown as {
    PressureObserver?: new (cb: (records: { state: string }[]) => void) => {
      observe: (source: string, options?: { sampleInterval?: number }) => Promise<void>;
      disconnect: () => void;
    };
  }).PressureObserver;
  if (!PO) return () => {};
  let last = '';
  try {
    const observer = new PO((records) => {
      const state = records[records.length - 1]?.state;
      if (state && state !== last) {
        last = state;
        onChange(state);
      }
    });
    void observer.observe('cpu', { sampleInterval: 5000 }).catch(() => {});
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}

export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
