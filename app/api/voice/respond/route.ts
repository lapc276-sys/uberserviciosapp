import { getCall } from '@/lib/voice/conversation';
import { handleTurn } from '@/lib/voice/agent';
import { gather, say, hangup, dial, xmlResponse, SPEECH_HINTS } from '@/lib/voice/twiml';
import { verifyTwilioSignature, publicUrl, readFormParams } from '@/lib/voice/verify';
import { sendSms } from '@/lib/sms';
import { createLead } from '@/lib/data';
import { site } from '@/lib/config/site';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** After this many unintelligible turns, stop asking and offer a human. */
const MAX_MISSES = 2;

export async function POST(req: Request) {
  const url = publicUrl(req);
  const params = await readFormParams(req);

  if (!verifyTwilioSignature(url, params, req.headers.get('x-twilio-signature'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const callSid = params.CallSid ?? `local-${Date.now()}`;
  const from = params.From ?? '';
  const speech = (params.SpeechResult ?? '').trim();
  const state = getCall(callSid, from);
  const respondUrl = new URL('/api/voice/respond', url).toString();

  // Twilio heard nothing intelligible.
  if (!speech) {
    state.misses += 1;
    if (state.misses > MAX_MISSES) {
      const fallback = process.env.VOICE_TRANSFER_NUMBER;
      if (fallback) {
        return xmlResponse(dial(fallback, 'Sorry, I’m having trouble hearing you. Let me connect you with someone.'));
      }
      if (from) {
        await sendSms(from, `${site.name}: sorry we got cut off! Get an instant quote and book here: ${site.url}/book`);
      }
      return xmlResponse(
        hangup('Sorry, I’m having trouble hearing you. I just texted you a link to get a quote online. Talk soon!'),
      );
    }
    return xmlResponse(gather('Sorry, I didn’t catch that. Could you say it again?', { action: respondUrl, hints: SPEECH_HINTS }));
  }

  state.misses = 0;
  state.turns.push({ role: 'user', content: speech });

  const turn = await handleTurn(state, speech);
  state.turns.push({ role: 'assistant', content: turn.speech });

  if (turn.action === 'transfer') {
    const number = process.env.VOICE_TRANSFER_NUMBER;
    if (number) return xmlResponse(dial(number, turn.speech));
    // No human line configured — be honest rather than pretending to transfer.
    return xmlResponse(
      gather(
        `Our team isn’t available on this line right now, but I can help. ${site.name} can also be reached by email. What do you need?`,
        { action: respondUrl, hints: SPEECH_HINTS },
      ),
    );
  }

  // Text the quote + booking link the moment we've quoted, so the caller
  // leaves the call with something actionable in hand.
  if (turn.quotedAmount && from) {
    await sendSms(
      from,
      `${site.name}: your quote is $${turn.quotedAmount.low}–$${turn.quotedAmount.high}. Pick your day and time here: ${site.url}/book`,
    );
    await createLead({
      phone: from,
      source: 'voice',
      message: `Phone quote $${turn.quotedAmount.low}-$${turn.quotedAmount.high} · ${JSON.stringify(state.slots)}`,
    });
  }

  if (turn.action === 'end') {
    return xmlResponse(hangup(turn.speech));
  }

  return xmlResponse(gather(turn.speech, { action: respondUrl, hints: SPEECH_HINTS }));
}
