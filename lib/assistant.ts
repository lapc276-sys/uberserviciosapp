import { services } from './config/services';
import { cities } from './config/cities';
import { site } from './config/site';
import { calculateQuote } from './quote';

/**
 * The Homigo assistant brain — shared by every channel (web chat, WhatsApp,
 * and future voice). One knowledge base, one pricing source, one personality,
 * so a quote on the website matches a quote on WhatsApp to the dollar.
 */

export interface AssistantMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type AssistantSource = 'openai' | 'rules' | 'rules-fallback';

/** Knowledge base injected as the system prompt — sourced from live config. */
export function buildSystemPrompt(channel: 'web' | 'whatsapp' = 'web'): string {
  const svc = services
    .map((s) => `- ${s.name}: from $${s.pricing.base} (${s.pricing.estimatedHours}). ${s.summary}`)
    .join('\n');
  const areas = cities.map((c) => `${c.name}, ${c.region}`).join('; ');
  const channelNote =
    channel === 'whatsapp'
      ? 'You are replying on WhatsApp. Keep messages short and mobile-friendly. Use line breaks, not markdown tables. One emoji max.'
      : 'You are the website chat assistant.';

  return `You are the friendly, concise booking assistant for ${site.name}, an automated home-services company (${site.tagline}).
Goal: help customers get a quote and book. Be warm, brief, and always move toward a booking. ${channelNote}

Company facts:
- Phone: ${site.phone} · Email: ${site.email} · Hours: ${site.hours}
- Licensed & insured, background-checked pros, satisfaction guaranteed.
- Payment: all major cards via secure checkout. Recurring plans get up to 20% off.
- Service areas: ${areas}.

Services & starting prices:
${svc}

Pricing: base + per bedroom + per bathroom + per sqft. For an exact quote ask for service, bedrooms, bathrooms and approximate square footage, then give a range and invite them to book at ${site.url}/book.
Rules: Never invent prices beyond the model. If asked something you can't do, offer to book or connect them by phone. Keep replies under 4 sentences unless quoting.`;
}

/** Deterministic fallback so the assistant works with zero external dependencies. */
export function fallbackReply(userText: string): string {
  const t = userText.toLowerCase();
  const bedMatch = t.match(/(\d+)\s*(?:bed|br|bedroom|cuarto|habitaci)/);
  const bathMatch = t.match(/(\d+)\s*(?:bath|ba|bathroom|baño|bano)/);

  const service =
    services.find((s) => t.includes(s.slug.replace(/-/g, ' ')) || t.includes(s.name.toLowerCase())) ??
    (t.includes('deep') || t.includes('profund') ? services.find((s) => s.slug === 'deep-cleaning') : undefined) ??
    (t.includes('airbnb') ? services.find((s) => s.slug === 'airbnb-cleaning') : undefined) ??
    (t.includes('move out') || t.includes('mudanza') ? services.find((s) => s.slug === 'move-out-cleaning') : undefined);

  if (service && bedMatch) {
    const q = calculateQuote({
      serviceSlug: service.slug,
      bedrooms: Number(bedMatch[1]),
      bathrooms: bathMatch ? Number(bathMatch[1]) : Math.max(1, Number(bedMatch[1]) - 1),
    });
    if (q) {
      return `A ${service.name.toLowerCase()} for that home runs about $${q.low}–$${q.high} (${q.estimatedHours}). Recurring plans save up to 20%. Want me to book it? → ${site.url}/book`;
    }
  }

  if (t.includes('price') || t.includes('cost') || t.includes('how much') || t.includes('quote') || t.includes('precio') || t.includes('cuánto') || t.includes('cuanto')) {
    return `Happy to quote you! Which service (deep clean, house, move-out, Airbnb…), and how many bedrooms and bathrooms? Or get an instant price at ${site.url}/book`;
  }
  if (t.includes('area') || t.includes('serve') || t.includes('near me') || t.includes('city') || t.includes('zona') || t.includes('ciudad')) {
    return `We currently serve ${cities.map((c) => c.name).join(', ')} and surrounding areas. Where are you located?`;
  }
  if (t.includes('book') || t.includes('schedule') || t.includes('available') || t.includes('weekend') || t.includes('reserv') || t.includes('agend') || t.includes('cita')) {
    return `You can book online in about 60 seconds at ${site.url}/book — pick a service, time and you're set. Same-week slots are usually available.`;
  }
  if (t.includes('pay') || t.includes('card') || t.includes('cash') || t.includes('pago') || t.includes('tarjeta')) {
    return `We accept all major cards through secure checkout. You're only charged after the service. Ready to book? → ${site.url}/book`;
  }
  if (t.includes('cancel') || t.includes('reschedul') || t.includes('reagend')) {
    return `No problem — you can reschedule or cancel free up to 24 hours before your appointment from your confirmation email or by calling ${site.phone}.`;
  }
  return `I can help with quotes, availability and booking for cleaning services. Tell me the service and your home size, or book instantly at ${site.url}/book. You can also reach us at ${site.phone}.`;
}

/**
 * Generates a reply for a conversation. Uses OpenAI when OPENAI_API_KEY is set,
 * otherwise the deterministic rules engine. Never throws.
 */
export async function generateReply(
  messages: AssistantMessage[],
  channel: 'web' | 'whatsapp' = 'web',
): Promise<{ reply: string; source: AssistantSource }> {
  const trimmed = messages.slice(-12);
  const lastUser = [...trimmed].reverse().find((m) => m.role === 'user')?.content ?? '';
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { reply: fallbackReply(lastUser), source: 'rules' };
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0.5,
        max_tokens: 350,
        messages: [
          { role: 'system', content: buildSystemPrompt(channel) },
          ...trimmed.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || fallbackReply(lastUser);
    return { reply, source: 'openai' };
  } catch {
    return { reply: fallbackReply(lastUser), source: 'rules-fallback' };
  }
}
