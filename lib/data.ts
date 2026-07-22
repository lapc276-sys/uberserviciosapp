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
    include: { customer: true, address: true },
  });
  return rows.map((b) => ({
    id: b.id,
    ref: b.ref,
    serviceSlug: b.serviceSlug,
    serviceName: b.serviceName,
    bedrooms: b.bedrooms,
    bathrooms: b.bathrooms,
    sqft: b.sqft,
    frequency: b.frequency as Frequency,
    date: b.date,
    time: b.time,
    quoteLow: b.quoteLow,
    quoteHigh: b.quoteHigh,
    status: b.status as BookingStatus,
    notes: b.notes,
    customerName: b.customer.name,
    customerEmail: b.customer.email,
    customerPhone: b.customer.phone,
    city: b.address?.city ?? '—',
    address: b.address?.line1 ?? '—',
    createdAt: b.createdAt.toISOString(),
  }));
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
