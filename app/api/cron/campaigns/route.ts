import { NextResponse } from 'next/server';
import { runCampaigns } from '@/lib/marketing/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Lifecycle campaign runner. Scheduled weekly (see vercel.json) — daily would
 * be pestering, and the per-segment cooldowns assume a weekly cadence.
 *
 * `?dryRun=1` reports who would be contacted without sending anything, which
 * is how you sanity-check a segment before mailing real customers.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured (dev/preview)
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);
  return auth === `Bearer ${secret}` || url.searchParams.get('key') === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse('Unauthorized', { status: 401 });

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';
  const result = await runCampaigns({ dryRun });

  return NextResponse.json({ ok: true, dryRun, ...result, ranAt: new Date().toISOString() });
}
