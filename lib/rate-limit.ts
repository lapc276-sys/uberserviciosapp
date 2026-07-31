/**
 * Rate limiting for public endpoints.
 *
 * The endpoint that matters most is `/api/vision/analyze`: it is unauthenticated
 * by design (a stranger records a walkthrough before they are a customer) and
 * every call spends real money at a vision model. Without a limit, anyone who
 * finds the URL can run up the AI bill in a loop. The others are cheaper but
 * still worth guarding — the magic-link endpoint is an email-spam vector, and
 * the quote endpoint is a scraping target for competitors.
 *
 * Deliberately in-memory and dependency-free, matching how the rest of the
 * platform runs with zero infrastructure.
 *
 * ⚠️ **Serverless caveat, stated honestly:** each instance keeps its own
 * counters, so with N warm instances the effective ceiling is N × limit. That
 * is a real weakening, not a rounding error. It still converts "unbounded" into
 * "bounded by a small multiple", which is the difference between a $10 mistake
 * and a $10,000 one. When `REDIS_URL` is configured, move this to a shared
 * store — `checkRateLimit` is the only function that needs to change.
 */

export interface RateLimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the caller may retry. 0 when allowed. */
  retryAfter: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Per-endpoint budgets.
 *
 * Vision is the strict one because it is the only endpoint where a request has
 * a direct marginal cost. The numbers are set so an honest user never notices:
 * quoting a home twice, re-recording a bad walkthrough, and comparing two
 * services all fit comfortably inside them.
 */
export const RATE_LIMITS = {
  /**
   * ~$0.02 of model spend per call, and a guided walkthrough spends one per
   * room — a seven-room house is seven legitimate calls, so a budget sized for
   * a single upload would cut a real customer off halfway down the hall. Sized
   * for roughly five complete walkthroughs an hour: still bounded, still stops
   * a loop, no longer punishes the flow the product is built around.
   */
  vision: { limit: 40, windowMs: HOUR },
  quote: { limit: 30, windowMs: 5 * MINUTE },
  book: { limit: 10, windowMs: HOUR },
  chat: { limit: 40, windowMs: 5 * MINUTE },
  /** Sends an email and an SMS per call — spam vector, keep it tight. */
  magicLink: { limit: 5, windowMs: HOUR },
} satisfies Record<string, RateLimitRule>;

/**
 * Sliding-window log: timestamps per key, pruned on read.
 *
 * A log rather than a fixed counter because fixed windows let a caller send
 * double the limit across a window boundary — which for the vision endpoint is
 * double the bill.
 */
const hits = new Map<string, number[]>();

/**
 * Ceiling on tracked keys, so a flood of spoofed IPs can't grow the map
 * without bound. Exceeding it evicts the least recently active key — under
 * that kind of attack the limiter degrades, but the process survives, which is
 * the right trade for a defense that is not the last line.
 */
const MAX_KEYS = 10_000;

function prune(now: number): void {
  const widest = Math.max(...Object.values(RATE_LIMITS).map((r) => r.windowMs));
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < widest);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}

export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  const cutoff = now - rule.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= rule.limit) {
    // Oldest hit in the window decides when a slot frees up.
    const retryAfter = Math.max(1, Math.ceil((recent[0] + rule.windowMs - now) / 1000));
    hits.set(key, recent);
    return { ok: false, limit: rule.limit, remaining: 0, retryAfter };
  }

  recent.push(now);
  hits.set(key, recent);

  if (hits.size > MAX_KEYS) {
    prune(now);
    if (hits.size > MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
  }

  return { ok: true, limit: rule.limit, remaining: rule.limit - recent.length, retryAfter: 0 };
}

/**
 * Best-effort client identity.
 *
 * Behind Vercel the leftmost `x-forwarded-for` entry is the real client. A
 * caller can forge that header, so this is a cost guard and an accident
 * guard — never an authorization check. Anything that must not be bypassed
 * belongs behind a session, not behind this.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Applies `rule` to this request, scoped so endpoints don't share a budget. */
export function limitRequest(req: Request, scope: string, rule: RateLimitRule): RateLimitResult {
  return checkRateLimit(`${scope}:${clientIp(req)}`, rule);
}

/** Standard 429 with the headers clients and crawlers actually honor. */
export function rateLimitResponse(result: RateLimitResult, message?: string): Response {
  return new Response(
    JSON.stringify({
      error: message ?? 'Too many requests. Please wait a moment and try again.',
      retryAfter: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(result.retryAfter),
        'x-ratelimit-limit': String(result.limit),
        'x-ratelimit-remaining': '0',
      },
    },
  );
}

/** Test seam — clears all counters. */
export function resetRateLimits(): void {
  hits.clear();
}
