import { normalize } from '../vision/voice-commands';
import type { ProductPreference } from '../vision/types';
import type { Lang } from './lang';

export type { ProductPreference };

/**
 * The talking half of the walkthrough: what the bot says between shots, and
 * how it understands the answer — in Spanish and in English.
 *
 * The person is holding a phone up at a room, often with a fridge door in the
 * other hand. They cannot read a card and tap "Sí" at the same time, so every
 * question is also said out loud and can be answered out loud. The buttons
 * stay — a browser without speech recognition (Firefox) still needs them —
 * but they are the fallback, not the conversation.
 *
 * Understanding is deliberately small: yes, no, and "carry on". Anything else
 * is ignored rather than guessed at, because a misheard "sí" adds minutes to
 * somebody's bill.
 *
 * The answers are understood in BOTH languages whichever one the bot speaks.
 * Households here switch mid-sentence — "yes, a fondo" — and refusing a
 * perfectly clear "yes" because the walk started in Spanish would be the app
 * being pedantic at the customer's expense.
 */

const YES = [
  // Spanish
  'si', 'claro', 'dale', 'vale', 'bueno', 'okay', 'ok', 'correcto', 'porfa', 'perfecto', 'exacto', 'obvio',
  // English
  'yes', 'yeah', 'yep', 'sure', 'absolutely', 'definitely', 'correct', 'please',
];
const YES_PHRASES = ['por favor', 'de acuerdo', 'me parece bien', 'claro que si', 'of course', 'go ahead', 'sounds good'];
const NO = ['no', 'nada', 'tampoco', 'nope', 'nah', 'negativo', 'negative'];
const NO_PHRASES = [
  'no gracias', 'mejor no', 'para nada', 'claro que no',
  'no thanks', 'no thank you', 'not really', 'not now', 'no need', 'not needed',
];
/** Said by somebody thinking, not answering. */
const UNSURE = [/\bno se\b/, /\bno estoy segur/, /\bdon'?t know\b/, /\bnot sure\b/, /\bmaybe\b/, /\bquizas?\b/];

/**
 * "Sigue", "next" — get on with the walkthrough, whatever is unanswered.
 *
 * Not "done" and not "carry on": the bot says those itself ("Noted, let's
 * carry on"), and anything the bot says must not be an instruction to it.
 */
const CONTINUE = ['seguir', 'sigue', 'siguiente', 'continuar', 'continua', 'continuemos', 'adelante', 'listo', 'continue', 'next', 'skip'];
const CONTINUE_PHRASES = ['move on', 'go on', 'keep going'];
/** "La semana siguiente", "next week": a day, not "move on". */
const NAMES_A_WEEK = /\b(next|proxima|siguiente) (week|semana)\b|\bsemana siguiente\b/;

/**
 * True for yes, false for no, null for anything that is not clearly one.
 *
 * "No sé" is not a no. "Sí, pero no el horno" is not anything. Both come back
 * null and the question stays open, which costs one more tap; reading either
 * as an answer costs minutes the customer did not agree to, or work they
 * wanted and will not get.
 */
export function parseYesNo(heard: string): boolean | null {
  const text = normalize(heard);
  if (!text) return null;
  if (UNSURE.some((re) => re.test(text))) return null;

  const words = text.split(' ');
  const yes = words.some((w) => YES.includes(w)) || YES_PHRASES.some((p) => text.includes(p));
  const no = words.some((w) => NO.includes(w)) || NO_PHRASES.some((p) => text.includes(p));

  if (yes && !no) return true;
  if (no && !yes) return false;
  // "No, gracias" contains no yes-word; "sí, no hay problema" does contain
  // both. Mixed answers are only trusted when the phrase itself is a known no.
  if (no && NO_PHRASES.some((p) => text.includes(p))) return false;
  return null;
}

/** True when the person asked to move on rather than answer. */
export function wantsToContinue(heard: string): boolean {
  const text = normalize(heard);
  if (NAMES_A_WEEK.test(text)) return false;
  return text.split(' ').some((w) => CONTINUE.includes(w)) || CONTINUE_PHRASES.some((p) => text.includes(p));
}

/**
 * Spoken between questions. Kept here so the tests can check them.
 *
 * None of these may contain an answer. The phone's speaker reaches its own
 * microphone, and the guard against hearing itself is a timer: a result that
 * lands a second after the phone stops talking gets through. "¿Por encima, a
 * fondo o de mudanza?" heard back would book a move-out clean. So the options
 * are on the screen, where the person is already looking once the filming is
 * over, and the spoken question only asks.
 */
export const SAY_CHAT = {
  es: {
    /** After the last answer given by voice, as the walk resumes. */
    moveOn: 'Anotado, seguimos.',
    /** The closing questions, once the rooms are done. */
    when: '¿Qué día te vendría bien la limpieza?',
    products: '¿Con qué productos prefieres que limpiemos?',
    tools: '¿Tienes aspiradora y trapeador que podamos usar, o los traemos nosotros?',
    depth: '¿Y qué tipo de limpieza quieres?',
    closing: 'Muy bien, gracias.',
    /** When the last room is done. */
    done: 'Ya está todo, gracias.',
  },
  en: {
    moveOn: 'Noted, let us carry on.',
    when: 'What day would work for the cleaning?',
    products: 'What products would you like us to use?',
    tools: 'Do you have a vacuum and a mop we can use, or should we bring ours?',
    depth: 'And what kind of cleaning would you like?',
    closing: 'Great, thank you.',
    done: 'That is everything, thank you.',
  },
} as const;

/**
 * Words that drive the camera while a step is open, per language.
 *
 * A command has to be a word nobody says by accident. `ya`, `ahora`, `ok`
 * used to be here and are gone: the phone said them in its own instructions,
 * and people say them constantly to whoever is with them. The same rule holds
 * in English — no "okay", no "now".
 */
export const COMMANDS: Record<Lang, { capture: string[]; skip: string[] }> = {
  es: {
    capture: ['listo', 'foto', 'toma', 'dale', 'ready'],
    skip: ['saltar', 'salta', 'no tengo', 'no hay', 'siguiente', 'pasa', 'skip'],
  },
  en: {
    capture: ['ready', 'shoot', 'snap', 'capture', 'photo'],
    skip: ['skip', 'next', "don't have", 'dont have', 'none', 'pass'],
  },
};

// ── The closing chat ─────────────────────────────────────────────────────────
//
// Asked once the rooms are filmed: when, with what, and with whose vacuum.
// None of it changes the minutes. All of it is what the company would ask on
// the phone before agreeing to a time — asked here, it arrives with the lead
// instead of costing a call.

export type WhenPreference = 'asap' | 'this_week' | 'next_week' | 'date';
export type TimeOfDay = 'morning' | 'afternoon' | 'any';
/** Whose vacuum and mop. */
export type ToolsPreference = 'customer' | 'bring';

export interface VisitDetails {
  when?: WhenPreference;
  /** YYYY-MM-DD, when `when` is 'date'. */
  date?: string;
  timeOfDay?: TimeOfDay;
  products?: ProductPreference;
  tools?: ToolsPreference;
}

export const WHEN_LABELS: Record<Lang, Record<WhenPreference, string>> = {
  es: { asap: 'Lo antes posible', this_week: 'Esta semana', next_week: 'La semana que viene', date: 'Elegir día' },
  en: { asap: 'As soon as possible', this_week: 'This week', next_week: 'Next week', date: 'Pick a day' },
};
export const TIME_LABELS: Record<Lang, Record<TimeOfDay, string>> = {
  es: { morning: 'Por la mañana', afternoon: 'Por la tarde', any: 'Me da igual la hora' },
  en: { morning: 'In the morning', afternoon: 'In the afternoon', any: 'Any time' },
};
export const PRODUCT_LABELS: Record<Lang, Record<ProductPreference, string>> = {
  es: { standard: 'Los normales', eco: 'Ecológicos', unscented: 'Sin olor', own: 'Uso los míos' },
  en: { standard: 'The usual', eco: 'Eco-friendly', unscented: 'Unscented', own: 'I will use mine' },
};
export const TOOLS_LABELS: Record<Lang, Record<ToolsPreference, string>> = {
  es: { customer: 'Tengo, pueden usarlos', bring: 'Tráiganlos ustedes' },
  en: { customer: 'I have them, use mine', bring: 'Please bring yours' },
};

/** "esta semana por la mañana", "next week in the afternoon" — either part, both, or neither. */
export function parseWhen(heard: string): { when?: WhenPreference; timeOfDay?: TimeOfDay } {
  const t = normalize(heard);
  const out: { when?: WhenPreference; timeOfDay?: TimeOfDay } = {};
  if (/\b(lo antes posible|cuanto antes|lo mas pronto|urgente|pronto|as soon as possible|asap|soon|urgent|right away)\b/.test(t)) {
    out.when = 'asap';
  } else if (/\b(proxima semana|semana que viene|siguiente semana|semana siguiente|next week)\b/.test(t)) {
    out.when = 'next_week';
  } else if (/\b(esta semana|this week)\b/.test(t)) {
    out.when = 'this_week';
  }
  if (/\b(por|en) la manana\b|\bmorning\b/.test(t)) out.timeOfDay = 'morning';
  else if (/\b(por|en) la tarde\b|\bafternoon\b/.test(t)) out.timeOfDay = 'afternoon';
  else if (/\b(me da igual|da igual|cualquier hora|any ?time|doesn'?t matter|don'?t mind|whenever)\b/.test(t)) {
    out.timeOfDay = 'any';
  }
  return out;
}

export function parseProducts(heard: string): ProductPreference | null {
  const t = normalize(heard);
  if (/\b(los mios|las mias|mis productos|tengo los mios|uso los mios|my own|mine|our own)\b/.test(t)) return 'own';
  if (/\b(sin olor|sin perfume|sin fragancia|neutros?|unscented|fragrance[ -]free|scent[ -]free|no smell|no scent)\b/.test(t)) {
    return 'unscented';
  }
  if (/\b(ecologic\w*|eco\w*|naturales?|natural|green|non[ -]toxic)\b/.test(t)) return 'eco';
  if (/\b(normales?|los de siempre|cualquiera|da igual|usual|regular|standard|whatever)\b/.test(t)) return 'standard';
  return null;
}

export function parseTools(heard: string): ToolsPreference | null {
  const t = normalize(heard);
  // "No tengo" before "tengo", "don't have" before "have": the longer phrase
  // carries the meaning.
  if (
    /\b(no tengo|no hay|traiganlos|traiganlas|traigan|traelos|los traen|traiganla|don'?t have|do not have|bring them|bring yours|bring your own|please bring|you bring)\b/.test(
      t,
    )
  ) {
    return 'bring';
  }
  if (/\b(tengo|si hay|pueden usar|usen los mios|usen las mias|i have|we have|i do|we do|use mine|use ours|you can use)\b/.test(t)) {
    return 'customer';
  }
  const yes = parseYesNo(t);
  return yes === true ? 'customer' : yes === false ? 'bring' : null;
}

/** The depth of clean, from the closing question. Slugs match the services. */
export function parseDepth(heard: string): string | null {
  const t = normalize(heard);
  if (/\b(mudanza|entrega|vacia|vacio|move[ -]out|moving out|moving|empty)\b/.test(t)) return 'move-out-cleaning';
  if (/\b(a fondo|profunda|profundo|completa|completo|deep|thorough|top to bottom)\b/.test(t)) return 'deep-cleaning';
  if (/\b(por encima|normal|mantenimiento|basica|basico|ligera|ligero|standard|regular|light|basic|upkeep)\b/.test(t)) {
    return 'house-cleaning';
  }
  return null;
}

/** "2026-12-03" as a person says it: "jueves 3 de diciembre". */
export function spokenDate(iso: string): string {
  const day = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(day.getTime())) return iso;
  try {
    return day.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
  } catch {
    return iso;
  }
}

