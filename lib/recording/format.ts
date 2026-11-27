/**
 * The formats of the raw layer, as the phone writes them and the pipeline
 * reads them back (pipeline/klaudy_pipeline/formats.py). Free of the DOM, so
 * the arithmetic is tested in Node.
 *
 * TIME. Every phone-side time is milliseconds on the phone's MONOTONIC clock
 * (performance.now()), counted from the recording's t0. Monotonic because the
 * wall clock can jump in the middle of a job — a network time correction, a
 * person fixing the hour — and a jump would tear one job into two timelines.
 * One number on the recording turns any of them into server time:
 *
 *   server time = t0EpochMs + monoMs + clockOffsetMs
 *
 * and JobRecording.startedAt is exactly t0EpochMs + clockOffsetMs, so "this
 * room started 14 min 3 s into the video" is one subtraction against the
 * server's own timestamps for the room.
 */

export type PieceKind = 'video' | 'sensors';

// ── Clock ───────────────────────────────────────────────────────────────────

export interface ClockSample {
  /** Phone monotonic epoch (timeOrigin + performance.now()) when the request left. */
  sentMs: number;
  /** …and when the answer came back. */
  receivedMs: number;
  /** The server's Date.now() inside the answer. */
  serverMs: number;
}

export interface ClockFix {
  /** Server minus phone. */
  offsetMs: number;
  /** The round trip it came from: the offset is good to about half of it. */
  rttMs: number;
}

/** A round trip slower than this says more about the network than the clock. */
export const MAX_CLOCK_RTT_MS = 5000;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The best of several round trips. The server's answer was written somewhere
 * inside the round trip; assuming the middle is wrong by at most half of it,
 * so the shortest trip is the one with the least room for error.
 */
export function bestOffset(samples: ClockSample[], maxRttMs = MAX_CLOCK_RTT_MS): ClockFix | null {
  let best: ClockFix | null = null;
  for (const s of samples) {
    const rtt = s.receivedMs - s.sentMs;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > maxRttMs || !Number.isFinite(s.serverMs)) continue;
    if (best && rtt >= best.rttMs) continue;
    best = { offsetMs: round1(s.serverMs - (s.sentMs + s.receivedMs) / 2), rttMs: round1(rtt) };
  }
  return best;
}

/**
 * The recording's t0 on the server clock — what JobRecording.startedAt
 * stores. The phone takes t0 just before it asks to start, so on the server
 * it can only be slightly in the past; anything else means the clock fix is
 * wrong, and the server's own "now" is used instead and the fix is reported
 * as untrusted.
 */
export function recordingStart(
  t0EpochMs: number | undefined,
  fix: Partial<ClockFix> | undefined,
  serverNow: number,
): { at: number; trusted: boolean } {
  if (t0EpochMs === undefined || fix?.offsetMs === undefined || fix.rttMs === undefined) return { at: serverNow, trusted: false };
  if (fix.rttMs > MAX_CLOCK_RTT_MS) return { at: serverNow, trusted: false };
  const at = t0EpochMs + fix.offsetMs;
  if (!Number.isFinite(at) || at > serverNow + 1000 || at < serverNow - 120_000) return { at: serverNow, trusted: false };
  return { at: Math.round(at), trusted: true };
}

/** Where a phone-side moment lands on the server clock. */
export function serverTimeOf(monoMs: number, recording: { startedAt: string | Date }): number {
  return new Date(recording.startedAt).getTime() + monoMs;
}

// ── Sensors: one JSON object per line ───────────────────────────────────────

type Vec = { x?: number | null; y?: number | null; z?: number | null } | null | undefined;
type Rot = { alpha?: number | null; beta?: number | null; gamma?: number | null } | null | undefined;

function r4(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
}

const vec = (v: Vec) => (v ? [r4(v.x), r4(v.y), r4(v.z)] : null);
const rot = (v: Rot) => (v ? [r4(v.alpha), r4(v.beta), r4(v.gamma)] : null);

/**
 * One accelerometer + gyroscope sample:
 *   {"t":1234.5,"s":"motion","a":[x,y,z],"g":[x,y,z],"r":[α,β,γ],"i":16}
 * t: monotonic ms from t0 · a: m/s² without gravity · g: m/s² with gravity ·
 * r: rotation rate in °/s · i: the sampling interval the phone reported.
 * A null is something this phone does not measure, never a zero.
 */
export function motionLine(
  t: number,
  e: { acceleration?: Vec; accelerationIncludingGravity?: Vec; rotationRate?: Rot; interval?: number | null },
): string {
  return JSON.stringify({
    t: round1(t),
    s: 'motion',
    a: vec(e.acceleration),
    g: vec(e.accelerationIncludingGravity),
    r: rot(e.rotationRate),
    i: r4(e.interval),
  });
}

/**
 * One orientation sample: {"t":1234.5,"s":"orientation","o":[α,β,γ],"abs":false}
 * in degrees; abs = measured against the Earth rather than the start pose.
 */
export function orientationLine(
  t: number,
  e: { alpha?: number | null; beta?: number | null; gamma?: number | null; absolute?: boolean },
): string {
  return JSON.stringify({ t: round1(t), s: 'orientation', o: [r4(e.alpha), r4(e.beta), r4(e.gamma)], abs: Boolean(e.absolute) });
}

// ── Names ───────────────────────────────────────────────────────────────────

/** The same name in the bucket, under the recording's prefix, and inside an export. */
export function pieceName(kind: PieceKind, index: number, mimeType: string): string {
  const n = String(index).padStart(5, '0');
  return kind === 'video' ? `video/${n}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}` : `sensors/${n}.jsonl.gz`;
}

/** What an event may be called: short, lowercase, no free text. */
export const EVENT_KIND = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * What the phone reports, for the documentation (docs/DATOS.md). The API
 * accepts any name of the shape above, so a new kind needs no deploy — but
 * the pipeline only interprets the ones it knows.
 */
export const EVENT_KINDS = [
  'recorder_started', // a new segment began
  'recorder_error',
  'camera_ended', // the OS or another app took the camera
  'camera_muted',
  'camera_unmuted',
  'privacy_pause', // the cleaner paused the camera on purpose
  'privacy_resume',
  'hidden', // the screen was turned off or another app came in front
  'visible',
  'frozen', // the browser froze the page to save battery
  'resumed',
  'pagehide', // the page is closing; sent with sendBeacon
  'offline',
  'online',
  'wake_lock_lost',
  'storage_full', // the phone ran out of space: the camera stopped
  'telemetry', // battery, storage, network, track settings, pending pieces
  'pressure', // CPU pressure changed — the closest the web gets to heat
  'clock_sync', // a fresh offset, to correct drift over a long job
  'voice_marker', // a spoken command, with its transcript
  'sensors_unavailable',
  'recovered', // pieces left by a closed page were uploaded later
] as const;

/** Bytes of the JSON the API accepts per event and per capture/device block. */
export const MAX_EVENT_DATA = 2000;
export const MAX_META_JSON = 4000;
