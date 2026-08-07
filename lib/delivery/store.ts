import { prisma, isDbConfigured } from '../db';
import type {
  AccessObservation,
  BuildingProfile,
  CounterObservation,
  CourierState,
  ElevatorState,
  EntryType,
  HandoffType,
  MerchantProfile,
  ParkingDifficulty,
  PrepObservation,
  TravelMode,
} from './types';
import type { JobOutcome } from './metrics';

/**
 * Data access for the delivery engine. One API, two backends — Prisma when
 * DATABASE_URL is set, an in-memory store otherwise — matching lib/data.ts.
 *
 * The in-memory path is not a toy. It ships with a small seeded market so the
 * engine, the admin view and the simulator all run with zero infrastructure,
 * which is what makes the model arguable before anyone has bought a database.
 */

export type DeliveryOrderStatus =
  | 'NEW'
  | 'SCHEDULED'
  | 'PICKED_UP'
  | 'AT_MERCHANT'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELED';

export type PaymentState = 'AWAITING_CARD' | 'CARD_ON_FILE' | 'NEEDS_CONFIRMATION' | 'PAID' | 'FAILED';

export interface DeliveryOrderRecord {
  id: string;
  ref: string;
  vertical: string;
  status: DeliveryOrderStatus;
  channel: string;
  merchantId: string;
  buildingId: string | null;
  courierId: string | null;

  customerName: string | null;
  customerPhone: string;
  customerEmail: string | null;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  floor: number | null;
  handoff: HandoffType;
  items: number;
  notes: string | null;

  placedAt: string;
  promisedReadyAt: string | null;

  estimateLow: number | null;
  estimateHigh: number | null;
  weighedPounds: number | null;
  finalTotal: number | null;
  courierPay: number | null;
  merchantPayout: number | null;
  platformTake: number | null;

  paymentState: PaymentState;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  stripePaymentIntentId: string | null;
  confirmUrl: string | null;
  cardLinkSentAt: string | null;
  paidAt: string | null;
}

export interface CourierRecord {
  id: string;
  name: string;
  phone: string | null;
  mode: TravelMode;
  status: string;
  location: { lat: number; lng: number } | null;
  paceFactor: number;
  stripeAccountId: string | null;
}

// ── In-memory market ─────────────────────────────────────────────────────────
// Seeded so everything downstream is demonstrable with no database and no keys.

const memMerchants: MerchantProfile[] = [
  {
    id: 'm_sudz',
    name: 'Sudz Laundromat — Little Havana',
    vertical: 'laundry',
    location: { lat: 25.7651, lng: -80.2201 },
    parking: 'moderate',
    quotedPrepMinutes: 180,
    quotedCounterMinutes: 2.4,
    ratePerPound: 1.85,
  },
  {
    id: 'm_brickell',
    name: 'Brickell Wash & Fold',
    vertical: 'laundry',
    location: { lat: 25.7607, lng: -80.1935 },
    parking: 'hard',
    quotedPrepMinutes: 240,
    quotedCounterMinutes: 3.1,
    ratePerPound: 2.25,
  },
];

const memBuildings: BuildingProfile[] = [
  {
    id: 'b_flagler_183',
    label: '183 W Flagler St',
    location: { lat: 25.7742, lng: -80.1962 },
    floors: 6,
    elevator: 'yes',
    entry: 'locked_lobby',
    parking: 'moderate',
    notes: 'Loading zone on the north side.',
  },
  {
    id: 'b_sw8_241',
    label: '241 SW 8th St',
    location: { lat: 25.7663, lng: -80.2072 },
    floors: 5,
    elevator: 'no',
    entry: 'buzzer',
    parking: 'hard',
    notes: 'Walk-up. Buzzer is unreliable.',
  },
  {
    id: 'b_brickell_tower',
    label: '1100 Brickell Bay Dr',
    location: { lat: 25.7589, lng: -80.1897 },
    floors: 20,
    elevator: 'yes',
    entry: 'doorman',
    parking: 'hard',
    notes: 'Sign in at the desk; couriers use the service elevator.',
  },
  {
    id: 'b_coral_way',
    label: '2900 Coral Way',
    location: { lat: 25.75, lng: -80.2385 },
    floors: 3,
    elevator: 'unknown',
    entry: 'unknown',
    parking: 'easy',
    notes: null,
  },
];

