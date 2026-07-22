import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe via REST (no SDK dependency; consistent with our other integrations).
 * Env-gated: dry-run without STRIPE_SECRET_KEY. Because our model charges after
 * the service, we create a hosted invoice due shortly after booking.
 */
export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

const API = 'https://api.stripe.com/v1';

async function stripe(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path} ${res.status}: ${data?.error?.message ?? 'error'}`);
  return data;
}

export interface StripeInvoiceResult {
  invoiceId: string;
  hostedUrl: string | null;
  amount: number; // cents
}

export async function createInvoiceForBooking(p: {
  ref: string;
  email: string;
  name: string;
  serviceName: string;
  amount: number; // USD dollars
}): Promise<StripeInvoiceResult | null> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') console.log(`[stripe] (dry-run) invoice for ${p.ref}: $${p.amount}`);
    return null;
  }

  const cents = Math.round(p.amount * 100);
  const customer = await stripe('/customers', { email: p.email, name: p.name, 'metadata[ref]': p.ref });
  await stripe('/invoiceitems', {
    customer: customer.id,
    amount: String(cents),
    currency: 'usd',
    description: `${p.serviceName} — Homigo booking ${p.ref}`,
  });
  const invoice = await stripe('/invoices', {
    customer: customer.id,
    collection_method: 'send_invoice',
    days_until_due: '1',
    'metadata[ref]': p.ref,
  });
  const finalized = await stripe(`/invoices/${invoice.id}/finalize`, {});

  return {
    invoiceId: finalized.id,
    hostedUrl: finalized.hosted_invoice_url ?? null,
    amount: cents,
  };
}

/** Verifies a Stripe webhook signature (t=,v1= scheme) without the SDK. */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => kv.split('=') as [string, string]),
  );
  const timestamp = parts['t'];
  const sig = parts['v1'];
  if (!timestamp || !sig) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
