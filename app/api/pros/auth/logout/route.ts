import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PRO_SESSION_COOKIE } from '@/lib/pro-auth';

export const runtime = 'nodejs';

export async function POST() {
  const jar = await cookies();
  jar.delete(PRO_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
