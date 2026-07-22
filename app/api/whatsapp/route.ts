import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { generateReply } from '@/lib/assistant';
import { sendWhatsAppText, appendMessage } from '@/lib/whatsapp';
import { createLead } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * WhatsApp Cloud API webhook.
 *   GET  — Meta verification handshake (hub.challenge)
 *   POST — inbound messages → shared assistant brain → reply + lead capture
 */

// ── Verification handshake ───────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// Optional payload authenticity check (Meta signs with your app secret).
function verifySignature(raw: string, signature: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // not configured → skip (dev/preview)
  if (!signature?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Inbound messages ─────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // ack malformed bodies, don't retry-loop
  }

  // Acknowledge fast; process inline (messages are small). Never throw.
  try {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        const contactName = value?.contacts?.[0]?.profile?.name as string | undefined;
        const messages = value?.messages ?? [];

        for (const msg of messages) {
          const from = msg?.from as string | undefined;
          if (!from) continue;

          const text =
            msg.type === 'text'
              ? (msg.text?.body as string)
              : msg.type === 'button'
                ? (msg.button?.text as string)
                : msg.type === 'interactive'
                  ? (msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title)
                  : undefined;

          if (!text) {
            await sendWhatsAppText(from, 'Thanks! I can help you get a quote or book a cleaning. What service do you need, and how many bedrooms/bathrooms?');
            continue;
          }

          const history = appendMessage(from, { role: 'user', content: text });
          const { reply } = await generateReply(history, 'whatsapp');
          appendMessage(from, { role: 'assistant', content: reply });
          await sendWhatsAppText(from, reply);

          // Capture every WhatsApp conversation as a lead for follow-up.
          await createLead({ name: contactName, phone: from, source: 'whatsapp', message: text });
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp] processing error', err);
  }

  return NextResponse.json({ ok: true });
}
