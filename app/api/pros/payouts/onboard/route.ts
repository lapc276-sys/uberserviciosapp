import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { getProById } from '@/lib/data';
import { createConnectAccount, createAccountLink, isStripeConfigured } from '@/lib/stripe';
import { setProStripeAccount, getProStripeAccount } from '@/lib/payouts';
import { site } from '@/lib/config/site';

export const runtime = 'nodejs';

/**
 * Starts (or resumes) Stripe Connect Express onboarding for the signed-in pro.
 * Stripe collects identity, bank and tax details directly, so we never hold
 * them — the right posture for a marketplace paying contractors.
 */
export async function POST() {
  const jar = await cookies();
  const session = await verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isStripeConfigured) {
    return NextResponse.json(
      { error: 'Payouts are not configured yet. Please try again later.' },
      { status: 503 },
    );
  }

  const pro = await getProById(session.proId);
  if (!pro || pro.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Your account is not approved for payouts.' }, { status: 403 });
  }

  try {
    const existing = await getProStripeAccount(session.proId);
    const accountId = await createConnectAccount({
      email: pro.email,
      name: pro.name,
      existingAccountId: existing,
    });
    if (!accountId) {
      return NextResponse.json({ error: 'Could not start payout setup.' }, { status: 502 });
    }

    if (accountId !== existing) await setProStripeAccount(session.proId, accountId);

    const url = await createAccountLink(
      accountId,
      `${site.url}/pros/payouts?status=complete`,
      `${site.url}/pros/payouts?status=refresh`,
    );
    if (!url) return NextResponse.json({ error: 'Could not start payout setup.' }, { status: 502 });

    return NextResponse.json({ url });
  } catch (err) {
    console.error('[payouts] onboarding failed', err);
    return NextResponse.json({ error: 'Could not start payout setup.' }, { status: 502 });
  }
}
