import { SignJWT, jwtVerify } from 'jose';

/**
 * Pro authentication — passwordless magic links.
 *
 * Deliberately separate from admin auth: a different cookie and a different
 * JWT audience, so a pro token can never be replayed against the admin surface
 * (or the reverse) even if one is leaked. Edge-safe (jose) so middleware can
 * verify sessions without a Node runtime.
 */

export const PRO_SESSION_COOKIE = 'homigo_pro_session';

const ISSUER = 'homigo';
const SESSION_AUDIENCE = 'pro-session';
const MAGIC_AUDIENCE = 'pro-magic';

const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days — pros live on their phones
const MAGIC_MAX_AGE = 60 * 15; // 15 minutes

export interface ProSession {
  proId: string;
  email: string;
  name: string;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET is required in production');
    }
    return new TextEncoder().encode('dev-insecure-secret-change-me-please-32b');
  }
  return new TextEncoder().encode(value);
}

// ── Magic link tokens ────────────────────────────────────────────────────────

/** Short-lived, single-use (see consumeMagicToken) sign-in token. */
export async function createMagicToken(email: string): Promise<string> {
  return new SignJWT({ email: email.trim().toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(MAGIC_AUDIENCE)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_MAX_AGE}s`)
    .sign(secret());
}

export async function verifyMagicToken(token: string): Promise<{ email: string; jti: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: MAGIC_AUDIENCE,
    });
    if (!payload.email || !payload.jti) return null;
    return { email: String(payload.email), jti: String(payload.jti) };
  } catch {
    return null;
  }
}

// ── Session tokens ───────────────────────────────────────────────────────────

export async function createProSessionToken(session: ProSession): Promise<string> {
  return new SignJWT({ email: session.email, name: session.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.proId)
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifyProSession(token: string | undefined): Promise<ProSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: SESSION_AUDIENCE,
    });
    return {
      proId: String(payload.sub),
      email: String(payload.email),
      name: payload.name ? String(payload.name) : '',
    };
  } catch {
    return null;
  }
}

export const proSessionCookieOptions = {
  name: PRO_SESSION_COOKIE,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE,
};
