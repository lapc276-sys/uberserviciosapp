import { prisma, isDbConfigured } from './db';

/**
 * Data-access layer. One API for the app; two backends underneath:
 *  - Prisma/Postgres when DATABASE_URL is set (production)
 *  - an in-memory store otherwise (dev/preview, ephemeral)
 * This keeps the whole platform runnable with zero infrastructure while
 * making real persistence a one-env-var switch.
 */

export type Frequency = 'ONE_TIME' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type BookingStatus = 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';

export interface BookingRecord {
  id: string;
  ref: string;
  serviceSlug: string;
  serviceName: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  frequency: Frequency;
  date: string;
  time: string;
  quoteLow: number | null;
  quoteHigh: number | null;
  status: BookingStatus;
  notes?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  city: string;
  address: string;
  createdAt: string;
  remind24Sent: boolean;
  remind2Sent: boolean;
  reviewRequestSent: boolean;
  followUpSent: boolean;
  proId: string | null;
  proName: string | null;
}

export type ProStatus = 'APPLIED' | 'APPROVED' | 'SUSPENDED';

export interface ProRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: ProStatus;
  rating: number;
  serviceAreas: string[]; // city slugs
  yearsExperience: number;
  hasTransport: boolean;
  bio: string | null;
}

export interface ProApplicationInput {
  name: string;
  email: string;
  phone: string;
  serviceAreas: string[];
  yearsExperience: number;
  hasTransport: boolean;
  bio?: string;
}

export interface CustomerSummary {
  name: string;
  email: string;
  phone: string;
  bookings: number;
  ltv: number; // lifetime value in USD (sum of booking estimates)
  lastBooking: string | null;
}

export interface NewBookingInput {
  ref: string;
  serviceSlug: string;
  serviceName: string;
  bedrooms: number;
  bathrooms: number;
  sqft?: number;
  frequency: string;
  date: string;
  time: string;
  quoteLow?: number | null;
  quoteHigh?: number | null;
  notes?: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
}

export interface LeadInput {
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  message?: string;
}

const FREQ_MAP: Record<string, Frequency> = {
  one_time: 'ONE_TIME',
  weekly: 'WEEKLY',
  biweekly: 'BIWEEKLY',
  monthly: 'MONTHLY',
};

