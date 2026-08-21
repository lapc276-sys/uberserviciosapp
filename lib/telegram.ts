/**
 * Telegram client for the internal time-logging bot.
 *
 * Internal on purpose. Telegram is the wrong channel to reach US cleaning
 * customers — WhatsApp dominates that market by a wide margin — but it is an
 * excellent one for a handful of known people on a job, where adoption is not
 * a question and the Bot API is free, immediate and needs no app review.
 *
 * Every function no-ops without TELEGRAM_BOT_TOKEN, like every other
 * integration here, so the app runs identically with the bot switched off.
 */

const API = 'https://api.telegram.org';

export const isTelegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Chat ids allowed to log time, comma-separated.
 *
 * This is the access control. A bot username is discoverable by anyone, so
 * without an allowlist a stranger could open a session and pollute the very
 * dataset the bot exists to build. Empty means nobody — a misconfigured bot
 * that accepts nothing is a far better failure than one that accepts everyone.
 */
function allowedChats(): Set<string> {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_CHATS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isChatAllowed(chatId: string | number): boolean {
  return allowedChats().has(String(chatId));
}

export function hasAllowlist(): boolean {
  return allowedChats().size > 0;
}

/**
 * Verifies the secret Telegram echoes back on every webhook call.
 *
 * The webhook URL is the only thing protecting an unauthenticated public
 * endpoint, and URLs leak — into logs, proxies and screenshots. Setting a
 * secret token when registering the webhook turns a guessed URL into a
 * rejected request.
 */
export function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true; // Not configured — nothing to check against.
  return req.headers.get('x-telegram-bot-api-secret-token') === expected;
}

async function call(method: string, body: unknown): Promise<unknown | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; result?: unknown };
    return data.ok ? (data.result ?? null) : null;
  } catch {
    // A failed reply must never fail the webhook: Telegram retries on a
    // non-200, which would replay the command and double-log the time.
    return null;
  }
}

export async function sendMessage(chatId: string | number, text: string): Promise<boolean> {
  return (await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' })) !== null;
}

/**
 * Downloads a voice note and returns its bytes.
 *
 * The Bot API caps getFile downloads at 20MB, which is irrelevant for voice
 * notes (seconds of Opus audio) and is exactly why this bot handles speech
 * rather than video.
 */
export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; path: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const info = (await call('getFile', { file_id: fileId })) as { file_path?: string } | null;
  if (!info?.file_path) return null;

  try {
    const res = await fetch(`${API}/file/bot${token}/${info.file_path}`);
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), path: info.file_path };
  } catch {
    return null;
  }
}

/**
 * Speech to text, so the logger works with gloves on and hands full.
 *
 * Without OPENAI_API_KEY this returns null and the caller falls back to
 * asking for text — degraded, not broken.
 */
export async function transcribe(audio: Buffer, filename: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)]), filename);
    form.append('model', 'whisper-1');
    // The crews work in Spanish; naming it beats language detection on a
    // three-word utterance like "cocina el horno".
    form.append('language', 'es');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}
