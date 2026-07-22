import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Returns null when DATABASE_URL is not configured, so the
 * whole app keeps running in dev/preview without a database (the data layer
 * falls back to an in-memory store). Set DATABASE_URL to activate persistence.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const isDbConfigured = Boolean(process.env.DATABASE_URL);

export const prisma: PrismaClient | null = isDbConfigured
  ? (globalForPrisma.prisma ??
      new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'] }))
  : null;

if (process.env.NODE_ENV !== 'production' && prisma) {
  globalForPrisma.prisma = prisma;
}
