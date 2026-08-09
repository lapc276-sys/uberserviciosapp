import { NextResponse } from 'next/server';
import { apiKeyFromRequest, checkQuota, getTenantByApiKey, getUsage } from '@/lib/tenants/store';

/**
 * GET /api/v1/usage — quota and month-to-date value, for the caller's own
 * dashboard. Cheap and unmetered on purpose: a customer should never have to
 * spend a quote to find out how many they have left.
 */

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const tenant = await getTenantByApiKey(apiKeyFromRequest(req));
  if (!tenant) {
    return NextResponse.json(
      { error: 'invalid_api_key', message: 'Send your key as `Authorization: Bearer hk_live_...`.' },
      { status: 401 },
    );
  }

  const quota = await checkQuota(tenant);
  const usage = await getUsage(tenant.id, quota.period);

  return NextResponse.json({
    tenant: { name: tenant.name, slug: tenant.slug, plan: tenant.plan },
    period: quota.period,
    quotes: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
    quotedValue: Number(usage.quotedValue.toFixed(2)),
    currency: tenant.pricing.currency,
    calibration: {
      sampleSize: tenant.calibration.sampleSize,
      globalTimeFactor: tenant.calibration.globalTimeFactor,
      calibratedAt: tenant.calibration.calibratedAt,
    },
  });
}
