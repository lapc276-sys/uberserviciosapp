import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates that a webhook really came from Twilio.
 *
 * Without this, anyone who learns the URL can drive your phone agent, run up
 * your AI bill, or transfer calls. Twilio signs the full URL plus the POST
 * params sorted by key, HMAC-SHA1 with your auth token.
 */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  // No token configured (dev/preview) → skip rather than block the whole flow.
  if (!token) return true;
  if (!signature) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = createHmac('sha1', token).update(Buffer.from(payload, 'utf-8')).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The signed URL must match what Twilio called. Behind a proxy the request
 * URL can differ from the public one, so prefer the forwarded host.
 */
export function publicUrl(req: Request): string {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedHost) {
    url.host = forwardedHost;
    url.protocol = `${forwardedProto ?? 'https'}:`;
  }
  return url.toString();
}

export async function readFormParams(req: Request): Promise<Record<string, string>> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}
