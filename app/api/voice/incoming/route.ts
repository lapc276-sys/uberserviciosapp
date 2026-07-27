import { getCall } from '@/lib/voice/conversation';
import { greeting } from '@/lib/voice/agent';
import { gather, xmlResponse, SPEECH_HINTS } from '@/lib/voice/twiml';
import { verifyTwilioSignature, publicUrl, readFormParams } from '@/lib/voice/verify';

export const runtime = 'nodejs';

/**
 * Twilio Voice entry point — point your number's "A call comes in" webhook here.
 * Greets the caller and starts listening.
 */
export async function POST(req: Request) {
  const url = publicUrl(req);
  const params = await readFormParams(req);

  if (!verifyTwilioSignature(url, params, req.headers.get('x-twilio-signature'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const callSid = params.CallSid ?? `local-${Date.now()}`;
  getCall(callSid, params.From ?? '');

  const respondUrl = new URL('/api/voice/respond', url).toString();
  return xmlResponse(gather(greeting(), { action: respondUrl, hints: SPEECH_HINTS }));
}
