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

// ── Connect: paying pros ─────────────────────────────────────────────────────

/**
 * Marketplace payouts via Stripe Connect Express.
 *
 * Express accounts put Stripe in charge of identity verification, tax forms
 * (1099s) and bank details — the parts you do not want to hold yourself as a
 * marketplace paying independent contractors across states.
 */
export interface ConnectOnboarding {
  accountId: string;
  onboardingUrl: string;
}

export async function createConnectAccount(pro: {
  email: string;
  name: string;
  existingAccountId?: string | null;
}): Promise<string | null> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') console.log(`[stripe] (dry-run) connect account for ${pro.email}`);
    return null;
  }
  if (pro.existingAccountId) return pro.existingAccountId;

  const account = await stripe('/accounts', {
    type: 'express',
    country: 'US',
    email: pro.email,
    'capabilities[transfers][requested]': 'true',
    'business_type': 'individual',
    'business_profile[product_description]': 'Independent home cleaning services',
  });
  return account.id;
}

/** Hosted onboarding where the pro enters bank + tax details. */
export async function createAccountLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string | null> {
  if (!isStripeConfigured) return null;
  const link = await stripe('/account_links', {
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url ?? null;
}

export interface PayoutAccountStatus {
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export async function getAccountStatus(accountId: string): Promise<PayoutAccountStatus | null> {
  if (!isStripeConfigured) return null;
  try {
    const res = await fetch(`${API}/accounts/${accountId}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) return null;
    const account = await res.json();
    return {
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
    };
  } catch {
    return null;
  }
}

/**
 * Transfers a pro's share for a completed job.
 *
 * `idempotencyKey` is derived from the booking ref so a retry — or a double
 * click on "mark complete" — can never pay the same job twice.
 */
export async function payoutToPro(input: {
  accountId: string;
  amountUsd: number;
  bookingRef: string;
}): Promise<{ id: string } | null> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[stripe] (dry-run) payout $${input.amountUsd} → ${input.accountId} for ${input.bookingRef}`);
    }
    return null;
  }

  const res = await fetch(`${API}/transfers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `payout_${input.bookingRef}`,
    },
    body: new URLSearchParams({
      amount: String(Math.round(input.amountUsd * 100)),
      currency: 'usd',
      destination: input.accountId,
      transfer_group: input.bookingRef,
      'metadata[ref]': input.bookingRef,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[stripe] payout failed', res.status, data?.error?.message);
    return null;
  }
  return { id: data.id };
}

// ── Card on file: charging an amount nobody knows yet ────────────────────────

/**
 * Delivery verticals invert the usual payment order. A laundry customer texts
 * "pick up 3 bags" and the price does not exist until someone puts the bags on
 * a scale — so there is nothing to charge at order time, and an authorization
 * hold is the wrong instrument (it expires, and it cannot be increased past the
 * amount authorized, which is exactly the case that happens).
 *
 * The right instrument is a saved card: collect the payment method up front
 * with a SetupIntent (charging $0), then charge off-session once the real
 * amount is known. Same pattern as a ride ending.
 */
async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path} ${res.status}: ${data?.error?.message ?? 'error'}`);
  return data;
}

export interface CardOnFileSession {
  url: string;
  customerId: string;
  sessionId: string;
}

/**
 * A hosted page where the customer saves a card. Charges nothing.
 * `setup_future_usage` is implicit in setup mode: the resulting payment method
 * is explicitly authorized for later off-session charges, which is what makes
 * charging after the weigh-in legitimate rather than a surprise.
 */
export async function createCardOnFileSession(p: {
  ref: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<CardOnFileSession | null> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') console.log(`[stripe] (dry-run) card-on-file session for ${p.ref}`);
    return null;
  }

  const customerParams: Record<string, string> = { 'metadata[ref]': p.ref };
  if (p.email) customerParams.email = p.email;
  if (p.phone) customerParams.phone = p.phone;
  if (p.name) customerParams.name = p.name;
  const customer = await stripe('/customers', customerParams);

  const session = await stripe('/checkout/sessions', {
    mode: 'setup',
    customer: customer.id,
    'payment_method_types[0]': 'card',
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    'metadata[ref]': p.ref,
  });

  return { url: session.url, customerId: customer.id, sessionId: session.id };
}

/** The saved card, read back after the customer completes the setup page. */
export async function getSavedPaymentMethod(setupIntentId: string): Promise<string | null> {
  if (!isStripeConfigured) return null;
  const intent = await stripeGet(`/setup_intents/${setupIntentId}`);
  return typeof intent.payment_method === 'string' ? intent.payment_method : (intent.payment_method?.id ?? null);
}

export interface OffSessionCharge {
  ok: boolean;
  paymentIntentId: string | null;
  /** Set when the bank demands the customer authenticate. Not a failure — a redirect. */
  requiresAction: boolean;
  error?: string;
}

/**
 * Charges a saved card without the customer present.
 *
 * The idempotency key is derived from the order ref *and* the amount, so a
 * retried request can never double-charge, while a legitimately corrected
 * amount still goes through.
 */
export async function chargeSavedCard(p: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  ref: string;
  description: string;
}): Promise<OffSessionCharge> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[stripe] (dry-run) off-session charge $${(p.amountCents / 100).toFixed(2)} for ${p.ref}`);
    }
    return { ok: false, paymentIntentId: null, requiresAction: false, error: 'stripe_not_configured' };
  }

  const res = await fetch(`${API}/payment_intents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `charge_${p.ref}_${p.amountCents}`,
    },
    body: new URLSearchParams({
      amount: String(p.amountCents),
      currency: 'usd',
      customer: p.customerId,
      payment_method: p.paymentMethodId,
      off_session: 'true',
      confirm: 'true',
      description: p.description,
      transfer_group: p.ref,
      'metadata[ref]': p.ref,
    }),
  });

  const data = await res.json();
  if (res.ok && data.status === 'succeeded') {
    return { ok: true, paymentIntentId: data.id, requiresAction: false };
  }

  const code = data?.error?.code ?? data?.status;
  return {
    ok: false,
    paymentIntentId: data?.error?.payment_intent?.id ?? data?.id ?? null,
    requiresAction: code === 'authentication_required',
    error: data?.error?.message ?? code ?? 'charge failed',
  };
}