const memCouriers: CourierRecord[] = [
  { id: 'c_luis', name: 'Luis', phone: null, mode: 'scooter', status: 'APPROVED', location: { lat: 25.7689, lng: -80.2015 }, paceFactor: 0.92, stripeAccountId: null },
  { id: 'c_maria', name: 'María', phone: null, mode: 'car', status: 'APPROVED', location: { lat: 25.7601, lng: -80.2, }, paceFactor: 1.0, stripeAccountId: null },
  { id: 'c_dee', name: 'Dee', phone: null, mode: 'ebike', status: 'APPROVED', location: { lat: 25.7725, lng: -80.1994 }, paceFactor: 1.05, stripeAccountId: null },
];

const memOrders: DeliveryOrderRecord[] = [];
const memPrep: PrepObservation[] = [];
const memCounter: CounterObservation[] = [];
const memAccess: AccessObservation[] = [];
const memOutcomes: JobOutcome[] = [];

// ── Merchants ────────────────────────────────────────────────────────────────

export async function listMerchants(): Promise<MerchantProfile[]> {
  if (!isDbConfigured || !prisma) return memMerchants;
  const rows = await prisma.deliveryMerchant.findMany({ where: { active: true } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    vertical: r.vertical,
    location: { lat: r.lat, lng: r.lng },
    parking: r.parking as ParkingDifficulty,
    quotedPrepMinutes: r.quotedPrepMinutes,
    quotedCounterMinutes: r.quotedCounterMinutes ?? undefined,
    ratePerPound: r.ratePerPound,
    stripeAccountId: r.stripeAccountId,
  }));
}

export async function getMerchant(id: string): Promise<MerchantProfile | null> {
  const all = await listMerchants();
  return all.find((m) => m.id === id) ?? null;
}

// ── Buildings ────────────────────────────────────────────────────────────────

export async function listBuildings(): Promise<BuildingProfile[]> {
  if (!isDbConfigured || !prisma) return memBuildings;
  const rows = await prisma.deliveryBuilding.findMany();
  return rows.map(toBuildingProfile);
}

export async function getBuilding(id: string): Promise<BuildingProfile | null> {
  const all = await listBuildings();
  return all.find((b) => b.id === id) ?? null;
}

function toBuildingProfile(r: {
  id: string;
  label: string;
  lat: number;
  lng: number;
  floors: number | null;
  elevator: string;
  entry: string;
  parking: string;
  notes: string | null;
}): BuildingProfile {
  return {
    id: r.id,
    label: r.label,
    location: { lat: r.lat, lng: r.lng },
    floors: r.floors,
    elevator: r.elevator as ElevatorState,
    entry: r.entry as EntryType,
    parking: r.parking as ParkingDifficulty,
    notes: r.notes,
  };
}

/**
 * Finds the building for an address, creating a bare record when it is new.
 *
 * Deliberately permissive: an unknown building with null floors is still worth
 * creating, because the *next* delivery to that address will attach an
 * observation to it. A building record that starts empty and fills itself in is
 * the entire learning mechanism.
 */
export async function upsertBuilding(input: {
  label: string;
  lat: number;
  lng: number;
  floors?: number | null;
  elevator?: ElevatorState;
  entry?: EntryType;
  parking?: ParkingDifficulty;
}): Promise<BuildingProfile> {
  const label = input.label.trim();

  if (!isDbConfigured || !prisma) {
    const existing = memBuildings.find((b) => b.label.toLowerCase() === label.toLowerCase());
    if (existing) {
      if (input.floors != null && existing.floors == null) existing.floors = input.floors;
      if (input.elevator && existing.elevator === 'unknown') existing.elevator = input.elevator;
      if (input.entry && existing.entry === 'unknown') existing.entry = input.entry;
      return existing;
    }
    const created: BuildingProfile = {
      id: `b_${Math.random().toString(36).slice(2, 9)}`,
      label,
      location: { lat: input.lat, lng: input.lng },
      floors: input.floors ?? null,
      elevator: input.elevator ?? 'unknown',
      entry: input.entry ?? 'unknown',
      parking: input.parking ?? 'unknown',
      notes: null,
    };
    memBuildings.push(created);
    return created;
  }

  const row = await prisma.deliveryBuilding.upsert({
    where: { label },
    create: {
      label,
      lat: input.lat,
      lng: input.lng,
      floors: input.floors ?? null,
      elevator: input.elevator ?? 'unknown',
      entry: input.entry ?? 'unknown',
      parking: input.parking ?? 'unknown',
    },
    update: {
      // Never overwrite learned structure with a blank from a new order.
      ...(input.floors != null ? { floors: input.floors } : {}),
      ...(input.elevator && input.elevator !== 'unknown' ? { elevator: input.elevator } : {}),
      ...(input.entry && input.entry !== 'unknown' ? { entry: input.entry } : {}),
    },
  });
  return toBuildingProfile(row);
}

