import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProByEmail } from '@/lib/data';
import { createMagicToken } from '@/lib/pro-auth';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { site } from '@/lib/config/site';

export const runtime = 'nodejs';

const schema = z.object({ email: z.string().email() });

/**
 * Sends a passwordless sign-in link.
 *
 * Always responds 200 regardless of whether the email belongs to a pro — an
 * enumerable endpoint would let anyone probe which cleaners work for us.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 422 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const pro = await getProByEmail(email);

  // Only approved pros get a working link; everyone gets the same response.
  if (pro && pro.status === 'APPROVED') {
    const token = await createMagicToken(email);
    const link = `${site.url}/api/pros/auth/verify?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: email,
      subject: `Your ${site.name} sign-in link`,
      html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h1 style="font-size:20px">Sign in to ${site.name} Pro</h1>
        <p style="color:#4b5563">Tap the button below to open your jobs. This link works once and expires in 15 minutes.</p>
        <a href="${link}" style="display:inline-block;margin-top:16px;background:#1b6ff5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Open my jobs</a>
        <p style="color:#9ca3af;font-size:12px;margin-top:20px">If you didn't request this, you can ignore it.</p>
      </div>`,
    });

    if (pro.phone) {
      await sendSms(pro.phone, `${site.name}: your sign-in link (expires in 15 min): ${link}`);
    }
  }

  return NextResponse.json({
    ok: true,
    message: 'If that email belongs to an approved pro, a sign-in link is on its way.',
  });
}
