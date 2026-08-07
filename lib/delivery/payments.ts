import { site } from '../config/site';
import { sendSms } from '../sms';
import { sendWhatsAppText } from '../whatsapp';
import {
  chargeSavedCard,
  createCardOnFileSession,
  createPaymentCheckout,
  getSavedPaymentMethod,
  isStripeConfigured,
  transferTo,
} from '../stripe';
import { ROUND_TRIP_SURCHARGE, finalLaundryPrice, splitOrder } from './pricing';
import { getMerchant, updateOrder, type DeliveryOrderRecord } from './store';

/**
 * Paying for a delivery order whose price does not exist yet.
 *
 * A laundry customer texts "pick up 3 bags". Nobody — not the customer, not the
 * laundromat, not us — knows what that costs until it is on a scale, which
 * happens *after* a courier has already been paid to drive across town. Three
 * ways to handle that, and only one of them works:
 *
 *   Charge at intake      → you are guessing, and you will be wrong both ways.
 *   Authorization hold    → expires in ~7 days and CANNOT be increased above
 *                           the amount authorized. The overweight bag — the
 *                           exact case this exists for — breaks it.
 *   Card on file (this)   → save the payment method at intake for $0 with a
 *                           SetupIntent, charge off-session once it is weighed.
 *
 * The last one is how a ride ends, and it is right for the same reason. What
 * makes it safe rather than presumptuous is the guardrail below: a final price
 * that outruns the estimate is never charged silently — it goes back to the
 * customer for a "yes". That single rule is the difference between this and a
 * chargeback pipeline.
 */

/** How far past the quoted high end we will charge without asking again. */
export const OVERRUN_TOLERANCE_PCT = 0.2;
export const OVERRUN_TOLERANCE_ABS = 8;

export function overrunsEstimate(estimateHigh: number | null, finalTotal: number): boolean {
  if (estimateHigh == null) return true; // never quoted → always confirm
  const allowed = Math.max(estimateHigh * (1 + OVERRUN_TOLERANCE_PCT), estimateHigh + OVERRUN_TOLERANCE_ABS);
  return finalTotal > allowed;
}

/** SMS or WhatsApp, whichever channel the customer came in on. */
export async function notifyCustomer(order: DeliveryOrderRecord, body: string): Promise<boolean> {
  if (order.channel === 'whatsapp') return sendWhatsAppText(order.customerPhone, body);
  return sendSms(order.customerPhone, body);
}

export interface CardOnFileResult {
  url: string | null;
  sent: boolean;
  reason?: string;
}

/**
 * Step 1 — text the customer a link that saves their card and charges nothing.
 *
 * Sent with the estimate visible. The customer agrees to a *range* and to being
 * charged the real number later; saying that plainly at this moment is what
 * makes the later charge unremarkable.
 */
export async function requestCardOnFile(
  order: DeliveryOrderRecord,
  opts: { notify?: boolean } = {},
): Promise<CardOnFileResult> {
  const estimate =
    order.estimateLow != null && order.estimateHigh != null
      ? `about $${order.estimateLow.toFixed(2)}–$${order.estimateHigh.toFixed(2)}`
      : 'priced by weight';

  const session = await createCardOnFileSession({
    ref: order.ref,
    email: order.customerEmail,
    phone: order.customerPhone,
    name: order.customerName,
    successUrl: `${site.url}/orders/${order.ref}?card=saved`,
    cancelUrl: `${site.url}/orders/${order.ref}?card=canceled`,
  });

  if (!session) {
    return { url: null, sent: false, reason: isStripeConfigured ? 'stripe_error' : 'stripe_not_configured' };
  }

  await updateOrder(order.ref, {
    stripeCustomerId: session.customerId,
    cardLinkSentAt: new Date().toISOString(),
  });

  // Skipped when the caller is already replying in-channel (an inbound SMS
  // answers itself) — two texts carrying the same link is spam, not service.
  const sent =
    opts.notify === false
      ? false
      : await notifyCustomer(
          order,
          `${site.name}: order ${order.ref} received (${estimate}). Save a card to confirm — you're not charged now, only after your laundry is weighed: ${session.url}`,
        );

  return { url: session.url, sent };
}

/** Step 2 — the customer finished the hosted page; keep the payment method. */
export async function attachSavedCard(ref: string, setupIntentId: string): Promise<boolean> {
  const paymentMethodId = await getSavedPaymentMethod(setupIntentId);
  if (!paymentMethodId) return false;
  await updateOrder(ref, { stripePaymentMethodId: paymentMethodId, paymentState: 'CARD_ON_FILE' });
  return true;
}

export interface ChargeResult {
  ok: boolean;
  state: DeliveryOrderRecord['paymentState'];
  amount: number;
  /** Set when the customer has to approve the amount or authenticate. */
  confirmUrl: string | null;
  reason?: string;
}

/**
 * Step 3 — the laundromat weighed it. Charge, or ask.
 *
 * Two paths and the fork between them is the whole design:
 *   within tolerance → charge the saved card off-session, done, no interaction
 *   over tolerance   → send a payment link and wait. We do not take the money.
 */
