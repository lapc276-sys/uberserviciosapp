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
  employeeId: string | null;
  employeeName: string | null;
}

export interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  rating: number;
  active: boolean;
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
  // Seeded so dispatch works out of the box without a database.
  employees: [
    { id: 'emp_maria', name: 'Maria G.', email: 'maria@homigo.com', phone: '+15550101001', rating: 4.9, active: true },
    { id: 'emp_carlos', name: 'Carlos R.', email: 'carlos@homigo.com', phone: '+15550101002', rating: 4.8, active: true },
    { id: 'emp_aisha', name: 'Aisha K.', email: 'aisha@homigo.com', phone: '+15550101003', rating: 5.0, active: true },
  ] as EmployeeRecord[],
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
    employeeId: null,
    employeeName: null,
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
    include: { customer: true, address: true, employee: true },
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

export async function bookingsDueFor(kind: ReminderKind, today: string, weekAgo: string, tomorrow: string): Promise<BookingRecord[]> {
  if (!isDbConfigured || !prisma) {
    return memory.bookings.filter((b) => matches(b, kind, today, weekAgo, tomorrow));
  }
  const inc = { customer: true, address: true, employee: true } as const;
  if (kind === '24h') {
    return (await prisma.booking.findMany({ where: { status: 'SCHEDULED', date: tomorrow, remind24Sent: false }, include: inc })).map(mapRow);
  }
  if (kind === '2h') {
    return (await prisma.booking.findMany({ where: { status: 'SCHEDULED', date: today, remind2Sent: false }, include: inc })).map(mapRow);
  }
  if (kind === 'review') {
    return (await prisma.booking.findMany({ where: { date: { lt: today }, reviewRequestSent: false }, include: inc })).map(mapRow);
  }
  // followup: booking a week or more in the past, review already handled.
  return (await prisma.booking.findMany({ where: { date: { lte: weekAgo }, followUpSent: false }, include: inc })).map(mapRow);
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

function matches(b: BookingRecord, kind: ReminderKind, today: string, weekAgo: string, tomorrow: string): boolean {
  if (kind === '24h') return b.status === 'SCHEDULED' && b.date === tomorrow && !b.remind24Sent;
  if (kind === '2h') return b.status === 'SCHEDULED' && b.date === today && !b.remind2Sent;
  if (kind === 'review') return b.date < today && !b.reviewRequestSent;
  return b.date <= weekAgo && !b.followUpSent;
}

// ── Employees, dispatch & CRM (Phase 4) ──────────────────────────────────────
export async function listEmployees(): Promise<EmployeeRecord[]> {
  if (!isDbConfigured || !prisma) return memory.employees;
  const rows = await prisma.employee.findMany({ orderBy: { rating: 'desc' } });
  return rows.map((e) => ({ id: e.id, name: e.name, email: e.email, phone: e.phone, rating: e.rating, active: e.active }));
}

/** Count of bookings already assigned to an employee on a given date (load). */
export async function employeeLoadOn(date: string): Promise<Record<string, number>> {
  const load: Record<string, number> = {};
  if (!isDbConfigured || !prisma) {
    for (const b of memory.bookings) if (b.date === date && b.employeeId) load[b.employeeId] = (load[b.employeeId] ?? 0) + 1;
    return load;
  }
  const rows = await prisma.booking.groupBy({ by: ['employeeId'], where: { date, employeeId: { not: null } }, _count: true });
  for (const r of rows) if (r.employeeId) load[r.employeeId] = r._count;
  return load;
}

export async function assignEmployee(ref: string, employeeId: string, employeeName: string): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings.find((x) => x.ref === ref);
    if (b) { b.employeeId = employeeId; b.employeeName = employeeName; }
    return;
  }
  await prisma.booking.update({ where: { ref }, data: { employeeId } });
}

export async function updateBookingStatus(ref: string, status: BookingStatus): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const b = memory.bookings.find((x) => x.ref === ref);
    if (b) b.status = status;
    return;
  }
  await prisma.booking.update({ where: { ref }, data: { status } });
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
    employeeId: b.employeeId ?? null,
    employeeName: b.employee?.name ?? null,
  };
}

