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
  actualMinutes: number | null;
  promoCode: string | null;
  discount: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
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
  promoCode?: string;
  discount?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
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
  visionAnalyses: [] as VisionAnalysisRecord[],
  usedTokens: new Set<string>(),
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
    actualMinutes: null,
    promoCode: input.promoCode ?? null,
    discount: input.discount ?? null,
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
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
      promoCode: input.promoCode,
      discount: input.discount,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
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

export async function getProByEmail(email: string): Promise<ProRecord | null> {
  const key = email.trim().toLowerCase();
  if (!isDbConfigured || !prisma) {
    return memory.pros.find((p) => p.email === key) ?? null;
  }
  const row = await prisma.pro.findUnique({ where: { email: key } });
  return row ? toProRecord(row) : null;
}

export async function getProById(id: string): Promise<ProRecord | null> {
  if (!isDbConfigured || !prisma) {
    return memory.pros.find((p) => p.id === id) ?? null;
  }
  const row = await prisma.pro.findUnique({ where: { id } });
  return row ? toProRecord(row) : null;
}

/**
 * Marks a magic-link token as spent. Returns false if it was already used,
 * making sign-in links genuinely single-use — a link sitting in an inbox or
 * SMS history can't be replayed.
 */
export async function consumeMagicToken(jti: string, expiresAt: Date): Promise<boolean> {
  if (!isDbConfigured || !prisma) {
    if (memory.usedTokens.has(jti)) return false;
    memory.usedTokens.add(jti);
    return true;
  }
  try {
    await prisma.usedToken.create({ data: { jti, expiresAt } });
    return true;
  } catch {
    return false; // unique constraint → already consumed
  }
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
    // A pro may only claim work actually offered to them — otherwise anyone
    // who guesses a booking ref could snipe jobs outside their service area
    // and bypass the ranking entirely.
    const offer = memory.offers.find((o) => o.bookingRef === ref && o.proId === proId && o.status === 'PENDING');
    if (!offer) return { ok: false, reason: 'not_offered' };
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

  // A pro may only claim work actually offered to them — otherwise anyone who
  // guesses a booking ref could snipe jobs outside their service area and
  // bypass the ranking entirely.
  const offer = await prisma.jobOffer.findUnique({
    where: { bookingId_proId: { bookingId: booking.id, proId } },
  });
  if (!offer || offer.status !== 'PENDING') return { ok: false, reason: 'not_offered' };

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

// ── Vision analyses & calibration ────────────────────────────────────────────
export interface VisionAnalysisRecord {
  id: string;
  serviceSlug: string;
  city: string | null;
  roomCount: number;
  predictedMinutes: number;
  actualMinutes: number | null;
  condition: string;
  confidence: number;
  source: string;
  quoteLow: number;
  quoteHigh: number;
  createdAt: string;
}

export async function saveVisionAnalysis(input: {
  serviceSlug: string;
  city?: string;
  frameCount: number;
  analysis: { rooms: unknown[]; totalMinutes: number; condition: string; confidence: number; source: string };
  quote: { low: number; high: number };
  contactEmail?: string;
}): Promise<string> {
  const id = `vis_${Date.now().toString(36)}`;
  const record: VisionAnalysisRecord = {
    id,
    serviceSlug: input.serviceSlug,
    city: input.city ?? null,
    roomCount: input.analysis.rooms.length,
    predictedMinutes: input.analysis.totalMinutes,
    actualMinutes: null,
    condition: input.analysis.condition,
    confidence: input.analysis.confidence,
    source: input.analysis.source,
    quoteLow: input.quote.low,
    quoteHigh: input.quote.high,
    createdAt: new Date().toISOString(),
  };

  if (!isDbConfigured || !prisma) {
    memory.visionAnalyses.unshift(record);
    return id;
  }

  const row = await prisma.visionAnalysis.create({
    data: {
      serviceSlug: input.serviceSlug,
      city: input.city,
      frameCount: input.frameCount,
      roomCount: input.analysis.rooms.length,
      predictedMinutes: input.analysis.totalMinutes,
      condition: input.analysis.condition,
      confidence: input.analysis.confidence,
      source: input.analysis.source,
      quoteLow: input.quote.low,
      quoteHigh: input.quote.high,
      payload: input.analysis as any,
      contactEmail: input.contactEmail,
    },
  });
  return row.id;
}

/** Links an analysis to the booking it produced, so actuals can be compared. */
export async function attachAnalysisToBooking(analysisId: string, ref: string): Promise<void> {
  if (!isDbConfigured || !prisma) return;
  const booking = await prisma.booking.findUnique({ where: { ref } });
  if (!booking) return;
  await prisma.visionAnalysis.update({ where: { id: analysisId }, data: { bookingId: booking.id } }).catch(() => {});
}

/** Ground truth captured when a pro finishes a job. */
export async function recordActualMinutes(ref: string, minutes: number): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings.find((x) => x.ref === ref);
    if (b) b.actualMinutes = minutes;
    return;
  }
  await prisma.booking.update({ where: { ref }, data: { actualMinutes: minutes } });
}

