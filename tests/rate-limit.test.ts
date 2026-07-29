import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  clientIp,
  limitRequest,
  rateLimitResponse,
  resetRateLimits,
  RATE_LIMITS,
} from '@/lib/rate-limit';

describe('rate limiting', () => {
  beforeEach(() => resetRateLimits());

  const rule = { limit: 3, windowMs: 60_000 };

  it('allows requests up to the limit', () => {
    for (let i = 0; i < rule.limit; i++) {
      expect(checkRateLimit('k', rule).ok).toBe(true);
    }
  });

  it('blocks the request after the limit', () => {
    for (let i = 0; i < rule.limit; i++) checkRateLimit('k', rule);
    expect(checkRateLimit('k', rule).ok).toBe(false);
  });

  it('counts down the remaining budget', () => {
    expect(checkRateLimit('k', rule).remaining).toBe(2);
    expect(checkRateLimit('k', rule).remaining).toBe(1);
    expect(checkRateLimit('k', rule).remaining).toBe(0);
  });

  it('keeps separate budgets per key, so one caller cannot lock out everyone', () => {
    for (let i = 0; i < rule.limit; i++) checkRateLimit('noisy', rule);
    expect(checkRateLimit('noisy', rule).ok).toBe(false);
    expect(checkRateLimit('quiet', rule).ok).toBe(true);
  });

  it('frees the budget once the window passes', () => {
    const start = 1_000_000;
    for (let i = 0; i < rule.limit; i++) checkRateLimit('k', rule, start);
    expect(checkRateLimit('k', rule, start).ok).toBe(false);
    expect(checkRateLimit('k', rule, start + rule.windowMs + 1).ok).toBe(true);
  });

  /**
   * A fixed window would let a caller spend the full budget at the end of one
   * window and again at the start of the next — double the calls, and for the
   * vision endpoint, double the bill. The sliding window is the reason this
   * test exists.
   */
  it('does not allow a double burst across a window boundary', () => {
    const start = 1_000_000;
    for (let i = 0; i < rule.limit; i++) checkRateLimit('burst', rule, start + i);

    // Just before the earliest hit expires, the budget is still spent.
    expect(checkRateLimit('burst', rule, start + rule.windowMs - 10).ok).toBe(false);
  });

  it('reports when to retry', () => {
    const start = 1_000_000;
    for (let i = 0; i < rule.limit; i++) checkRateLimit('k', rule, start);
    const blocked = checkRateLimit('k', rule, start + 10_000);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(rule.windowMs / 1000);
  });

  describe('client identity', () => {
    it('takes the leftmost forwarded address', () => {
      const req = new Request('https://x.test', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } });
      expect(clientIp(req)).toBe('1.2.3.4');
    });

    it('falls back to x-real-ip', () => {
      expect(clientIp(new Request('https://x.test', { headers: { 'x-real-ip': '5.6.7.8' } }))).toBe('5.6.7.8');
    });

    it('degrades to a shared bucket when no address is available', () => {
      expect(clientIp(new Request('https://x.test'))).toBe('unknown');
    });
  });

  describe('per-endpoint scoping', () => {
    const req = () => new Request('https://x.test', { headers: { 'x-forwarded-for': '9.9.9.9' } });

    it('does not let one endpoint consume another endpoint budget', () => {
      for (let i = 0; i < RATE_LIMITS.vision.limit; i++) limitRequest(req(), 'vision', RATE_LIMITS.vision);
      expect(limitRequest(req(), 'vision', RATE_LIMITS.vision).ok).toBe(false);
      expect(limitRequest(req(), 'quote', RATE_LIMITS.quote).ok).toBe(true);
    });

    it('keeps the vision budget tight, since each call costs real money', () => {
      expect(RATE_LIMITS.vision.limit).toBeLessThanOrEqual(10);
    });

    it('leaves room for an honest customer to re-record a bad walkthrough', () => {
      expect(RATE_LIMITS.vision.limit).toBeGreaterThanOrEqual(3);
    });
  });

  describe('429 response', () => {
    it('carries the headers clients honor', async () => {
      const res = rateLimitResponse({ ok: false, limit: 6, remaining: 0, retryAfter: 42 });
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('42');
      expect(res.headers.get('x-ratelimit-limit')).toBe('6');
      await expect(res.json()).resolves.toMatchObject({ retryAfter: 42 });
    });

    it('uses a custom message when given one', async () => {
      const res = rateLimitResponse({ ok: false, limit: 1, remaining: 0, retryAfter: 5 }, 'Slow down please');
      await expect(res.json()).resolves.toMatchObject({ error: 'Slow down please' });
    });
  });
});
