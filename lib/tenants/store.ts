import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma, isDbConfigured } from '../db';
import {
  DEFAULT_CALIBRATION,
  DEFAULT_PRICING,
  PLAN_QUOTA,
  type Tenant,
  type TenantCalibration,
  type TenantPlan,
  type TenantPricing,
  type TenantUsage,
} from './types';

/**
 * Tenant persistence, following the same two-backend pattern as lib/data.ts:
 * Postgres when DATABASE_URL is set, an in-memory store otherwise, so the API
 * can be demoed to a prospect on a preview deploy with no infrastructure.
 */

const KEY_PREFIX = 'hk_live_';
/** 32 random bytes = 256 bits. Guessing is not a threat model at this size. */
const KEY_BYTES = 32;

/**
 * API keys are hashed with a single SHA-256 pass, not scrypt.
 *
 * That is deliberate and it is not the same tradeoff as a password. A password
 * is low-entropy and human-chosen, so a stolen hash must be made expensive to
 * brute-force. This key is 256 bits of CSPRNG output — there is nothing to
 * guess — and it is verified on every single API call, where a deliberately
 * slow hash would just be a self-inflicted denial of service.
 */
function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey(): { raw: string; hash: string; last4: string } {
  const raw = KEY_PREFIX + randomBytes(KEY_BYTES).toString('hex');
  return { raw, hash: hashKey(raw), last4: raw.slice(-4) };
}

