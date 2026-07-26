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

  console.log('✅ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
