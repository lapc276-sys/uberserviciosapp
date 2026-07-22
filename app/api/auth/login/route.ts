import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { verifyCredentials } from '@/lib/auth-password';
import { createSessionToken, sessionCookieOptions } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid email and password' }, { status: 422 });
  }

  const session = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!session) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken(session);
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions, value: token });

  return NextResponse.json({ ok: true, role: session.role });
}