/**
 * A hosted page to pay one exact amount. Two jobs: the customer-confirms path
 * when the final price outran the estimate, and the fallback when an
 * off-session charge needs the customer to authenticate.
 */
export async function createPaymentCheckout(p: {
  ref: string;
  amountCents: number;
  description: string;
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[stripe] (dry-run) payment link $${(p.amountCents / 100).toFixed(2)} for ${p.ref}`);
    }
    return null;
  }

  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': p.description,
    'line_items[0][price_data][unit_amount]': String(p.amountCents),
    'line_items[0][quantity]': '1',
    'payment_intent_data[transfer_group]': p.ref,
    'metadata[ref]': p.ref,
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
  };
  if (p.customerId) params.customer = p.customerId;

  const session = await stripe('/checkout/sessions', params);
  return session.url ?? null;
}

/**
 * Generic Connect transfer, used to pay both sides of a delivery order (the
 * merchant for the service, the courier for the trip) out of one charge.
 * The transfer_group ties them back to the payment for reconciliation.
 */
export async function transferTo(p: {
  accountId: string;
  amountCents: number;
  transferGroup: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<{ id: string } | null> {
  if (!isStripeConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[stripe] (dry-run) transfer $${(p.amountCents / 100).toFixed(2)} → ${p.accountId}`);
    }
    return null;
  }

  const body: Record<string, string> = {
    amount: String(p.amountCents),
    currency: 'usd',
    destination: p.accountId,
    transfer_group: p.transferGroup,
  };
  for (const [k, v] of Object.entries(p.metadata ?? {})) body[`metadata[${k}]`] = v;

  const res = await fetch(`${API}/transfers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': p.idempotencyKey,
    },
    body: new URLSearchParams(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[stripe] transfer failed', res.status, data?.error?.message);
    return null;
  }
  return { id: data.id };
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
