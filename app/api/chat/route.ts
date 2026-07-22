import { NextResponse } from 'next/server';
import { generateReply, type AssistantMessage } from '@/lib/assistant';

export const runtime = 'nodejs';

export async function POST(req: Request) {
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
