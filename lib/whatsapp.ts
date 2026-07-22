import type { AssistantMessage } from './assistant';

/**
 * WhatsApp Cloud API (Meta) integration helpers.
 * Configured via env — the webhook no-ops safely if keys are missing.
 *
 *   WHATSAPP_VERIFY_TOKEN     — your chosen token for webhook verification
 *   WHATSAPP_ACCESS_TOKEN     — permanent access token (Meta System User)
 *   WHATSAPP_PHONE_NUMBER_ID  — the sending phone number id
 *   WHATSAPP_GRAPH_VERSION    — optional, defaults to v21.0
 */

export const isWhatsAppConfigured = Boolean(
  process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
);

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0';

export async function sendWhatsAppText(to: string, body: string): Promise<boolean> {
  if (!isWhatsAppConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[whatsapp] (dry-run) → ${to}: ${body}`);
    }
    return false;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: true, body: body.slice(0, 4096) },
      }),
    });
    if (!res.ok) {
      console.error('[whatsapp] send failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[whatsapp] send error', err);
    return false;
  }
}

/**
 * Lightweight per-sender conversation memory. WhatsApp delivers one message at
 * a time, so we keep short rolling context in memory. Ephemeral by design —
 * swap for Redis in production (Phase 4) for durability across instances.
 */
const CONVERSATIONS = new Map<string, { messages: AssistantMessage[]; updated: number }>();
const MAX_TURNS = 12;
const TTL_MS = 1000 * 60 * 60; // 1 hour

export function getConversation(sender: string): AssistantMessage[] {
  const entry = CONVERSATIONS.get(sender);
  if (!entry || Date.now() - entry.updated > TTL_MS) {
    CONVERSATIONS.delete(sender);
    return [];
  }
  return entry.messages;
}

export function appendMessage(sender: string, message: AssistantMessage): AssistantMessage[] {
  const existing = getConversation(sender);
  const messages = [...existing, message].slice(-MAX_TURNS);
  CONVERSATIONS.set(sender, { messages, updated: Date.now() });
  return messages;
}
