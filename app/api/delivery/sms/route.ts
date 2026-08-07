import { message, xmlResponse } from '@/lib/voice/twiml';
import { publicUrl, readFormParams, verifyTwilioSignature } from '@/lib/voice/verify';
import { intakeReply, parseIntake } from '@/lib/delivery/intake';
import { geocodeAddress } from '@/lib/delivery/geocode';
import { haversineMiles } from '@/lib/delivery/geo';
import { requestCardOnFile } from '@/lib/delivery/payments';
import { createOrder, listMerchants, upsertBuilding } from '@/lib/delivery/store';

export const runtime = 'nodejs';

/**
 * Laundry intake over SMS. Point your Twilio number's *messaging* webhook here.
 *
 * The customer texts a laundromat the way they always have — "recoger 3 bolsas
 * en 1234 SW 8th St apt 502" — and an order exists thirty seconds later with a
 * card saved against it. Nothing about the customer's habit changes; the entire
 * system is on our side of the message.
 *
 * The reply is a single TwiML message: either the estimate plus a card link, or
 * the one field we still need. Never a form.
 */
export async function POST(req: Request) {
  const params = await readFormParams(req);

  if (!verifyTwilioSignature(publicUrl(req), params, req.headers.get('x-twilio-signature'))) {
    return new Response('Invalid signature', { status: 403 });
  }

  const from = params.From ?? '';
  const body = (params.Body ?? '').trim();
  if (!from || !body) return xmlResponse(message('Send us what you need picked up and we’ll take it from there.'));

  const parsed = parseIntake(body);

  // Missing a field the engine needs → ask for exactly that, nothing else.
  if (parsed.missing.length > 0) {
    return xmlResponse(message(intakeReply(parsed)));
  }

  const geo = await geocodeAddress(parsed.address!);
  const merchants = await listMerchants();
  if (merchants.length === 0) {
    return xmlResponse(message('We’re not open in your area yet — but we’ve noted your request.'));
  }

  // Nearest laundromat wins when we know where the customer is; otherwise the
  // first configured one, so an un-geocoded address still produces an order.
  const merchant = geo
    ? [...merchants].sort(
        (a, b) => haversineMiles(a.location, geo.location) - haversineMiles(b.location, geo.location),
      )[0]
    : merchants[0];

  // Create the building on first contact even with nothing known about it.
  // The next delivery to this address attaches an observation to this record,
  // and that is how the access model learns.
  const building = geo
    ? await upsertBuilding({
        label: geo.formatted,
        lat: geo.location.lat,
        lng: geo.location.lng,
        elevator: parsed.elevatorHint,
      })
    : null;

  const order = await createOrder({
    merchantId: merchant.id,
    buildingId: building?.id ?? null,
    channel: 'sms',
    customerPhone: from,
    addressLine: geo?.formatted ?? parsed.address!,
    lat: geo?.location.lat ?? null,
    lng: geo?.location.lng ?? null,
    floor: parsed.floor,
    handoff: parsed.handoff,
    items: parsed.items,
    notes: body,
    estimateLow: parsed.estimate.low,
    estimateHigh: parsed.estimate.high,
  });

  // Card on file — charging nothing now, because the price does not exist yet.
  // `notify: false`: the link rides back on this reply instead of a second text.
  const card = await requestCardOnFile(order, { notify: false });

  return xmlResponse(message(intakeReply(parsed, { ref: order.ref, cardUrl: card.url })));
}
