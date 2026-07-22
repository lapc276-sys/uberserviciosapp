import { SignJWT, jwtVerify } from 'jose';

/**
 * Session + RBAC primitives. Edge-safe (uses jose), so the same helpers work
 * in middleware and route handlers. Passwords are handled separately in
 * lib/auth-password.ts (Node crypto), which middleware never imports.
 */

export const SESSION_COOKIE = 'homigo_session';
const ISSUER = 'homigo';
const MAX_AGE = 60 * 60 * 8; // 8 hours

export type Role = 'ADMIN' | 'DISPATCHER' | 'STAFF';

export interface SessionPayload {
  sub: string; // user id or email
  email: string;
  name?: string;
  role: Role;
}

// Coarse permission map. Extend as the admin surface grows.
const PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ['dashboard:view', 'bookings:manage', 'customers:manage', 'employees:manage', 'settings:manage'],
  DISPATCHER: ['dashboard:view', 'bookings:manage', 'customers:manage'],
  STAFF: ['dashboard:view'],
};

export function can(role: Role, permission: string): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    // Dev fallback — DO NOT ship to production without AUTH_SECRET set.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET is required in production');
    }
    return new TextEncoder().encode('dev-insecure-secret-change-me-please-32b');
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: payload.name ? String(payload.name) : undefined,
      role: (payload.role as Role) ?? 'STAFF',
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  name: SESSION_COOKIE,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE,
};
