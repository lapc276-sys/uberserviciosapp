import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { generateReply } from '@/lib/assistant';
import { appendMessage } from '@/lib/whatsapp';
import { createLead } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * Facebook Messenger + Instagram DM webhook.
 *
 * Meta delivers both channels through the same Graph webhook shape, so one
 * handler serves both — and it answers with the same assistant brain as the
 * website, WhatsApp and the phone agent, so quotes never diverge by channel.
 *
 * Env:
 *   META_VERIFY_TOKEN     — your chosen webhook verification string
 *   META_PAGE_TOKEN       — Page access token (Messenger)
 *   META_IG_TOKEN         — token for Instagram, if different
 *   META_APP_SECRET       — for payload signature verification
 */

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

function verifySignature(raw: string, signature: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // not configured (dev/preview)
  if (!signature?.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sendMessage(recipientId: string, text: string, platform: 'messenger' | 'instagram') {
  const token = platform === 'instagram' ? (process.env.META_IG_TOKEN ?? process.env.META_PAGE_TOKEN) : process.env.META_PAGE_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV !== 'production') console.log(`[${platform}] (dry-run) → ${recipientId}: ${text}`);
    return;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text: text.slice(0, 2000) },
      }),
    });
    if (!res.ok) console.error(`[${platform}] send failed`, res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error(`[${platform}] send error`, err);
  }
}

export async function POST(req: Request) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // ack malformed bodies
  }

  // `object` distinguishes the two channels; the message shape is identical.
  const platform: 'messenger' | 'instagram' = payload?.object === 'instagram' ? 'instagram' : 'messenger';

  try {
    for (const entry of payload?.entry ?? []) {
      for (const event of entry?.messaging ?? []) {
        const senderId = event?.sender?.id;
        const text = event?.message?.text as string | undefined;

        // Ignore echoes of our own replies, delivery receipts and reactions.
        if (!senderId || !text || event?.message?.is_echo) continue;

        const key = `${platform}:${senderId}`;
        const history = appendMessage(key, { role: 'user', content: text });
        const { reply } = await generateReply(history, 'whatsapp');
        appendMessage(key, { role: 'assistant', content: reply });

        await sendMessage(senderId, reply, platform);
        await createLead({ source: platform, message: text.slice(0, 500) });
      }
    }
  } catch (err) {
    console.error('[meta] processing error', err);
  }

  return NextResponse.json({ ok: true });
}
