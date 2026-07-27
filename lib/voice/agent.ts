import { calculateQuote } from '../quote';
import { getService, services } from '../config/services';
import { cities } from '../config/cities';
import { site } from '../config/site';
import { generateReply, type AssistantMessage } from '../assistant';
import { extractSlots, detectIntent, missingSlot, type CallState } from './conversation';

/**
 * The voice agent's turn logic.
 *
 * Deterministic where correctness matters (prices, the questions needed to
 * quote) and model-driven only for open-ended conversation. A caller must
 * never hear an invented price, and a phone quote must match the website to
 * the dollar — both come from the same `calculateQuote`.
 */

export type TurnAction = 'ask' | 'quote' | 'transfer' | 'end';

export interface Turn {
  speech: string;
  action: TurnAction;
  /** Set when we quoted, so the call can text a booking link afterwards. */
  quotedAmount?: { low: number; high: number };
}

const SLOT_QUESTIONS: Record<string, string> = {
  serviceSlug:
    'What kind of cleaning do you need? For example, a deep clean, a regular house cleaning, or a move-out clean.',
  bedrooms: 'How many bedrooms does the place have?',
  bathrooms: 'And how many bathrooms?',
  city: `Which area are you in? We serve ${cities.slice(0, 4).map((c) => c.name).join(', ')} and nearby.`,
};

export function greeting(): string {
  return `Thanks for calling ${site.name}. I can give you a price and get you booked. What can I help you with?`;
}

export async function handleTurn(state: CallState, speech: string): Promise<Turn> {
  const intent = detectIntent(speech);

  if (intent === 'transfer') {
    return { speech: 'Of course, let me connect you with someone right now.', action: 'transfer' };
  }

  if (intent === 'goodbye') {
    return {
      speech: `Thanks for calling ${site.name}. Have a great day!`,
      action: 'end',
    };
  }

  // Pull whatever details the caller just gave us.
  state.slots = extractSlots(speech, state.slots);

  if (intent === 'hours') {
    return {
      speech: `We're open every day from seven in the morning to nine at night. Would you like a price for a cleaning?`,
      action: 'ask',
    };
  }

  if (intent === 'areas') {
    return {
      speech: `We serve ${cities.map((c) => c.name).join(', ')}. Are you in one of those areas?`,
      action: 'ask',
    };
  }

  // Once we have everything, quote — always from the shared pricing engine.
  const missing = missingSlot(state.slots);
  if (!missing && !state.quoted) {
    const quote = calculateQuote({
      serviceSlug: state.slots.serviceSlug!,
      bedrooms: state.slots.bedrooms!,
      bathrooms: state.slots.bathrooms!,
      city: state.slots.city,
    });
    if (quote) {
      state.quoted = true;
      const service = getService(state.slots.serviceSlug!);
      const taxNote = quote.taxRate > 0 ? ' including tax' : '';
      return {
        speech:
          `For a ${service?.name.toLowerCase()} with ${state.slots.bedrooms} ${state.slots.bedrooms === 1 ? 'bedroom' : 'bedrooms'} ` +
          `and ${state.slots.bathrooms} ${state.slots.bathrooms === 1 ? 'bathroom' : 'bathrooms'} in ${state.slots.city}, ` +
          `you're looking at ${quote.totalLow} to ${quote.totalHigh} dollars${taxNote}, and about ${quote.estimatedHours}. ` +
          `I can text you a link to pick your day and time. Would you like that?`,
        action: 'quote',
        quotedAmount: { low: quote.totalLow, high: quote.totalHigh },
      };
    }
  }

  // Caller wants to book and we already quoted — send the link.
  if ((intent === 'book' || /\b(yes|yeah|yep|sure|please|okay|ok)\b/i.test(speech)) && state.quoted) {
    return {
      speech:
        `Great, I just sent you a text with your quote and a booking link. ` +
        `You can pick your day and time there, and you're only charged after the cleaning. Anything else I can help with?`,
      action: 'quote',
    };
  }

  // Still gathering details — ask the next question directly.
  if (missing) {
    // If the caller said something unrelated, let the model handle it, then
    // steer back to the question we still need answered.
    if (intent === 'general' && state.turns.length > 0 && !hasNewInfo(speech)) {
      const history: AssistantMessage[] = [...state.turns, { role: 'user', content: speech }];
      const { reply } = await generateReply(history.slice(-6), 'web');
      return { speech: `${trimForSpeech(reply)} ${SLOT_QUESTIONS[missing]}`, action: 'ask' };
    }
    return { speech: SLOT_QUESTIONS[missing], action: 'ask' };
  }

  return {
    speech: 'Is there anything else I can help you with?',
    action: 'ask',
  };
}

/** Did the caller supply anything we can act on? */
function hasNewInfo(speech: string): boolean {
  const t = speech.toLowerCase();
  return (
    /\d/.test(t) ||
    services.some((s) => t.includes(s.name.toLowerCase())) ||
    cities.some((c) => t.includes(c.name.toLowerCase())) ||
    /(bed|bath|studio|clean)/.test(t)
  );
}

/** Keeps model output to something a caller will actually sit through. */
function trimForSpeech(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return sentences.length > 240 ? `${sentences.slice(0, 237)}...` : sentences;
}
