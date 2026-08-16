/**
 * Fixed-window rate limiting, in memory.
 *
 * This exists to protect the public quoting pages: they take no API key by
 * design, so the only thing standing between a tenant's monthly quota and a
 * bored teenager with a loop is this. It is not a substitute for the quota —
 * it is what stops the quota being spent in ninety seconds.
 *
 * Two honest limitations. State is per server instance, so on a platform that
 * runs several the effective limit is the configured one multiplied by the
 * instance count; that is acceptable for abuse control and would not be for
 * billing. And the window is fixed rather than sliding, so a caller can send
 * two full windows back to back across the boundary. Both are fine for the job
 * this does, and both become wrong the moment it is used for anything else —
 * which is why they are written down here.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounded so a flood of unique keys can't grow the map without limit. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    // Opportunistic sweep — cheaper than a timer, and only runs when the map
    // has actually grown large.
    if (windows.size >= MAX_TRACKED_KEYS) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfter: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client address.
 *
 * These headers are trivially forged when the app is reachable directly, so
 * this is only trustworthy behind a proxy that overwrites them — which is the
 * deployment target. Treated as a throttling hint, never as identity.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