// ── In-memory fallback store (module-scoped; resets on redeploy) ──────────────
const memory = {
  bookings: [] as BookingRecord[],
  leads: [] as (LeadInput & { id: string; createdAt: string })[],
  invoices: [] as { ref: string; amount: number; status: string; stripeId?: string }[],
  optOuts: new Set<string>(),
  // Seeded so dispatch works out of the box without a database.
  pros: [
    { id: 'pro_maria', name: 'Maria G.', email: 'maria@homigo.com', phone: '+15550101001', status: 'APPROVED', rating: 4.9, serviceAreas: ['manhattan-ny', 'brooklyn-ny'], yearsExperience: 6, hasTransport: true, bio: null },
    { id: 'pro_carlos', name: 'Carlos R.', email: 'carlos@homigo.com', phone: '+15550101002', status: 'APPROVED', rating: 4.8, serviceAreas: ['brooklyn-ny', 'queens-ny'], yearsExperience: 4, hasTransport: true, bio: null },
    { id: 'pro_aisha', name: 'Aisha K.', email: 'aisha@homigo.com', phone: '+15550101003', status: 'APPROVED', rating: 5.0, serviceAreas: ['manhattan-ny', 'queens-ny', 'bronx-ny'], yearsExperience: 8, hasTransport: false, bio: null },
    { id: 'pro_luis', name: 'Luis M.', email: 'luis@homigo.com', phone: '+15550101004', status: 'APPROVED', rating: 4.7, serviceAreas: ['miami-fl', 'miami-beach-fl'], yearsExperience: 5, hasTransport: true, bio: null },
  ] as ProRecord[],
  offers: [] as { bookingRef: string; proId: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' }[],
};

function toFrequency(f: string): Frequency {
  return FREQ_MAP[f] ?? 'ONE_TIME';
}

export async function createBooking(input: NewBookingInput): Promise<BookingRecord> {
  const record: BookingRecord = {
    id: input.ref,
    ref: input.ref,
    serviceSlug: input.serviceSlug,
    serviceName: input.serviceName,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    sqft: input.sqft ?? 0,
    frequency: toFrequency(input.frequency),
    date: input.date,
    time: input.time,
    quoteLow: input.quoteLow ?? null,
    quoteHigh: input.quoteHigh ?? null,
    status: 'SCHEDULED',
    notes: input.notes ?? null,
    customerName: input.name,
    customerEmail: input.email,
    customerPhone: input.phone,
    city: input.city,
    address: input.address,
    createdAt: new Date().toISOString(),
    remind24Sent: false,
    remind2Sent: false,
    reviewRequestSent: false,
    followUpSent: false,
    proId: null,
    proName: null,
  };

  if (!isDbConfigured || !prisma) {
    memory.bookings.unshift(record);
    return record;
  }

  const customer = await prisma.customer.upsert({
    where: { email: input.email },
    update: { name: input.name, phone: input.phone },
    create: { name: input.name, email: input.email, phone: input.phone },
  });

  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      line1: input.address,
      city: input.city,
      notes: input.notes,
    },
  });

  await prisma.booking.create({
    data: {
      ref: input.ref,
      serviceSlug: input.serviceSlug,
      serviceName: input.serviceName,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      sqft: input.sqft ?? 0,
      frequency: toFrequency(input.frequency),
      date: input.date,
      time: input.time,
      quoteLow: input.quoteLow ?? null,
      quoteHigh: input.quoteHigh ?? null,
      notes: input.notes,
      customerId: customer.id,
      addressId: address.id,
    },
  });

  return record;
}

export async function listBookings(limit = 20): Promise<BookingRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.bookings.slice(0, limit);
  }
  const rows = await prisma.booking.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { customer: true, address: true, pro: true },
  });
  return rows.map(mapRow);
}

export interface DashboardStats {
  revenueMtd: number;
  bookings: number;
  newCustomers: number;
  recurringRatePct: number;
  avgRating: number;
  source: 'db' | 'memory';
}

export async function getDashboardStats(): Promise<DashboardStats> {
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings;
    const revenue = b.reduce((sum, x) => sum + (x.quoteLow ?? 0), 0);
    const recurring = b.filter((x) => x.frequency !== 'ONE_TIME').length;
    return {
      revenueMtd: revenue,
      bookings: b.length,
      newCustomers: new Set(b.map((x) => x.customerEmail)).size,
      recurringRatePct: b.length ? Math.round((recurring / b.length) * 100) : 0,
      avgRating: 4.9,
      source: 'memory',
    };
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [bookingsCount, recurringCount, newCustomers, invoices, reviews] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.count({ where: { frequency: { not: 'ONE_TIME' } } }),
    prisma.customer.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.invoice.aggregate({ _sum: { amount: true }, where: { status: 'PAID', createdAt: { gte: startOfMonth } } }),
    prisma.review.aggregate({ _avg: { rating: true } }),
  ]);

  return {
    revenueMtd: invoices._sum.amount ?? 0,
    bookings: bookingsCount,
    newCustomers,
    recurringRatePct: bookingsCount ? Math.round((recurringCount / bookingsCount) * 100) : 0,
    avgRating: Number((reviews._avg.rating ?? 4.9).toFixed(1)),
    source: 'db',
  };
}

export async function createLead(input: LeadInput): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memory.leads.unshift({ ...input, id: `lead_${Date.now()}`, createdAt: new Date().toISOString() });
    return;
  }
  await prisma.lead.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      source: input.source ?? 'web',
      message: input.message,
    },
  });
}

