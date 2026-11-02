import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createTenant, validateSlug } from '@/lib/tenants/store';
import { isDbConfigured } from '@/lib/db';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email';
import { engine } from '@/lib/config/engine';

/**
 * POST /api/tenants/signup — a cleaning company opens its own account.
 *
 * Until now an account could only be created from the admin panel, which meant
 * every customer had to be onboarded by hand. This is the route that makes the
 * engine a product someone can buy at 11pm without talking to anybody.
 *
 * Open signup costs real money: every quote a tenant runs is a vision model
 * call billed to us, so a hundred fake accounts is a hundred times the free
 * allowance. Three defences, none of which needs a human:
 *   - a hard IP rate limit, since scripted signups come in bursts;
 *   - a smaller free allowance than the hand-sold trial;
 *   - a kill switch, so an abusive night can be ended from the dashboard.
 */

export const runtime = 'nodejs';

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Free quotes for an account nobody vetted.
 *
 * Lower than `PLAN_QUOTA.trial` (50) on purpose. A trial we sold to a named
 * company is worth the model spend; an account created by an unknown address
 * at 3am has to prove itself first, and twenty-five quotes is still several
 * real jobs' worth of proof.
 */
const SELF_SERVE_QUOTA = 25;

/** Closed by setting TENANT_SIGNUP_OPEN=false. Open otherwise. */
function signupIsOpen(): boolean {
  return process.env.TENANT_SIGNUP_OPEN !== 'false';
}

/**
 * Best-effort E.164, because Twilio refuses anything else.
 *
 * Ten digits is assumed to be US/Canada, which is where this is being sold;
 * anything already carrying a country code is left alone. A number this cannot
 * make sense of is rejected rather than stored, since a malformed number is a
 * silent failure months later — the alert simply never arrives and nobody
 * knows why.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const schema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de tu empresa.').max(120),
  slug: z.string().trim().toLowerCase(),
  email: z.string().email('Revisa el correo.'),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  hourlyRate: z.number().positive('Pon lo que cobras por hora.').max(10_000),
  minimumJob: z.number().nonnegative().max(100_000),
  currency: z.string().length(3).optional(),
});

export async function POST(req: Request) {
  if (!signupIsOpen()) {
    return NextResponse.json(
      { error: 'closed', message: 'El registro está cerrado por ahora. Escríbenos y te abrimos la cuenta.' },
      { status: 403 },
    );
  }

  /**
   * No database, no signup. This is not caution, it is the only correct answer.
   *
   * A slug is unique because Postgres holds a unique index on it. The
   * in-memory fallback cannot make that promise: it lives inside one server
   * instance, so on any multi-instance host a second company signs up against
   * an empty store, takes a slug the first company already has, and their
   * `/q/<slug>` link quietly starts answering as the newcomer. The first
   * company does not find out — their customers simply arrive at a competitor.
   *
   * Everything else in this app degrades gracefully without a database. This
   * does not, so it refuses instead, and says what is wrong.
   */
  if (!isDbConfigured) {
    return NextResponse.json(
      {
        error: 'no_database',
        message:
          'El registro no está disponible ahora mismo. Escríbenos y te abrimos la cuenta a mano.',
      },
      { status: 503 },
    );
  }

  const limit = rateLimit(`tsignup:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Demasiados intentos. Prueba otra vez en un rato.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Revisa los datos.' },
      { status: 422 },
    );
  }

  const d = parsed.data;

  // Checked here as well as inside createTenant so the caller gets the precise
  // reason — "ese link está reservado" is actionable, "invalid" is not.
  const slugError = validateSlug(d.slug);
  if (slugError) {
    return NextResponse.json({ error: 'invalid_slug', message: slugError }, { status: 422 });
  }

  let phone: string | undefined;
  if (d.phone) {
    const normalized = normalizePhone(d.phone);
    if (!normalized) {
      return NextResponse.json(
        { error: 'invalid_phone', message: 'Ese teléfono no se entiende. Escríbelo con los 10 dígitos.' },
        { status: 422 },
      );
    }
    phone = normalized;
  }

  const result = await createTenant({
    name: d.name,
    slug: d.slug,
    contactEmail: d.email,
    contactPhone: phone,
    plan: 'trial',
    quota: SELF_SERVE_QUOTA,
    pricing: {
      hourlyRate: d.hourlyRate,
      minimumJob: d.minimumJob,
      currency: d.currency ?? 'USD',
    },
    branding: { displayName: d.name },
  });

  if ('error' in result) {
    // A taken slug is the common case and is the caller's to fix, so it is a
    // 409 rather than a 500 — the form re-prompts instead of apologising.
    return NextResponse.json({ error: 'unavailable', message: result.error }, { status: 409 });
  }

  const link = `${engine.url}/q/${result.tenant.slug}`;

  // The key is shown once on screen and is gone; the link is the thing they
  // need for years, so it goes somewhere they can find it again.
  await sendEmail({
    to: d.email,
    subject: `Tu link de presupuestos: ${link}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="font-size:20px;color:#111827">Tu cuenta está lista</h1>
      <p style="color:#4b5563;font-size:14px">Este es tu link. Pégalo en tu Instagram, tu Facebook, tu WhatsApp o tu página:</p>
      <p style="margin:16px 0"><a href="${link}" style="font-size:16px;font-weight:600;color:#1b6ff5">${link}</a></p>
      <p style="color:#4b5563;font-size:14px">Tu cliente entra, graba su casa con el teléfono y ve tu precio. Cuando pida el servicio, te llega un correo a esta misma dirección con sus datos.</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:20px">Tienes ${SELF_SERVE_QUOTA} presupuestos gratis este mes.</p>
    </div>`,
  }).catch(() => {
    // The account exists either way; a failed welcome email is not a failed
    // signup, and the link is on screen in front of them right now.
  });

  return NextResponse.json({
    ok: true,
    slug: result.tenant.slug,
    link,
    // Shown once, never recoverable. The page must make that clear.
    apiKey: result.apiKey,
    freeQuotes: SELF_SERVE_QUOTA,
  });
}
