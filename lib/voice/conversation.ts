import { services } from '../config/services';
import { cities } from '../config/cities';
import type { AssistantMessage } from '../assistant';

/**
 * Per-call conversation state, keyed by Twilio's CallSid.
 *
 * In-memory and short-lived by design: a phone call lasts minutes, and state
 * dies with it. Move to Redis when you run multiple instances — the interface
 * here is deliberately narrow so that swap is contained.
 */

export interface CallSlots {
  serviceSlug?: string;
  bedrooms?: number;
  bathrooms?: number;
  city?: string;
  name?: string;
}

export interface CallState {
  turns: AssistantMessage[];
  slots: CallSlots;
  quoted: boolean;
  /** Consecutive turns Twilio couldn't transcribe — used to bail out gracefully. */
  misses: number;
  from: string;
  startedAt: number;
}

const CALLS = new Map<string, CallState>();
const TTL_MS = 1000 * 60 * 30;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [sid, state] of CALLS) if (state.startedAt < cutoff) CALLS.delete(sid);
}

export function getCall(callSid: string, from = ''): CallState {
  sweep();
  let state = CALLS.get(callSid);
  if (!state) {
    state = { turns: [], slots: {}, quoted: false, misses: 0, from, startedAt: Date.now() };
    CALLS.set(callSid, state);
  }
  return state;
}

export function endCall(callSid: string): CallState | undefined {
  const state = CALLS.get(callSid);
  CALLS.delete(callSid);
  return state;
}

// ── Slot extraction from speech ──────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1, studio: 0,
};

function parseCount(fragment: string): number | undefined {
  const digit = fragment.match(/(\d+)/);
  if (digit) return Number(digit[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(fragment)) return value;
  }
  return undefined;
}

/**
 * Pulls booking details out of transcribed speech. Speech recognition is
 * lossy, so this is intentionally forgiving — anything it misses simply gets
 * asked again rather than guessed.
 */
export function extractSlots(speech: string, current: CallSlots): CallSlots {
  const text = speech.toLowerCase();
  const next: CallSlots = { ...current };

  if (!next.serviceSlug) {
    const match =
      services.find((s) => text.includes(s.name.toLowerCase())) ??
      (/(deep|thorough|detailed)/.test(text) ? services.find((s) => s.slug === 'deep-cleaning') : undefined) ??
      (/(move[- ]?out|moving out|end of lease|deposit)/.test(text) ? services.find((s) => s.slug === 'move-out-cleaning') : undefined) ??
      (/(move[- ]?in|moving in|new place)/.test(text) ? services.find((s) => s.slug === 'move-in-cleaning') : undefined) ??
      (/(airbnb|rental|turnover|guest)/.test(text) ? services.find((s) => s.slug === 'airbnb-cleaning') : undefined) ??
      (/(office|commercial|business)/.test(text) ? services.find((s) => s.slug === 'office-cleaning') : undefined) ??
      (/(apartment|condo|studio)/.test(text) ? services.find((s) => s.slug === 'apartment-cleaning') : undefined) ??
      (/(house|home|regular|standard)/.test(text) ? services.find((s) => s.slug === 'house-cleaning') : undefined);
    if (match) next.serviceSlug = match.slug;
  }

  // Look at the words immediately before "bedroom"/"bathroom" so "three
  // bedrooms and two bathrooms" maps each number to the right slot.
  const bedMatch = text.match(/([\w]+)\s+(?:bed|bedroom|bedrooms|br)\b/);
  if (bedMatch && next.bedrooms === undefined) {
    const n = parseCount(bedMatch[1]);
    if (n !== undefined && n <= 10) next.bedrooms = n;
  }
  const bathMatch = text.match(/([\w]+)\s+(?:bath|bathroom|bathrooms|ba)\b/);
  if (bathMatch && next.bathrooms === undefined) {
    const n = parseCount(bathMatch[1]);
    if (n !== undefined && n <= 10) next.bathrooms = n;
  }
  if (next.bedrooms === undefined && /\bstudio\b/.test(text)) next.bedrooms = 0;

  if (!next.city) {
    const city = cities.find((c) => text.includes(c.name.toLowerCase()));
    if (city) next.city = city.name;
  }

  return next;
}

export type Intent = 'transfer' | 'book' | 'quote' | 'hours' | 'areas' | 'goodbye' | 'general';

export function detectIntent(speech: string): Intent {
  const t = speech.toLowerCase();
  if (/(representative|human|agent|person|manager|talk to someone|real person)/.test(t)) return 'transfer';
  if (/(bye|goodbye|that's all|thats all|nothing else|thank you.*bye)/.test(t)) return 'goodbye';
  if (/(book|schedule|set up|appointment|reserve)/.test(t)) return 'book';
  if (/(price|cost|quote|how much|estimate)/.test(t)) return 'quote';
  if (/(hours|open|when are you)/.test(t)) return 'hours';
  if (/(area|serve|located|near me|do you come)/.test(t)) return 'areas';
  return 'general';
}

/** The next detail we still need before we can quote. */
export function missingSlot(slots: CallSlots): keyof CallSlots | null {
  if (!slots.serviceSlug) return 'serviceSlug';
  if (slots.bedrooms === undefined) return 'bedrooms';
  if (slots.bathrooms === undefined) return 'bathrooms';
  if (!slots.city) return 'city';
  return null;
}
