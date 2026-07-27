/**
 * TwiML builders for the voice agent.
 *
 * Twilio drives the call by fetching TwiML from our webhooks, which means the
 * whole agent runs on ordinary serverless request/response — no persistent
 * WebSocket server, no media-stream infrastructure.
 */

/** Amazon Polly neural voice — noticeably more natural than the standard set. */
export const VOICE = process.env.TWILIO_VOICE ?? 'Polly.Joanna-Neural';
export const LANGUAGE = 'en-US';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Speech synthesis reads written text badly: "$240" becomes "dollar two four
 * zero", URLs get spelled out, and markdown is read aloud. This rewrites a
 * reply into something that sounds right when spoken.
 */
export function speakable(text: string): string {
  return text
    // Strip URLs — we text those instead of reading them out.
    .replace(/https?:\/\/\S+/g, 'our website')
    .replace(/\*\*/g, '')
    .replace(/[#*_`]/g, '')
    // "$240" → "240 dollars"; ranges read naturally.
    .replace(/\$(\d[\d,]*)\s*[–—-]\s*\$(\d[\d,]*)/g, '$1 to $2 dollars')
    .replace(/\$(\d[\d,]*)/g, '$1 dollars')
    .replace(/\bhrs?\b/gi, 'hours')
    .replace(/\bmin\b/gi, 'minutes')
    .replace(/\s+/g, ' ')
    .trim();
}

export function xmlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

export function say(text: string): string {
  return `<Say voice="${VOICE}" language="${LANGUAGE}">${escapeXml(speakable(text))}</Say>`;
}

export interface GatherOptions {
  action: string;
  /** Seconds of silence before Twilio decides the caller is done talking. */
  speechTimeout?: string;
  hints?: string;
}

/** Speaks a prompt and listens for the caller's reply. */
export function gather(prompt: string, { action, speechTimeout = 'auto', hints }: GatherOptions): string {
  const hintAttr = hints ? ` hints="${escapeXml(hints)}"` : '';
  return `<Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="${speechTimeout}" language="${LANGUAGE}"${hintAttr}>${say(prompt)}</Gather>`;
}

export function hangup(text?: string): string {
  return `${text ? say(text) : ''}<Hangup/>`;
}

export function redirect(url: string): string {
  return `<Redirect method="POST">${escapeXml(url)}</Redirect>`;
}

/** Warm transfer to a human. Falls back to voicemail-style message if unset. */
export function dial(number: string, message: string): string {
  return `${say(message)}<Dial timeout="25" callerId="${escapeXml(process.env.TWILIO_PHONE_NUMBER ?? '')}">${escapeXml(number)}</Dial>`;
}

/** Speech hints materially improve recognition of our domain vocabulary. */
export const SPEECH_HINTS = [
  'deep cleaning',
  'move out',
  'move in',
  'apartment',
  'house cleaning',
  'Airbnb',
  'office',
  'post construction',
  'bedroom',
  'bedrooms',
  'bathroom',
  'bathrooms',
  'Manhattan',
  'Brooklyn',
  'Queens',
  'Bronx',
  'Miami',
  'quote',
  'price',
  'book',
  'schedule',
  'representative',
  'agent',
].join(', ');
