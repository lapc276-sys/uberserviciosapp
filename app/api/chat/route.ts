import { NextResponse } from 'next/server';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';
import { site } from '@/lib/config/site';
import { calculateQuote } from '@/lib/quote';

export const runtime = 'nodejs';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Knowledge base injected as the system prompt — sourced from live config. */
function systemPrompt(): string {
  const svc = services
    .map((s) => `- ${s.name}: from $${s.pricing.base} (${s.pricing.estimatedHours}). ${s.summary}`)
    .join('\n');
  const areas = cities.map((c) => `${c.name}, ${c.region}`).join('; ');
  return `You are the friendly, concise booking assistant for ${site.name}, an automated home-services company (${site.tagline}).
Goal: help visitors get a quote and book. Be warm, brief, and always move toward a booking.

Company facts:
- Phone: ${site.phone} · Email: ${site.email} · Hours: ${site.hours}
- Licensed & insured, background-checked pros, satisfaction guaranteed.
- Payment: all major cards via secure checkout. Recurring plans get up to 20% off.
- Service areas: ${areas}.

Services & starting prices:
${svc}

Pricing: base price + per bedroom + per bathroom + per sqft. For an exact quote ask for service, bedrooms, bathrooms and approximate square footage, then give a range and invite them to book at ${site.url}/book.
Rules: Never invent prices beyond the model. If asked something you can't do, offer to book or connect them by phone. Keep replies under 4 sentences unless quoting.`;
}

/** Rules-based fallback so the bot works with zero external dependencies. */
function fallbackReply(userText: string): string {
  const t = userText.toLowerCase();
  const bedMatch = t.match(/(\d+)\s*(?:bed|br|bedroom)/);
  const bathMatch = t.match(/(\d+)\s*(?:bath|ba|bathroom)/);

  const service =
    services.find((s) => t.includes(s.slug.replace(/-/g, ' ')) || t.includes(s.name.toLowerCase())) ??
    (t.includes('deep') ? services.find((s) => s.slug === 'deep-cleaning') : undefined) ??
    (t.includes('airbnb') ? services.find((s) => s.slug === 'airbnb-cleaning') : undefined);

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

  if (t.includes('price') || t.includes('cost') || t.includes('how much') || t.includes('quote')) {
    return `Happy to quote you! Which service (deep clean, house, move-out, Airbnb…), and how many bedrooms and bathrooms? Or get an instant price at ${site.url}/book`;
  }
  if (t.includes('area') || t.includes('serve') || t.includes('near me') || t.includes('city')) {
    return `We currently serve ${cities.map((c) => c.name).join(', ')} and surrounding areas. Where are you located?`;
  }
  if (t.includes('book') || t.includes('schedule') || t.includes('available') || t.includes('weekend')) {
    return `You can book online in about 60 seconds at ${site.url}/book — pick a service, time and you're set. Same-week slots are usually available.`;
  }
  if (t.includes('pay') || t.includes('card') || t.includes('cash')) {
    return `We accept all major cards through secure checkout. You're only charged after the service. Ready to book? → ${site.url}/book`;
  }
  if (t.includes('cancel') || t.includes('reschedul')) {
    return `No problem — you can reschedule or cancel free up to 24 hours before your appointment from your confirmation email or by calling ${site.phone}.`;
  }
  return `I can help with quotes, availability and booking for cleaning services. Tell me the service and your home size, or book instantly at ${site.url}/book. You can also reach us at ${site.phone}.`;
}

export async function POST(req: Request) {
  let messages: ChatMessage[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const apiKey = process.env.OPENAI_API_KEY;

  // Graceful degradation: no key → deterministic rules-based assistant.
  if (!apiKey) {
    return NextResponse.json({ reply: fallbackReply(lastUser), source: 'rules' });
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0.5,
        max_tokens: 350,
        messages: [
          { role: 'system', content: systemPrompt() },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || fallbackReply(lastUser);
    return NextResponse.json({ reply, source: 'openai' });
  } catch {
    return NextResponse.json({ reply: fallbackReply(lastUser), source: 'rules-fallback' });
  }
}