/**
 * One paragraph for the company: what the customer said in the closing chat.
 * Undefined when they said nothing, so an empty sentence never reaches a lead.
 *
 * Always Spanish, whatever the customer spoke: it is read by the company, not
 * by the customer, and the company that reads it today reads Spanish. A
 * tenant that works in English is a setting for later, not a guess now.
 */
export function visitNote(details: VisitDetails): string | undefined {
  const parts: string[] = [];
  const labels = { when: WHEN_LABELS.es, time: TIME_LABELS.es, products: PRODUCT_LABELS.es };

  const day =
    details.when === 'date' && details.date
      ? `el ${spokenDate(details.date)}`
      : details.when && details.when !== 'date'
        ? labels.when[details.when].toLowerCase()
        : undefined;
  const time = details.timeOfDay && details.timeOfDay !== 'any' ? labels.time[details.timeOfDay].toLowerCase() : undefined;
  if (day || time) parts.push(`Día: ${[day, time].filter(Boolean).join(', ')}.`);

  if (details.products) {
    parts.push(
      details.products === 'own'
        ? 'Productos: usa los del cliente.'
        : `Productos: ${labels.products[details.products].toLowerCase()}.`,
    );
  }
  if (details.tools) {
    parts.push(
      details.tools === 'customer'
        ? 'Aspiradora y trapeador: los tiene el cliente.'
        : 'Aspiradora y trapeador: hay que llevarlos.',
    );
  }

  return parts.length ? parts.join(' ') : undefined;
}

/**
 * A question as it is said out loud: the question, then what a yes costs.
 *
 * The card shows the minutes in small print. Said aloud it has to be part of
 * the sentence, or a hands-free yes is a yes to an amount nobody heard.
 */
export function spokenQuestion(q: { prompt: string; extraMinutes: number }, lang: Lang = 'es'): string {
  if (q.extraMinutes <= 0) return q.prompt;
  return lang === 'en'
    ? `${q.prompt} That is about ${q.extraMinutes} more minutes.`
    : `${q.prompt} Serían unos ${q.extraMinutes} minutos más.`;
}