export interface CalibrationSummary {
  analyses: number;
  withActuals: number;
  /** Mean signed error in minutes; positive means the model over-estimates. */
  meanBiasMinutes: number;
  meanAbsErrorMinutes: number;
  /** Share of jobs where predicted was within 20% of actual. */
  within20Pct: number;
  /**
   * Summed minutes across scored jobs. Ratio-based calibration needs the
   * totals, not the mean of per-job ratios: a 20-minute job that ran 10
   * minutes over should not weigh the same as a 6-hour job that did.
   */
  predictedTotalMinutes: number;
  actualTotalMinutes: number;
  recent: VisionAnalysisRecord[];
}

export async function getCalibration(): Promise<CalibrationSummary> {
  let records: VisionAnalysisRecord[];

  if (!isDbConfigured || !prisma) {
    records = memory.visionAnalyses.slice(0, 200);
  } else {
    const rows = await prisma.visionAnalysis.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
      include: { booking: true },
    });
    records = rows.map((r) => ({
      id: r.id,
      serviceSlug: r.serviceSlug,
      city: r.city,
      roomCount: r.roomCount,
      predictedMinutes: r.predictedMinutes,
      actualMinutes: r.booking?.actualMinutes ?? null,
      condition: r.condition,
      confidence: r.confidence,
      source: r.source,
      quoteLow: r.quoteLow,
      quoteHigh: r.quoteHigh,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  const scored = records.filter((r) => r.actualMinutes && r.actualMinutes > 0);
  const bias = scored.length
    ? scored.reduce((s, r) => s + (r.predictedMinutes - r.actualMinutes!), 0) / scored.length
    : 0;
  const absError = scored.length
    ? scored.reduce((s, r) => s + Math.abs(r.predictedMinutes - r.actualMinutes!), 0) / scored.length
    : 0;
  const close = scored.filter(
    (r) => Math.abs(r.predictedMinutes - r.actualMinutes!) / r.actualMinutes! <= 0.2,
  ).length;

  return {
    analyses: records.length,
    withActuals: scored.length,
    meanBiasMinutes: Math.round(bias),
    meanAbsErrorMinutes: Math.round(absError),
    within20Pct: scored.length ? Math.round((close / scored.length) * 100) : 0,
    predictedTotalMinutes: scored.reduce((s, r) => s + r.predictedMinutes, 0),
    actualTotalMinutes: scored.reduce((s, r) => s + r.actualMinutes!, 0),
    recent: records.slice(0, 25),
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

/** Jobs a pro has claimed, newest first. */
export async function bookingsForPro(proId: string, limit = 50): Promise<BookingRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.bookings.filter((b) => b.proId === proId).slice(0, limit);
  }
  const rows = await prisma.booking.findMany({
    where: { proId },
    take: limit,
    orderBy: { date: 'desc' },
    include: { customer: true, address: true, pro: true },
  });
  return rows.map(mapRow);
}

/** Open offers waiting on a pro's response. */
export async function openOffersForPro(proId: string): Promise<BookingRecord[]> {
  if (!isDbConfigured || !prisma) {
    const refs = memory.offers.filter((o) => o.proId === proId && o.status === 'PENDING').map((o) => o.bookingRef);
    return memory.bookings.filter((b) => refs.includes(b.ref) && !b.proId);
  }
  const offers = await prisma.jobOffer.findMany({
    where: { proId, status: 'PENDING' },
    include: {
      booking: { include: { customer: true, address: true, pro: true } },
    },
  });
  return offers.filter((o) => !o.booking.proId).map((o) => mapRow(o.booking));
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

// ── Attribution reporting ────────────────────────────────────────────────────
export interface ChannelPerformance {
  channel: string;
  source: string;
  medium: string | null;
  bookings: number;
  revenue: number; // USD, booked value
  avgTicket: number;
  /** What you could spend per booking and still break even at 100% margin. */
  maxCac: number;
}

/**
 * Bookings and booked value grouped by first-touch channel.
 * This is what turns ad spend from a guess into a decision.
 */
export async function getChannelPerformance(): Promise<ChannelPerformance[]> {
  const bookings = await listBookings(1000);
  const groups = new Map<string, { source: string; medium: string | null; count: number; revenue: number }>();

  for (const b of bookings) {
    const source = b.utmSource ?? 'direct';
    const medium = b.utmMedium ?? null;
    const key = `${source}|${medium ?? ''}`;
    const value =
      b.quoteLow && b.quoteHigh ? Math.round((b.quoteLow + b.quoteHigh) / 2) : (b.quoteLow ?? 0);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.revenue += value;
    } else {
      groups.set(key, { source, medium, count: 1, revenue: value });
    }
  }

  const { channelLabel } = await import('./marketing/attribution');

  return [...groups.values()]
    .map((g) => ({
      channel: channelLabel({ source: g.source, medium: g.medium }),
      source: g.source,
      medium: g.medium,
      bookings: g.count,
      revenue: g.revenue,
      avgTicket: g.count ? Math.round(g.revenue / g.count) : 0,
      // Platform take is ~25%, so break-even CAC is a quarter of the ticket.
      maxCac: g.count ? Math.round((g.revenue / g.count) * 0.25) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
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
    actualMinutes: b.actualMinutes ?? null,
    promoCode: b.promoCode ?? null,
    discount: b.discount ?? null,
    utmSource: b.utmSource ?? null,
    utmMedium: b.utmMedium ?? null,
    utmCampaign: b.utmCampaign ?? null,
  };
}

