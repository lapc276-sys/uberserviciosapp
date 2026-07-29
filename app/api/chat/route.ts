import { NextResponse } from 'next/server';
import { generateReply, type AssistantMessage } from '@/lib/assistant';
import { RATE_LIMITS, limitRequest, rateLimitResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // The chatbot calls a model too — cheaper than vision, same failure mode.
  const limit = limitRequest(req, 'chat', RATE_LIMITS.chat);
  if (!limit.ok) return rateLimitResponse(limit, 'You’re sending messages too quickly. Give it a moment.');

  let messages: AssistantMessage[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { reply, source } = await generateReply(messages, 'web');
  return NextResponse.json({ reply, source });
}