/** Applied when the engine resolves an unknown from timing data. */
export async function setBuildingElevator(id: string, elevator: ElevatorState): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const b = memBuildings.find((x) => x.id === id);
    if (b) b.elevator = elevator;
    return;
  }
  await prisma.deliveryBuilding.update({ where: { id }, data: { elevator } });
}

// ── Couriers ─────────────────────────────────────────────────────────────────

export async function listCouriers(): Promise<CourierRecord[]> {
  if (!isDbConfigured || !prisma) return memCouriers;
  const rows = await prisma.courier.findMany({ where: { status: 'APPROVED' } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    mode: r.mode as TravelMode,
    status: r.status,
    location: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null,
    paceFactor: r.paceFactor,
    stripeAccountId: r.stripeAccountId,
  }));
}

export async function setCourierPace(id: string, paceFactor: number): Promise<void> {
  if (!isDbConfigured || !prisma) {
    const c = memCouriers.find((x) => x.id === id);
    if (c) c.paceFactor = paceFactor;
    return;
  }
  await prisma.courier.update({ where: { id }, data: { paceFactor } });
}

/**
 * A courier record plus what they are doing right now. `freeInMinutes` is live
 * state the dispatcher supplies (from the courier app); it is not persisted,
 * because a stale "free in 4 minutes" is worse than no answer.
 */
export function toCourierState(
  record: CourierRecord,
  live: { freeInMinutes?: number; activeJobs?: number; location?: { lat: number; lng: number }; freeAt?: { lat: number; lng: number } } = {},
): CourierState {
  const location = live.location ?? record.location ?? { lat: 0, lng: 0 };
  return {
    id: record.id,
    name: record.name,
    mode: record.mode,
    location,
    freeAt: live.freeAt ?? location,
    freeInMinutes: live.freeInMinutes ?? 0,
    paceFactor: record.paceFactor,
    activeJobs: live.activeJobs ?? 0,
    phone: record.phone,
  };
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  merchantId: string;
  buildingId?: string | null;
  channel?: string;
  vertical?: string;
  customerName?: string | null;
  customerPhone: string;
  customerEmail?: string | null;
  addressLine: string;
  lat?: number | null;
  lng?: number | null;
  floor?: number | null;
  handoff?: HandoffType;
  items?: number;
  notes?: string | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  promisedReadyAt?: string | null;
}