// ── Invoices ─────────────────────────────────────────────────────────────────
export async function createInvoice(input: {
  ref: string;
  amount: number; // cents
  stripeId?: string;
  status?: 'DRAFT' | 'SENT' | 'PAID' | 'VOID';
}): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memory.invoices.unshift({ ref: input.ref, amount: input.amount, status: input.status ?? 'SENT', stripeId: input.stripeId });
    return;
  }
  const booking = await prisma.booking.findUnique({ where: { ref: input.ref } });
  if (!booking) return;
  await prisma.invoice.upsert({
    where: { bookingId: booking.id },
    update: { amount: input.amount, stripeId: input.stripeId, status: input.status ?? 'SENT' },
    create: { bookingId: booking.id, amount: input.amount, stripeId: input.stripeId, status: input.status ?? 'SENT' },
  });
}

export async function markInvoicePaid(stripeId: string): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const inv = memory.invoices.find((i) => i.stripeId === stripeId);
    if (inv) inv.status = 'PAID';
    return;
  }
  await prisma.invoice.updateMany({ where: { stripeId }, data: { status: 'PAID' } });
}

// ── Reminder / review / follow-up scanning (used by the cron endpoint) ───────
export type ReminderKind = '24h' | '2h' | 'review' | 'followup';

const KIND_FIELD: Record<ReminderKind, 'remind24Sent' | 'remind2Sent' | 'reviewRequestSent' | 'followUpSent'> = {
  '24h': 'remind24Sent',
  '2h': 'remind2Sent',
  review: 'reviewRequestSent',
  followup: 'followUpSent',
};

/**
 * Bookings whose local date falls in [fromDate, toDate]. Callers then decide
 * what's actually due using the market's timezone — never by comparing a
 * stored date string against a UTC "today".
 */
export async function bookingsBetween(fromDate: string, toDate: string): Promise<BookingRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.bookings.filter((b) => b.date >= fromDate && b.date <= toDate);
  }
  const rows = await prisma.booking.findMany({
    where: { date: { gte: fromDate, lte: toDate } },
    include: { customer: true, address: true, pro: true },
  });
  return rows.map(mapRow);
}

export async function markReminderSent(ref: string, kind: ReminderKind): Promise<void> {
  const field = KIND_FIELD[kind];
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings.find((x) => x.ref === ref);
    if (b) (b as any)[field] = true;
    return;
  }
  await prisma.booking.update({ where: { ref }, data: { [field]: true } });
}

// ── Marketplace: pros, offers & CRM ──────────────────────────────────────────
function toProRecord(p: any): ProRecord {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    status: p.status,
    rating: p.rating,
    serviceAreas: p.serviceAreas ?? [],
    yearsExperience: p.yearsExperience ?? 0,
    hasTransport: p.hasTransport ?? false,
    bio: p.bio ?? null,
  };
}

export async function listPros(status?: ProStatus): Promise<ProRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.pros.filter((p) => !status || p.status === status);
  }
  const rows = await prisma.pro.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: 'asc' }, { rating: 'desc' }],
  });
  return rows.map(toProRecord);
}

/** Approved pros who cover a given city slug. */
export async function prosForCity(citySlug: string): Promise<ProRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.pros.filter((p) => p.status === 'APPROVED' && p.serviceAreas.includes(citySlug));
  }
  const rows = await prisma.pro.findMany({
    where: { status: 'APPROVED', serviceAreas: { has: citySlug } },
    orderBy: { rating: 'desc' },
  });
  return rows.map(toProRecord);
}

