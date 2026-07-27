import { NextResponse } from 'next/server';
import { endCall } from '@/lib/voice/conversation';
import { verifyTwilioSignature, publicUrl, readFormParams } from '@/lib/voice/verify';
import { createLead } from '@/lib/data';

export const runtime = 'nodejs';

/**
 * Call-completion webhook. Captures every call as a lead — including the ones
 * that hung up before quoting, which are exactly the ones worth following up.
 */
export async function POST(req: Request) {
  const url = publicUrl(req);
  const params = await readFormParams(req);

  if (!verifyTwilioSignature(url, params, req.headers.get('x-twilio-signature'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const callSid = params.CallSid;
  const state = callSid ? endCall(callSid) : undefined;

  if (state && state.turns.length > 0 && !state.quoted) {
    const transcript = state.turns
      .map((t) => `${t.role === 'user' ? 'Caller' : 'Agent'}: ${t.content}`)
      .join(' | ')
      .slice(0, 900);
    await createLead({
      phone: state.from || params.From,
      source: 'voice_incomplete',
      message: `Call ended before quoting (${params.CallDuration ?? '?'}s) · ${transcript}`,
    });
  }

  return NextResponse.json({ ok: true });
}
