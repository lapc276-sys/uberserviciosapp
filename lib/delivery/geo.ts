import type { LatLng, TravelMode } from './types';
import { clamp } from './stats';

/**
 * Travel time, deliberately computed in-process.
 *
 * A routing API is more accurate for a single leg, but the engine evaluates
 * hundreds of hypotheticals per dispatch (every courier × every batching
 * permutation). Paying a network round trip for each is neither fast nor
 * affordable, and a routing API still cannot tell you about the elevator.
 *
 * So: a geometric model with city-calibrated speeds and a traffic curve, and a
 * `paceFactor` per courier that absorbs the residual. When a leg matters
 * enough to be exact (the committed route shown to the courier), a routing
 * provider can be layered on top — `estimateTravelMinutes` is the only place
 * that would need to change.
 */

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line distance is not street distance. On a grid the detour factor
 * is ~1.27; this is the single constant most worth calibrating per city, since
 * a waterfront or a highway with few crossings pushes it much higher.
 */
export const ROUTE_FACTOR = 1.28;

export function routeMiles(a: LatLng, b: LatLng): number {
  return haversineMiles(a, b) * ROUTE_FACTOR;
}

/**
 * Door-to-door average speeds in mph — *including* lights, turns and stops,
 * which is why they look slow next to a vehicle's cruising speed. A car is
 * only marginally faster than a scooter in dense city delivery, and that
 * surprises people until they measure it.
 */
export const MODE_SPEED_MPH: Record<TravelMode, number> = {
  walk: 2.8,
  bike: 8.5,
  ebike: 11,
  scooter: 13,
  car: 15,
};

/**
 * Traffic multiplier on travel time by local hour, 0–23. >1 = slower.
 * Cars feel this; bikes barely do (see MODE_TRAFFIC_SENSITIVITY).
 */
export const TRAFFIC_BY_HOUR: number[] = [
  0.85, 0.85, 0.85, 0.85, 0.88, 0.92, // 00–05
  0.98, 1.12, 1.26, 1.16, 1.02, 1.0, // 06–11
  1.1, 1.05, 1.0, 1.06, 1.18, 1.32, // 12–17
  1.3, 1.16, 1.04, 0.96, 0.9, 0.86, // 18–23
];

/** How much each mode actually suffers from traffic. A bike filters through. */
export const MODE_TRAFFIC_SENSITIVITY: Record<TravelMode, number> = {
  walk: 0,
  bike: 0.15,
  ebike: 0.2,
  scooter: 0.45,
  car: 1,
};

export interface TravelOptions {
  /** Local hour 0–23. Defaults to now. */
  hour?: number;
  /** Courier's personal pace multiplier (0.9 = 10% faster than the model). */
  paceFactor?: number;
}

/**
 * Minutes to get from `a` to `b`. Never returns 0 for a real move — even a
 * next-door leg costs the seconds of mounting up and starting.
 */
export function estimateTravelMinutes(
  a: LatLng,
  b: LatLng,
  mode: TravelMode,
  opts: TravelOptions = {},
): number {
  const miles = routeMiles(a, b);
  if (miles < 0.005) return 0;

  const hour = opts.hour ?? new Date().getHours();
  const traffic = TRAFFIC_BY_HOUR[clamp(Math.floor(hour), 0, 23)] ?? 1;
  const sensitivity = MODE_TRAFFIC_SENSITIVITY[mode];
  const trafficFactor = 1 + (traffic - 1) * sensitivity;

  const minutes = (miles / MODE_SPEED_MPH[mode]) * 60 * trafficFactor;
  // Fixed overhead per leg: unlocking, mounting, pulling out.
  const startup = mode === 'walk' ? 0.15 : 0.5;
  return (minutes + startup) * (opts.paceFactor ?? 1);
}

/** Compass bearing a→b in degrees, 0 = north. */
export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Smallest angle between two bearings, 0–180. 0 = same way, 180 = opposite. */
export function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Do two drops from the same merchant point the same way? This is the cheap
 * test that kills most bad batches before any route math runs.
 */
export function directionAlignment(origin: LatLng, dropA: LatLng, dropB: LatLng): number {
  return bearingDelta(bearing(origin, dropA), bearing(origin, dropB));
}

export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}