export async function chargeAfterWeighIn(
  order: DeliveryOrderRecord,
  input: { pounds: number; extras?: number },
): Promise<ChargeResult> {
  // The laundromat's rate, not ours — we only add the delivery surcharge.
  const merchant = await getMerchant(order.merchantId);
  const price = finalLaundryPrice(input.pounds, { merchant, extras: input.extras ?? 0 });
  const finalTotal = price.total;
  const cents = Math.round(finalTotal * 100);

  // `merchantPayout` is recorded now so settlement never has to re-derive which
  // part of the charge was the wash and which part was ours.
  await updateOrder(order.ref, { weighedPounds: input.pounds, finalTotal, merchantPayout: price.wash });

  // ── The guardrail ─────────────────────────────────────────────────────────
  if (overrunsEstimate(order.estimateHigh, finalTotal)) {
    const url = await createPaymentCheckout({
      ref: order.ref,
      amountCents: cents,
      description: `${site.name} laundry ${order.ref} — ${input.pounds} lb`,
      customerId: order.stripeCustomerId,
      successUrl: `${site.url}/orders/${order.ref}?paid=1`,
      cancelUrl: `${site.url}/orders/${order.ref}`,
    });

    await updateOrder(order.ref, { paymentState: 'NEEDS_CONFIRMATION', confirmUrl: url });
    await notifyCustomer(
      order,
      `${site.name}: your laundry weighed ${input.pounds} lb, so the total is $${finalTotal.toFixed(2)} — more than the $${(order.estimateHigh ?? 0).toFixed(2)} we estimated. Approve here and we'll bring it back: ${url ?? `${site.url}/orders/${order.ref}`}`,
    );

    return {
      ok: false,
      state: 'NEEDS_CONFIRMATION',
      amount: finalTotal,
      confirmUrl: url,
      reason: 'final price exceeded the estimate — asked the customer to approve',
    };
  }

  // ── Within tolerance: charge the saved card ───────────────────────────────
  if (!order.stripeCustomerId || !order.stripePaymentMethodId) {
    return { ok: false, state: order.paymentState, amount: finalTotal, confirmUrl: null, reason: 'no card on file' };
  }

  const charge = await chargeSavedCard({
    customerId: order.stripeCustomerId,
    paymentMethodId: order.stripePaymentMethodId,
    amountCents: cents,
    ref: order.ref,
    description: `${site.name} laundry ${order.ref} — ${input.pounds} lb`,
  });

  if (charge.ok) {
    await updateOrder(order.ref, {
      paymentState: 'PAID',
      stripePaymentIntentId: charge.paymentIntentId,
      paidAt: new Date().toISOString(),
    });
    await notifyCustomer(
      order,
      `${site.name}: ${input.pounds} lb washed and folded — $${finalTotal.toFixed(2)} charged to your card. It's on the way back to you.`,
    );
    return { ok: true, state: 'PAID', amount: finalTotal, confirmUrl: null };
  }

  // The bank wants the customer present (3-D Secure), or the card failed.
  // Either way the answer is the same: a link, not a retry loop.
  const url = await createPaymentCheckout({
    ref: order.ref,
    amountCents: cents,
    description: `${site.name} laundry ${order.ref} — ${input.pounds} lb`,
    customerId: order.stripeCustomerId,
    successUrl: `${site.url}/orders/${order.ref}?paid=1`,
    cancelUrl: `${site.url}/orders/${order.ref}`,
  });

  const state = charge.requiresAction ? 'NEEDS_CONFIRMATION' : 'FAILED';
  await updateOrder(order.ref, { paymentState: state, confirmUrl: url });
  await notifyCustomer(
    order,
    `${site.name}: your bank needs you to approve the $${finalTotal.toFixed(2)} payment for ${order.ref}. One tap: ${url ?? `${site.url}/orders/${order.ref}`}`,
  );

  return { ok: false, state, amount: finalTotal, confirmUrl: url, reason: charge.error };
}

export interface SettlementResult {
  merchant: number;
  courier: number;
  platform: number;
  merchantTransferred: boolean;
  courierTransferred: boolean;
}

/**
 * Step 4 — split one charge three ways.
 *
 * Both transfers share the order ref as their transfer group and as their
 * idempotency key, so re-running settlement (a retried webhook, a double click
 * on "delivered") can never pay anyone twice.
 */
export async function settleOrder(
  order: DeliveryOrderRecord,
  courierAccountId: string | null,
): Promise<SettlementResult> {
  const total = order.finalTotal ?? 0;
  const courierPay = order.courierPay ?? 0;
  // The wash passes straight through to the laundromat. Our margin is whatever
  // survives paying the courier out of the surcharge.
  const wash = order.merchantPayout ?? Math.max(0, total - ROUND_TRIP_SURCHARGE);
  const split = splitOrder({ total, wash, courierPay });

  await updateOrder(order.ref, {
    merchantPayout: split.merchant,
    platformTake: split.platform,
  });

  const merchant = await getMerchant(order.merchantId);
  const merchantAccount = merchant?.stripeAccountId ?? null;

  const [merchantTransfer, courierTransfer] = await Promise.all([
    merchantAccount && split.merchant > 0
      ? transferTo({
          accountId: merchantAccount,
          amountCents: Math.round(split.merchant * 100),
          transferGroup: order.ref,
          idempotencyKey: `merchant_${order.ref}`,
          metadata: { ref: order.ref, role: 'merchant' },
        })
      : Promise.resolve(null),
    courierAccountId && split.courier > 0
      ? transferTo({
          accountId: courierAccountId,
          amountCents: Math.round(split.courier * 100),
          transferGroup: order.ref,
          idempotencyKey: `courier_${order.ref}`,
          metadata: { ref: order.ref, role: 'courier' },
        })
      : Promise.resolve(null),
  ]);

  return {
    merchant: split.merchant,
    courier: split.courier,
    platform: split.platform,
    merchantTransferred: Boolean(merchantTransfer),
    courierTransferred: Boolean(courierTransfer),
  };
}
