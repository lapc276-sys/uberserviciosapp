#!/usr/bin/env node
/**
 * Triggers one scheduled job over HTTP.
 *
 * Vercel Cron calls the route directly from vercel.json. Replit's Scheduled
 * Deployments run a *command* in a separate container instead, so the schedule
 * needs something to execute — this. Keeping the work behind the same HTTP
 * route rather than importing it here means both platforms run identical code,
 * and a job that works in one cannot quietly diverge in the other.
 *
 *   node scripts/run-cron.mjs reminders
 *   node scripts/run-cron.mjs campaigns
 *
 * Reads CRON_TARGET_URL, falling back to NEXT_PUBLIC_SITE_URL — on Replit the
 * scheduled container is not the web container, so localhost is not an option.
 */

const JOBS = { reminders: '/api/cron/reminders', campaigns: '/api/cron/campaigns' };

const job = process.argv[2];
if (!JOBS[job]) {
  console.error(`Unknown job "${job ?? ''}". Use one of: ${Object.keys(JOBS).join(', ')}`);
  process.exit(2);
}

const base = (process.env.CRON_TARGET_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('Set CRON_TARGET_URL (or NEXT_PUBLIC_SITE_URL) to the deployed site, e.g. https://your-app.replit.app');
  process.exit(2);
}

const secret = process.env.CRON_SECRET;
const url = `${base}${JOBS[job]}${secret ? `?key=${encodeURIComponent(secret)}` : ''}`;

// A scheduler that reports success on a failed job is worse than no scheduler:
// the run looks green while nobody was reminded of anything.
try {
  const res = await fetch(url, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();

  if (!res.ok) {
    console.error(`[cron:${job}] HTTP ${res.status} — ${body.slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`[cron:${job}] ok — ${body.slice(0, 400)}`);
} catch (err) {
  console.error(`[cron:${job}] request failed — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
