import { NextResponse } from 'next/server';
import { verifyStripeSignature } from '@/lib/stripe';
import { markInvoicePaid } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * Stripe webhook. Verifies the signature, then reconciles paid invoices.
 * Configure the endpoint URL + STRIPE_WEBHOOK_SECRET in the Stripe dashboard.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'))) {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad payload', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoiceId = event.data?.object?.id;
        if (invoiceId) await markInvoicePaid(invoiceId);
        break;
      }

      /**
       * Delivery orders pay in the opposite order to bookings: the card is
       * saved first for $0 (mode `setup`) and charged after the weigh-in.
       * Both halves land here.
       */
      case 'checkout.session.completed': {
        const sessionObject = event.data?.object;
        const ref: string | undefined = sessionObject?.metadata?.ref;
        if (!ref) break;

        if (sessionObject.mode === 'setup' && sessionObject.setup_intent) {
          const { attachSavedCard } = await import('@/lib/delivery/payments');
          await attachSavedCard(ref, sessionObject.setup_intent);
        } else if (sessionObject.mode === 'payment' && sessionObject.payment_status === 'paid') {
          // The customer approved a total that outran their estimate.
          const { updateOrder } = await import('@/lib/delivery/store');
          await updateOrder(ref, {
            paymentState: 'PAID',
            stripePaymentIntentId: sessionObject.payment_intent ?? null,
            paidAt: new Date().toISOString(),
            status: 'READY',
          });
        }
        break;
      }
      default:
        // Unhandled events are acknowledged so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error('[stripe] webhook processing error', err);
    return new NextResponse('Processing error', { status: 500 });
  }

  return NextResponse.json({ received: true });
}
