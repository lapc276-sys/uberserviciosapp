import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import { createTenant, listTenants } from '@/lib/tenants/store';

export const runtime = 'nodejs';

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  contactEmail: z.string().email(),
  plan: z.enum(['trial', 'starter', 'growth', 'scale']).default('trial'),
  pricing: z
    .object({
      hourlyRate: z.number().positive().max(10_000),
      minimumJob: z.number().nonnegative().max(100_000),
      laborCostRate: z.number().nonnegative().max(10_000),
      currency: z.string().length(3).toUpperCase(),
      taxRate: z.number().min(0).max(1),
      taxAppliesTo: z.enum(['all', 'commercial', 'none']),
      taxNote: z.string().max(300).optional(),
      supplyCostMultiplier: z.number().positive().max(20),
    })
    .partial()
    .optional(),
});

export async function GET() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, 'settings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ tenants: await listTenants() });
}

export async function POST(req: Request) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, 'settings:manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 422 },
    );
  }

  const result = await createTenant(parsed.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 422 });

  // The raw key crosses the wire exactly once, here. It is not stored in a
  // recoverable form, so the UI must make the operator copy it now.
  return NextResponse.json({ tenant: result.tenant, apiKey: result.apiKey }, { status: 201 });
}