export async function createProApplication(input: ProApplicationInput): Promise<{ ok: boolean; duplicate?: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!isDbConfigured || !prisma) {
    if (memory.pros.some((p) => p.email === email)) return { ok: false, duplicate: true };
    memory.pros.push({
      id: `pro_${Date.now().toString(36)}`,
      name: input.name,
      email,
      phone: input.phone,
      status: 'APPLIED',
      rating: 5,
      serviceAreas: input.serviceAreas,
      yearsExperience: input.yearsExperience,
      hasTransport: input.hasTransport,
      bio: input.bio ?? null,
    });
    return { ok: true };
  }
  const existing = await prisma.pro.findUnique({ where: { email } });
  if (existing) return { ok: false, duplicate: true };
  await prisma.pro.create({
    data: {
      name: input.name,
      email,
      phone: input.phone,
      serviceAreas: input.serviceAreas,
      yearsExperience: input.yearsExperience,
      hasTransport: input.hasTransport,
      bio: input.bio,
    },
  });
  return { ok: true };
}

export async function setProStatus(id: string, status: ProStatus): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const p = memory.pros.find((x) => x.id === id);
    if (p) p.status = status;
    return;
  }
  await prisma.pro.update({ where: { id }, data: { status } });
}

/** Count of bookings already committed to a pro on a given date (load). */
export async function proLoadOn(date: string): Promise<Record<string, number>> {
  const load: Record<string, number> = {};
  if (!isDbConfigured || !prisma) {
    for (const b of memory.bookings) if (b.date === date && b.proId) load[b.proId] = (load[b.proId] ?? 0) + 1;
    return load;
  }
  const rows = await prisma.booking.groupBy({ by: ['proId'], where: { date, proId: { not: null } }, _count: true });
  for (const r of rows) if (r.proId) load[r.proId] = r._count;
  return load;
}

/** Records offers sent to a shortlist of pros for a booking. */
export async function createJobOffers(ref: string, proIds: string[]): Promise<void> {
  if (!isDbConfigured || !prisma) {
    for (const proId of proIds) {
      if (!memory.offers.some((o) => o.bookingRef === ref && o.proId === proId)) {
        memory.offers.push({ bookingRef: ref, proId, status: 'PENDING' });
      }
    }
    return;
  }
  const booking = await prisma.booking.findUnique({ where: { ref } });
  if (!booking) return;
  await prisma.jobOffer.createMany({
    data: proIds.map((proId) => ({ bookingId: booking.id, proId })),
    skipDuplicates: true,
  });
}

/**
 * First-to-accept wins. Returns false if the job was already taken, so the
 * losing pro gets an honest "already claimed" instead of a silent overwrite.
 */
export async function acceptJobOffer(ref: string, proId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isDbConfigured || !prisma) {
    const booking = memory.bookings.find((b) => b.ref === ref);
    if (!booking) return { ok: false, reason: 'not_found' };
    if (booking.proId) return { ok: false, reason: 'already_claimed' };
    const pro = memory.pros.find((p) => p.id === proId);
    if (!pro || pro.status !== 'APPROVED') return { ok: false, reason: 'not_eligible' };
    booking.proId = pro.id;
    booking.proName = pro.name;
    for (const o of memory.offers.filter((x) => x.bookingRef === ref)) {
      o.status = o.proId === proId ? 'ACCEPTED' : 'EXPIRED';
    }
    return { ok: true };
  }

  const booking = await prisma.booking.findUnique({ where: { ref } });
  if (!booking) return { ok: false, reason: 'not_found' };
  if (booking.proId) return { ok: false, reason: 'already_claimed' };

  const pro = await prisma.pro.findUnique({ where: { id: proId } });
  if (!pro || pro.status !== 'APPROVED') return { ok: false, reason: 'not_eligible' };

  // Conditional update guards the race: only claims if still unassigned.
  const claimed = await prisma.booking.updateMany({
    where: { ref, proId: null },
    data: { proId },
  });
  if (claimed.count === 0) return { ok: false, reason: 'already_claimed' };

  await prisma.$transaction([
    prisma.jobOffer.updateMany({
      where: { bookingId: booking.id, proId },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    }),
    prisma.jobOffer.updateMany({
      where: { bookingId: booking.id, proId: { not: proId }, status: 'PENDING' },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    }),
  ]);
  return { ok: true };
}