export function newOrderRef(): string {
  return `LND-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
}

export async function createOrder(input: CreateOrderInput): Promise<DeliveryOrderRecord> {
  const ref = newOrderRef();
  const base: DeliveryOrderRecord = {
    id: ref,
    ref,
    vertical: input.vertical ?? 'laundry',
    status: 'NEW',
    channel: input.channel ?? 'sms',
    merchantId: input.merchantId,
    buildingId: input.buildingId ?? null,
    courierId: null,
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail ?? null,
    addressLine: input.addressLine,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    floor: input.floor ?? null,
    handoff: input.handoff ?? 'hand_to_customer',
    items: input.items ?? 1,
    notes: input.notes ?? null,
    placedAt: new Date().toISOString(),
    promisedReadyAt: input.promisedReadyAt ?? null,
    estimateLow: input.estimateLow ?? null,
    estimateHigh: input.estimateHigh ?? null,
    weighedPounds: null,
    finalTotal: null,
    courierPay: null,
    merchantPayout: null,
    platformTake: null,
    paymentState: 'AWAITING_CARD',
    stripeCustomerId: null,
    stripePaymentMethodId: null,
    stripePaymentIntentId: null,
    confirmUrl: null,
    cardLinkSentAt: null,
    paidAt: null,
  };

  if (!isDbConfigured || !prisma) {
    memOrders.unshift(base);
    return base;
  }

  const row = await prisma.deliveryOrder.create({
    data: {
      ref,
      vertical: base.vertical,
      channel: base.channel,
      merchantId: input.merchantId,
      buildingId: input.buildingId ?? null,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail ?? null,
      addressLine: input.addressLine,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      floor: input.floor ?? null,
      handoff: base.handoff,
      items: base.items,
      notes: input.notes ?? null,
      estimateLow: input.estimateLow ?? null,
      estimateHigh: input.estimateHigh ?? null,
      promisedReadyAt: input.promisedReadyAt ? new Date(input.promisedReadyAt) : null,
    },
  });
  return toOrderRecord(row);
}

export async function getOrder(ref: string): Promise<DeliveryOrderRecord | null> {
  if (!isDbConfigured || !prisma) return memOrders.find((o) => o.ref === ref) ?? null;
  const row = await prisma.deliveryOrder.findUnique({ where: { ref } });
  return row ? toOrderRecord(row) : null;
}

export async function listOrders(opts: { status?: DeliveryOrderStatus; limit?: number } = {}): Promise<DeliveryOrderRecord[]> {
  const limit = opts.limit ?? 50;
  if (!isDbConfigured || !prisma) {
    return memOrders.filter((o) => !opts.status || o.status === opts.status).slice(0, limit);
  }
  const rows = await prisma.deliveryOrder.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { placedAt: 'desc' },
    take: limit,
  });
  return rows.map(toOrderRecord);
}

export type OrderPatch = Partial<
  Pick<
    DeliveryOrderRecord,
    | 'status'
    | 'courierId'
    | 'buildingId'
    | 'floor'
    | 'weighedPounds'
    | 'finalTotal'
    | 'courierPay'
    | 'merchantPayout'
    | 'platformTake'
    | 'paymentState'
    | 'stripeCustomerId'
    | 'stripePaymentMethodId'
    | 'stripePaymentIntentId'
    | 'confirmUrl'
    | 'cardLinkSentAt'
    | 'paidAt'
    | 'promisedReadyAt'
    | 'lat'
    | 'lng'
  >
>;

export async function updateOrder(ref: string, patch: OrderPatch): Promise<DeliveryOrderRecord | null> {
  if (!isDbConfigured || !prisma) {
    const order = memOrders.find((o) => o.ref === ref);
    if (!order) return null;
    Object.assign(order, patch);
    return order;
  }

  const row = await prisma.deliveryOrder.update({
    where: { ref },
    data: {
      ...patch,
      ...(patch.cardLinkSentAt ? { cardLinkSentAt: new Date(patch.cardLinkSentAt) } : {}),
      ...(patch.paidAt ? { paidAt: new Date(patch.paidAt) } : {}),
      ...(patch.promisedReadyAt ? { promisedReadyAt: new Date(patch.promisedReadyAt) } : {}),
    },
  });
  return toOrderRecord(row);
}

function toOrderRecord(r: any): DeliveryOrderRecord {
  return {
    id: r.id,
    ref: r.ref,
    vertical: r.vertical,
    status: r.status as DeliveryOrderStatus,
    channel: r.channel,
    merchantId: r.merchantId,
    buildingId: r.buildingId,
    courierId: r.courierId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    addressLine: r.addressLine,
    lat: r.lat,
    lng: r.lng,
    floor: r.floor,
    handoff: r.handoff as HandoffType,
    items: r.items,
    notes: r.notes,
    placedAt: r.placedAt.toISOString(),
    promisedReadyAt: r.promisedReadyAt?.toISOString() ?? null,
    estimateLow: r.estimateLow,
    estimateHigh: r.estimateHigh,
    weighedPounds: r.weighedPounds,
    finalTotal: r.finalTotal,
    courierPay: r.courierPay,
    merchantPayout: r.merchantPayout,
    platformTake: r.platformTake,
    paymentState: r.paymentState as PaymentState,
    stripeCustomerId: r.stripeCustomerId,
    stripePaymentMethodId: r.stripePaymentMethodId,
    stripePaymentIntentId: r.stripePaymentIntentId,
    confirmUrl: r.confirmUrl,
    cardLinkSentAt: r.cardLinkSentAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
  };
}

// ── Observations: the part that makes the engine smarter ─────────────────────

export async function recordPrepObservation(o: PrepObservation): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memPrep.push(o);
    return;
  }
  await prisma.prepObservation.create({
    data: { merchantId: o.merchantId, weekday: o.weekday, hour: o.hour, minutes: o.minutes, at: new Date(o.at) },
  });
}

export async function recordCounterObservation(o: CounterObservation): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memCounter.push(o);
    return;
  }
  await prisma.counterObservation.create({
    data: { merchantId: o.merchantId, seconds: o.seconds, at: new Date(o.at) },
  });
}

export async function recordAccessObservation(o: AccessObservation): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memAccess.push(o);
    return;
  }
  await prisma.accessObservation.create({
    data: {
      buildingId: o.buildingId,
      floor: o.floor,
      seconds: o.seconds,
      usedElevator: o.usedElevator,
      at: new Date(o.at),
    },
  });
}

export async function listPrepObservations(merchantId?: string): Promise<PrepObservation[]> {
  if (!isDbConfigured || !prisma) {
    return memPrep.filter((o) => !merchantId || o.merchantId === merchantId);
  }
  const rows = await prisma.prepObservation.findMany({ where: merchantId ? { merchantId } : undefined, take: 5000 });
  return rows.map((r) => ({ merchantId: r.merchantId, weekday: r.weekday, hour: r.hour, minutes: r.minutes, at: r.at.toISOString() }));
}

export async function listCounterObservations(merchantId?: string): Promise<CounterObservation[]> {
  if (!isDbConfigured || !prisma) {
    return memCounter.filter((o) => !merchantId || o.merchantId === merchantId);
  }
  const rows = await prisma.counterObservation.findMany({ where: merchantId ? { merchantId } : undefined, take: 5000 });
  return rows.map((r) => ({ merchantId: r.merchantId, seconds: r.seconds, at: r.at.toISOString() }));
}

export async function listAccessObservations(buildingId?: string): Promise<AccessObservation[]> {
  if (!isDbConfigured || !prisma) {
    return memAccess.filter((o) => !buildingId || o.buildingId === buildingId);
  }
  const rows = await prisma.accessObservation.findMany({ where: buildingId ? { buildingId } : undefined, take: 5000 });
  return rows.map((r) => ({
    buildingId: r.buildingId,
    floor: r.floor,
    seconds: r.seconds,
    usedElevator: r.usedElevator,
    at: r.at.toISOString(),
  }));
}

// ── Outcomes: predicted vs. actual ───────────────────────────────────────────

export async function recordOutcome(outcome: JobOutcome): Promise<void> {
  if (!isDbConfigured || !prisma) {
    memOutcomes.unshift(outcome);
    return;
  }
  const order = await prisma.deliveryOrder.findUnique({ where: { ref: outcome.ref } });
  if (!order) return;
  await prisma.deliveryOutcome.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      courierId: order.courierId,
      predictedTotalMinutes: outcome.predictedTotalMinutes,
      actualTotalMinutes: outcome.actualTotalMinutes,
      predicted: outcome.predicted as unknown as object,
      actual: outcome.actual as unknown as object,
      idleGapMinutes: outcome.idleGapMinutes,
    },
    update: {
      predictedTotalMinutes: outcome.predictedTotalMinutes,
      actualTotalMinutes: outcome.actualTotalMinutes,
      predicted: outcome.predicted as unknown as object,
      actual: outcome.actual as unknown as object,
      idleGapMinutes: outcome.idleGapMinutes,
    },
  });
}

export async function listOutcomes(limit = 500): Promise<JobOutcome[]> {
  if (!isDbConfigured || !prisma) return memOutcomes.slice(0, limit);
  const rows = await prisma.deliveryOutcome.findMany({
    orderBy: { completedAt: 'desc' },
    take: limit,
    include: { order: true },
  });
  return rows.map((r) => ({
    ref: r.order.ref,
    courierId: r.courierId ?? '',
    merchantId: r.order.merchantId,
    buildingId: r.order.buildingId,
    predicted: r.predicted as any,
    actual: r.actual as any,
    predictedTotalMinutes: r.predictedTotalMinutes,
    actualTotalMinutes: r.actualTotalMinutes,
    idleGapMinutes: r.idleGapMinutes,
    completedAt: r.completedAt.toISOString(),
  }));
}
