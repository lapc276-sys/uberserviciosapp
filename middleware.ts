import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';

/**
 * Gates the two authenticated surfaces.
 *
 * Admin and pro sessions use separate cookies and JWT audiences, so a pro
 * token can't reach the admin panel even if it's replayed.
 */

/** Pro routes that must stay public: recruiting and the sign-in flow itself. */
const PUBLIC_PRO_PATHS = ['/pros/apply', '/pros/login', '/pros/auth'];

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

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/pros/:path*'],
};
