/**
 * Seeds an admin user, a few employees and sample bookings.
 * Run with: npm run db:seed  (requires DATABASE_URL)
 */
import { PrismaClient } from '@prisma/client';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase() ?? 'admin@homigo.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, name: 'Administrator', role: 'ADMIN', passwordHash: await hash(adminPassword) },
  });

  const pros = [
    { name: 'Maria G.', email: 'maria@homigo.com', rating: 4.9, serviceAreas: ['manhattan-ny', 'brooklyn-ny'], yearsExperience: 6, hasTransport: true },
    { name: 'Carlos R.', email: 'carlos@homigo.com', rating: 4.8, serviceAreas: ['brooklyn-ny', 'queens-ny'], yearsExperience: 4, hasTransport: true },
    { name: 'Aisha K.', email: 'aisha@homigo.com', rating: 5, serviceAreas: ['manhattan-ny', 'queens-ny', 'bronx-ny'], yearsExperience: 8, hasTransport: false },
  ];
  for (const p of pros) {
    await prisma.pro.upsert({
      where: { email: p.email },
      update: {},
      create: { ...p, status: 'APPROVED' },
    });
  }

  const customer = await prisma.customer.upsert({
    where: { email: 'sample@customer.com' },
    update: {},
    create: {
      name: 'A. Rivera',
      email: 'sample@customer.com',
      phone: '+1 (555) 010-1010',
      addresses: { create: { line1: '100 Broadway', city: 'Manhattan', region: 'NY', postalCode: '10005' } },
    },
    include: { addresses: true },
  });

  await prisma.booking.upsert({
    where: { ref: 'HMG-SEED01' },
    update: {},
    create: {
      ref: 'HMG-SEED01',
      serviceSlug: 'deep-cleaning',
      serviceName: 'Deep Cleaning',
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1400,
      frequency: 'ONE_TIME',
      date: new Date().toISOString().split('T')[0],
      time: '10:00 AM',
      quoteLow: 189,
      quoteHigh: 240,
      status: 'SCHEDULED',
      customerId: customer.id,
      addressId: customer.addresses[0]?.id,
    },
  });

  // ── Delivery engine: a small market so /admin/delivery isn't empty ────────
  // Buildings are seeded with what a dispatcher could plausibly know on day
  // one — including "elevator unknown", which the engine resolves from timings.
  const merchants = [
    { slug: 'sudz-little-havana', name: 'Sudz Laundromat — Little Havana', lat: 25.7651, lng: -80.2201, parking: 'moderate', quotedPrepMinutes: 180, quotedCounterMinutes: 2.4 },
    { slug: 'brickell-wash-fold', name: 'Brickell Wash & Fold', lat: 25.7607, lng: -80.1935, parking: 'hard', quotedPrepMinutes: 240, quotedCounterMinutes: 3.1 },
  ];
  for (const m of merchants) {
    await prisma.deliveryMerchant.upsert({ where: { slug: m.slug }, update: {}, create: m });
  }

  const buildings = [
    { label: '183 W Flagler St', lat: 25.7742, lng: -80.1962, floors: 6, elevator: 'yes', entry: 'locked_lobby', parking: 'moderate' },
    { label: '241 SW 8th St', lat: 25.7663, lng: -80.2072, floors: 5, elevator: 'no', entry: 'buzzer', parking: 'hard', notes: 'Walk-up. Buzzer is unreliable.' },
    { label: '1100 Brickell Bay Dr', lat: 25.7589, lng: -80.1897, floors: 20, elevator: 'yes', entry: 'doorman', parking: 'hard' },
    { label: '2900 Coral Way', lat: 25.75, lng: -80.2385, floors: 3, elevator: 'unknown', entry: 'unknown', parking: 'easy' },
  ];
  for (const b of buildings) {
    await prisma.deliveryBuilding.upsert({ where: { label: b.label }, update: {}, create: b });
  }

  const couriers = [
    { name: 'Luis', email: 'luis@homigo.com', mode: 'scooter', lat: 25.7689, lng: -80.2015 },
    { name: 'María', email: 'maria.d@homigo.com', mode: 'car', lat: 25.7601, lng: -80.2 },
    { name: 'Dee', email: 'dee@homigo.com', mode: 'ebike', lat: 25.7725, lng: -80.1994 },
  ];
  for (const c of couriers) {
    await prisma.courier.upsert({ where: { email: c.email }, update: {}, create: { ...c, status: 'APPROVED' } });
  }

  console.log('✅ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