/** Calendar month in UTC. Billing periods are UTC so they never shift on DST. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    // Strip the combining accents that NFD just split off, so "Ñ" and "É" in a
    // company name become "n"/"e" instead of being dropped as non-ASCII.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ── In-memory fallback ───────────────────────────────────────────────────────
const memory = {
  tenants: [] as (Tenant & { keyHash: string })[],
  usage: new Map<string, TenantUsage>(),
  leads: [] as TenantLeadRecord[],
};

function usageKey(tenantId: string, period: string): string {
  return `${tenantId}:${period}`;
}

interface CreateTenantInput {
  name: string;
  contactEmail: string;
  plan?: TenantPlan;
  pricing?: Partial<TenantPricing>;
  branding?: { displayName?: string; logoUrl?: string; primaryColor?: string };
}

/** The raw key is returned exactly once, here. It is never recoverable after. */
export async function createTenant(
  input: CreateTenantInput,
): Promise<{ tenant: Tenant; apiKey: string } | { error: string }> {
  const name = input.name.trim();
  if (!name) return { error: 'Name is required' };

  const plan = input.plan ?? 'trial';
  const pricing: TenantPricing = { ...DEFAULT_PRICING, ...input.pricing };
  const branding = {
    displayName: input.branding?.displayName?.trim() || name,
    logoUrl: input.branding?.logoUrl,
    primaryColor: input.branding?.primaryColor,
  };
  const { raw, hash, last4 } = generateApiKey();

  let slug = slugify(name) || `tenant-${Date.now().toString(36)}`;

  if (!isDbConfigured || !prisma) {
    if (memory.tenants.some((t) => t.slug === slug)) slug = `${slug}-${memory.tenants.length + 1}`;
    const tenant: Tenant & { keyHash: string } = {
      id: `ten_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
      slug,
      name,
      contactEmail: input.contactEmail.trim().toLowerCase(),
      plan,
      active: true,
      monthlyQuota: PLAN_QUOTA[plan],
      keyLast4: last4,
      pricing,
      calibration: { ...DEFAULT_CALIBRATION },
      branding,
      createdAt: new Date().toISOString(),
      keyHash: hash,
    };
    memory.tenants.unshift(tenant);
    return { tenant: stripHash(tenant), apiKey: raw };
  }

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${randomBytes(2).toString('hex')}`;

  const row = await prisma.tenant.create({
    data: {
      slug,
      name,
      contactEmail: input.contactEmail.trim().toLowerCase(),
      plan,
      active: true,
      monthlyQuota: PLAN_QUOTA[plan],
      keyHash: hash,
      keyLast4: last4,
      pricing: pricing as object,
      calibration: DEFAULT_CALIBRATION as object,
      branding: branding as object,
    },
  });
  return { tenant: fromRow(row), apiKey: raw };
}

function stripHash(t: Tenant & { keyHash: string }): Tenant {
  const { keyHash: _ignored, ...rest } = t;
  return rest;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromRow(row: any): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    contactEmail: row.contactEmail,
    plan: row.plan as TenantPlan,
    active: row.active,
    monthlyQuota: row.monthlyQuota,
    keyLast4: row.keyLast4,
    pricing: { ...DEFAULT_PRICING, ...((row.pricing as Partial<TenantPricing>) ?? {}) },
    calibration: { ...DEFAULT_CALIBRATION, ...((row.calibration as Partial<TenantCalibration>) ?? {}) },
    branding: (row.branding as Tenant['branding']) ?? { displayName: row.name },
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Resolves an API key to its tenant.
 *
 * The lookup is by hash, so it is one indexed query rather than a scan with a
 * comparison per row. The extra timing-safe compare afterwards costs nothing
 * and keeps the guarantee if the storage layer is ever swapped for one that
 * does scan.
 */
export async function getTenantByApiKey(rawKey: string | undefined): Promise<Tenant | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(rawKey);

  if (!isDbConfigured || !prisma) {
    const found = memory.tenants.find((t) => safeEqualHex(t.keyHash, hash));
    return found && found.active ? stripHash(found) : null;
  }

  const row = await prisma.tenant.findUnique({ where: { keyHash: hash } });
  if (!row || !row.active || !safeEqualHex(row.keyHash, hash)) return null;
  return fromRow(row);
}

function safeEqualHex(a: string, b: string): boolean {
  // Compared as raw bytes of the hex text, not decoded: a malformed value from
  // storage would decode to a short buffer and make timingSafeEqual throw.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Resolves a tenant from the slug in a public URL.
 *
 * The hosted quoting page cannot carry an API key — anything shipped to a
 * browser is published — so the slug is the only identifier available. It is
 * therefore treated as public and non-secret: it authorises nothing, it only
 * selects whose branding and rates to apply. Everything that must not be
 * guessable stays behind the key.
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;

  if (!isDbConfigured || !prisma) {
    const found = memory.tenants.find((t) => t.slug === clean);
    return found && found.active ? stripHash(found) : null;
  }

  const row = await prisma.tenant.findUnique({ where: { slug: clean } });
  return row && row.active ? fromRow(row) : null;
}

export interface TenantLeadInput {
  tenantId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  serviceSlug: string;
  quoteLow: number;
  quoteHigh: number;
  currency: string;
  minutes: number;
  condition?: string;
  analysis?: unknown;
}

export interface TenantLeadRecord extends Omit<TenantLeadInput, 'analysis'> {
  id: string;
  status: string;
  createdAt: string;
}

export async function createTenantLead(input: TenantLeadInput): Promise<string> {
  const id = `lead_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

  if (!isDbConfigured || !prisma) {
    memory.leads.unshift({ ...input, id, status: 'new', createdAt: new Date().toISOString() });
    return id;
  }

  const row = await prisma.tenantLead.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      notes: input.notes,
      serviceSlug: input.serviceSlug,
      quoteLow: input.quoteLow,
      quoteHigh: input.quoteHigh,
      currency: input.currency,
      minutes: input.minutes,
      condition: input.condition,
      analysis: (input.analysis ?? undefined) as object | undefined,
    },
  });
  return row.id;
}

export async function listTenantLeads(tenantId: string, limit = 100): Promise<TenantLeadRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.leads.filter((l) => l.tenantId === tenantId).slice(0, limit);
  }
  const rows = await prisma.tenantLead.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
    serviceSlug: r.serviceSlug,
    quoteLow: r.quoteLow,
    quoteHigh: r.quoteHigh,
    currency: r.currency,
    minutes: r.minutes,
    condition: r.condition ?? undefined,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function countTenantLeads(tenantId: string): Promise<number> {
  if (!isDbConfigured || !prisma) return memory.leads.filter((l) => l.tenantId === tenantId).length;
  return prisma.tenantLead.count({ where: { tenantId } });
}

export async function listTenants(): Promise<Tenant[]> {
  if (!isDbConfigured || !prisma) return memory.tenants.map(stripHash);
  const rows = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map(fromRow);
}

export async function getUsage(tenantId: string, period = currentPeriod()): Promise<TenantUsage> {
  const empty: TenantUsage = { tenantId, period, quotes: 0, quotedValue: 0 };

  if (!isDbConfigured || !prisma) {
    return memory.usage.get(usageKey(tenantId, period)) ?? empty;
  }

  const row = await prisma.tenantUsage.findUnique({
    where: { tenantId_period: { tenantId, period } },
  });
  return row ? { tenantId, period, quotes: row.quotes, quotedValue: row.quotedValue } : empty;
}

/**
 * Counts one quote against the tenant's month.
 *
 * The check-then-increment is not a transaction. That is a deliberate call: a
 * tenant that races requests at the boundary may land a couple of quotes over
 * their limit, which costs us cents, whereas serializing every quote behind a
 * lock would slow the hot path for everyone. Overage is a billing conversation,
 * not an incident.
 */
export async function recordQuote(tenantId: string, quotedValue: number): Promise<void> {
  const period = currentPeriod();

  if (!isDbConfigured || !prisma) {
    const key = usageKey(tenantId, period);
    const current = memory.usage.get(key) ?? { tenantId, period, quotes: 0, quotedValue: 0 };
    current.quotes += 1;
    current.quotedValue = Number((current.quotedValue + quotedValue).toFixed(2));
    memory.usage.set(key, current);
    return;
  }

  await prisma.tenantUsage.upsert({
    where: { tenantId_period: { tenantId, period } },
    create: { tenantId, period, quotes: 1, quotedValue },
    update: { quotes: { increment: 1 }, quotedValue: { increment: quotedValue } },
  });
}

export interface QuotaState {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  period: string;
}

export async function checkQuota(tenant: Tenant): Promise<QuotaState> {
  const period = currentPeriod();
  const usage = await getUsage(tenant.id, period);
  const remaining = Math.max(0, tenant.monthlyQuota - usage.quotes);
  return {
    allowed: usage.quotes < tenant.monthlyQuota,
    used: usage.quotes,
    limit: tenant.monthlyQuota,
    remaining,
    period,
  };
}

/** Writes a fitted time model back onto a tenant. This is the product working. */
export async function updateCalibration(
  tenantId: string,
  calibration: Partial<TenantCalibration>,
): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const t = memory.tenants.find((x) => x.id === tenantId);
    if (t) t.calibration = { ...t.calibration, ...calibration, calibratedAt: new Date().toISOString() };
    return;
  }
  const row = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!row) return;
  const merged = {
    ...DEFAULT_CALIBRATION,
    ...((row.calibration as Partial<TenantCalibration>) ?? {}),
    ...calibration,
    calibratedAt: new Date().toISOString(),
  };
  await prisma.tenant.update({ where: { id: tenantId }, data: { calibration: merged as object } });
}

/** Extracts the bearer token from a request, tolerating a raw key too. */
export function apiKeyFromRequest(req: Request): string | undefined {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1].trim();
  const direct = req.headers.get('x-api-key');
  return direct?.trim() || undefined;
}
