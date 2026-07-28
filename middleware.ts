import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE,
  readAttribution,
  encodeAttribution,
} from '@/lib/marketing/attribution';

/**
 * Gates the two authenticated surfaces.
 *
 * Admin and pro sessions use separate cookies and JWT audiences, so a pro
 * token can't reach the admin panel even if it's replayed.
 */

/** Pro routes that must stay public: recruiting and the sign-in flow itself. */
const PUBLIC_PRO_PATHS = ['/pros/apply', '/pros/login', '/pros/auth'];

/**
 * First-touch attribution: record where a visitor came from the first time we
 * see them, and never overwrite it. The channel that *found* the customer is
 * the one that earned the booking, even if they return directly later.
 */
function captureAttribution(req: NextRequest, res: NextResponse): NextResponse {
  if (req.cookies.get(ATTRIBUTION_COOKIE)) return res;

  const referrer = req.headers.get('referer');
  const sameHost = Boolean(referrer && referrer.includes(req.nextUrl.host));
  const attribution = readAttribution(req.nextUrl, referrer, sameHost);
  if (!attribution) return res;

  res.cookies.set({
    name: ATTRIBUTION_COOKIE,
    value: encodeAttribution(attribution),
    httpOnly: false, // readable by the booking form
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ATTRIBUTION_MAX_AGE,
  });
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next();
    const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/pros')) {
    if (PUBLIC_PRO_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }
    const session = await verifyProSession(req.cookies.get(PRO_SESSION_COOKIE)?.value);
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = '/pros/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return captureAttribution(req, NextResponse.next());
}

export const config = {
  // Public pages need attribution capture; static assets and APIs don't.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)'],
};
