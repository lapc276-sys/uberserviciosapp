import { NextResponse } from 'next/server';
import { archiveMode, archiveStats, purgeExpiredFrames, retentionDays } from '@/lib/vision/archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enforces the training archive's retention window.
 *
 * A retention policy that lives only in a comment is not a policy. Every
 * stored frame carries a hard `expiresAt` written when it was inserted, and
 * this deletes whatever has passed it.
 *
 * Idempotent and safe to run at any time — a policy that depends on a
 * scheduler firing exactly once has already failed. Missing a day means the
 * next run deletes two days' worth, which is the correct behaviour.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured (dev/preview) → allow
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);
  return auth === `Bearer ${secret}` || url.searchParams.get('key') === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const purged = await purgeExpiredFrames();
  const stats = await archiveStats();

  return NextResponse.json({
    purged,
    mode: archiveMode(),
    retentionDays: retentionDays(),
    holding: stats,
  });
}