export async function declineJobOffer(ref: string, proId: string): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const o = memory.offers.find((x) => x.bookingRef === ref && x.proId === proId);
    if (o) o.status = 'DECLINED';
    return;
  }
  const booking = await prisma.booking.findUnique({ where: { ref } });
  if (!booking) return;
  await prisma.jobOffer.updateMany({
    where: { bookingId: booking.id, proId, status: 'PENDING' },
    data: { status: 'DECLINED', respondedAt: new Date() },
  });
}

/** Admin override: hard-assign a pro (used when nobody accepts in time). */
export async function assignPro(ref: string, proId: string, proName: string): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings.find((x) => x.ref === ref);
    if (b) { b.proId = proId; b.proName = proName; }
    return;
  }
  await prisma.booking.update({ where: { ref }, data: { proId } });
}

export async function updateBookingStatus(ref: string, status: BookingStatus): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings.find((x) => x.ref === ref);
    if (b) b.status = status;
    return;
  }
  await prisma.booking.update({ where: { ref }, data: { status } });
}

// ── Analytics (Phase 5) ──────────────────────────────────────────────────────
export interface AnalyticsData {
  funnel: { leads: number; bookings: number; completed: number };
  conversionPct: number; // leads → bookings
  completionPct: number; // bookings → completed
  avgTicket: number; // USD, midpoint of quotes
  recurringPct: number;
  estRevenue: number; // USD, sum of quote midpoints (booked value)
  byDay: { date: string; count: number; value: number }[]; // last 14 days
  byService: { name: string; count: number; value: number }[];
  byCity: { name: string; count: number }[];
  source: 'db' | 'memory';
}

