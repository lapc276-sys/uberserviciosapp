import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, can } from '@/lib/auth';
import {
  createTimeModelVersion,
  activateTimeModelVersion,
  listTimeModelVersions,
  DEFAULT_MARKET,
} from '@/lib/vision/time-model-store';

export const runtime = 'nodejs';

/**
 * Editing the live pricing model.
 *
 * Gated on `settings:manage`, which only ADMIN holds — a dispatcher can move a
 * booking around, but changing what every future job costs is a different kind
 * of authority and deliberately a narrower one.
 */
const REQUIRED_PERMISSION = 'settings:manage';

const createSchema = z.object({
  market: z.string().max(60).optional(),
  params: z.record(z.unknown()),
  note: z.string().max(500).optional(),
  activate: z.boolean().optional(),
  basedOnSamples: z.number().int().min(0).optional(),
  basedOnBiasPct: z.number().optional(),
});

const activateSchema = z.object({ id: z.string().min(1) });

export async function GET(req: Request) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, REQUIRED_PERMISSION)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const market = new URL(req.url).searchParams.get('market') ?? DEFAULT_MARKET;
  return NextResponse.json({ versions: await listTimeModelVersions(market) });
}

export async function POST(req: Request) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, REQUIRED_PERMISSION)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 });
  }

  const version = await createTimeModelVersion({
    ...parsed.data,
    // Recorded rather than taken from the request: who changed pricing is not
    // something the client gets to assert.
    createdBy: session.email,
  });

  if (!version) {
    return NextResponse.json(
      { error: 'Calibration needs a database. Set DATABASE_URL to store model versions.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ version }, { status: 201 });
}

/** Activates an existing version — the explicit second step after review. */
export async function PATCH(req: Request) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session || !can(session.role, REQUIRED_PERMISSION)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = activateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 });

  const version = await activateTimeModelVersion(parsed.data.id);
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 });

  return NextResponse.json({ version });
}
