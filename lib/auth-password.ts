import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Role, SessionPayload } from './auth';

/**
 * Password hashing (scrypt) + credential verification. Node runtime only —
 * imported by the login route, never by edge middleware.
 *
 * Verification order:
 *  1. Bootstrap admin from env (ADMIN_EMAIL + ADMIN_PASSWORD) — zero-DB setup.
 *  2. A DB User with a stored scrypt hash (when DATABASE_URL is configured).
 */

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, 'hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return keyBuffer.length === derived.length && timingSafeEqual(keyBuffer, derived);
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function verifyCredentials(email: string, password: string): Promise<SessionPayload | null> {
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Bootstrap admin from env.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword && normalizedEmail === adminEmail) {
    if (constantTimeEqual(password, adminPassword)) {
      return { sub: 'bootstrap-admin', email: adminEmail, name: 'Administrator', role: 'ADMIN' };
    }
    return null;
  }

  // 2. DB-backed user.
  const { prisma, isDbConfigured } = await import('./db');
  if (isDbConfigured && prisma) {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (user && (await verifyPassword(password, user.passwordHash))) {
      return { sub: user.id, email: user.email, name: user.name ?? undefined, role: user.role as Role };
    }
  }

  return null;
}