export async function getAnalytics(): Promise<AnalyticsData> {
  const [bookings, leads] = await Promise.all([listBookings(1000), countLeads()]);

  const mid = (b: BookingRecord) =>
    b.quoteLow && b.quoteHigh ? Math.round((b.quoteLow + b.quoteHigh) / 2) : b.quoteLow ?? 0;

  const completed = bookings.filter((b) => b.status === 'COMPLETED').length;
  const recurring = bookings.filter((b) => b.frequency !== 'ONE_TIME').length;
  const estRevenue = bookings.reduce((s, b) => s + mid(b), 0);

  // Last 14 days series keyed by creation date.
  const byDayMap = new Map<string, { count: number; value: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    byDayMap.set(d.toISOString().split('T')[0], { count: 0, value: 0 });
  }
  for (const b of bookings) {
    const day = b.createdAt.split('T')[0];
    const bucket = byDayMap.get(day);
    if (bucket) {
      bucket.count += 1;
      bucket.value += mid(b);
    }
  }

  const byServiceMap = new Map<string, { count: number; value: number }>();
  const byCityMap = new Map<string, number>();
  for (const b of bookings) {
    const s = byServiceMap.get(b.serviceName) ?? { count: 0, value: 0 };
    s.count += 1;
    s.value += mid(b);
    byServiceMap.set(b.serviceName, s);
    byCityMap.set(b.city, (byCityMap.get(b.city) ?? 0) + 1);
  }

  return {
    funnel: { leads: Math.max(leads, bookings.length), bookings: bookings.length, completed },
    conversionPct: leads > 0 ? Math.round((bookings.length / Math.max(leads, bookings.length)) * 100) : 0,
    completionPct: bookings.length ? Math.round((completed / bookings.length) * 100) : 0,
    avgTicket: bookings.length ? Math.round(estRevenue / bookings.length) : 0,
    recurringPct: bookings.length ? Math.round((recurring / bookings.length) * 100) : 0,
    estRevenue,
    byDay: [...byDayMap.entries()].map(([date, v]) => ({ date, ...v })),
    byService: [...byServiceMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value),
    byCity: [...byCityMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    source: isDbConfigured ? 'db' : 'memory',
  };
}

// ── Marketing opt-outs (CAN-SPAM) ────────────────────────────────────────────
export async function isUnsubscribed(email: string): Promise<boolean> {
  const key = email.trim().toLowerCase();
  if (!isDbConfigured || !prisma) return memory.optOuts.has(key);
  const row = await prisma.optOut.findUnique({ where: { email: key } });
  return Boolean(row);
}

export async function unsubscribe(email: string): Promise<void> {
  const key = email.trim().toLowerCase();
  if (!isDbConfigured || !prisma) {
    memory.optOuts.add(key);
    return;
  }
  await prisma.optOut.upsert({ where: { email: key }, update: {}, create: { email: key } });
}

/** A single booking by reference, for the pro-facing job view. */
export async function getBookingByRef(ref: string): Promise<BookingRecord | null> {
  if (!isDbConfigured || !prisma) {
    return memory.bookings.find((b) => b.ref === ref) ?? null;
  }
  const row = await prisma.booking.findUnique({
    where: { ref },
    include: { customer: true, address: true, pro: true },
  });
  return row ? mapRow(row) : null;
}

/** Pros currently holding a pending offer for a booking. */
export async function pendingOfferProIds(ref: string): Promise<string[]> {
  if (!isDbConfigured || !prisma) {
    return memory.offers.filter((o) => o.bookingRef === ref && o.status === 'PENDING').map((o) => o.proId);
  }
  const booking = await prisma.booking.findUnique({ where: { ref } });
  if (!booking) return [];
  const rows = await prisma.jobOffer.findMany({ where: { bookingId: booking.id, status: 'PENDING' } });
  return rows.map((o) => o.proId);
}

export async function countLeads(): Promise<number> {
  if (!isDbConfigured || !prisma) return memory.leads.length;
  return prisma.lead.count();
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  const bookings = await listBookings(500);
  const byEmail = new Map<string, CustomerSummary>();
  for (const b of bookings) {
    const key = b.customerEmail || b.customerPhone;
    const value = b.quoteLow && b.quoteHigh ? Math.round((b.quoteLow + b.quoteHigh) / 2) : b.quoteLow ?? 0;
    const existing = byEmail.get(key);
    if (existing) {
      existing.bookings += 1;
      existing.ltv += value;
      if (!existing.lastBooking || b.createdAt > existing.lastBooking) existing.lastBooking = b.createdAt;
    } else {
      byEmail.set(key, {
        name: b.customerName,
        email: b.customerEmail,
        phone: b.customerPhone,
        bookings: 1,
        ltv: value,
        lastBooking: b.createdAt,
      });
    }
  }
  return [...byEmail.values()].sort((a, b) => b.ltv - a.ltv);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(b: any): BookingRecord {
  return {
    id: b.id,
    ref: b.ref,
    serviceSlug: b.serviceSlug,
    serviceName: b.serviceName,
    bedrooms: b.bedrooms,
    bathrooms: b.bathrooms,
    sqft: b.sqft,
    frequency: b.frequency,
    date: b.date,
    time: b.time,
    quoteLow: b.quoteLow,
    quoteHigh: b.quoteHigh,
    status: b.status,
    notes: b.notes,
    customerName: b.customer?.name ?? '—',
    customerEmail: b.customer?.email ?? '',
    customerPhone: b.customer?.phone ?? '',
    city: b.address?.city ?? '—',
    address: b.address?.line1 ?? '—',
    createdAt: b.createdAt.toISOString(),
    remind24Sent: b.remind24Sent,
    remind2Sent: b.remind2Sent,
    reviewRequestSent: b.reviewRequestSent,
    followUpSent: b.followUpSent,
    proId: b.proId ?? null,
    proName: b.pro?.name ?? null,
  };
}

