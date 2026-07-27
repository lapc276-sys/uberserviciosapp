import { NextResponse } from 'next/server';
import { verifyMagicToken, createProSessionToken, proSessionCookieOptions } from '@/lib/pro-auth';
import { getProByEmail, consumeMagicToken } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * Magic-link landing.
 *
 * A Route Handler, not a page: cookies can only be set from route handlers and
 * server actions in the App Router. Verifies the token, burns it so the link
 * is genuinely single-use, then establishes the session and redirects.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  // Redirect relative to the request origin, not a hardcoded site URL, so the
  // flow works on localhost and preview deployments as well as production.
  const fail = (reason: string) => {
    const target = new URL('/pros/login', url.origin);
    target.searchParams.set('error', reason);
    return NextResponse.redirect(target);
  };

  if (!token) return fail('missing');

  const payload = await verifyMagicToken(token);
  if (!payload) return fail('invalid');

  const spent = await consumeMagicToken(payload.jti, new Date(Date.now() + 15 * 60 * 1000));
  if (!spent) return fail('used');

  const pro = await getProByEmail(payload.email);
  if (!pro) return fail('unknown');
  if (pro.status !== 'APPROVED') return fail('not_approved');

  const session = await createProSessionToken({ proId: pro.id, email: pro.email, name: pro.name });

  const response = NextResponse.redirect(new URL('/pros', url.origin));
  response.cookies.set({ ...proSessionCookieOptions, value: session });
  return response;
}
