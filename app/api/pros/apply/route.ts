import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createProApplication, createLead } from '@/lib/data';
import { cities } from '@/lib/config/cities';

export const runtime = 'nodejs';

const citySlugs = cities.map((c) => c.slug);

const schema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(30),
  serviceAreas: z.array(z.string()).min(1).max(20).refine(
    (areas) => areas.every((a) => citySlugs.includes(a)),
    { message: 'Unknown service area' },
  ),
  yearsExperience: z.coerce.number().min(0).max(60),
  hasTransport: z.boolean().default(false),
  bio: z.string().max(1000).optional(),
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
    return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 422 });
  }

  const result = await createProApplication(parsed.data);
  if (!result.ok && result.duplicate) {
    return NextResponse.json(
      { error: 'An application with that email already exists. We’ll be in touch soon.' },
      { status: 409 },
    );
  }

  await createLead({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    source: 'pro_application',
    message: `Pro application · ${parsed.data.yearsExperience}y experience · ${parsed.data.serviceAreas.join(', ')}`,
  });

  return NextResponse.json({ ok: true });
}
