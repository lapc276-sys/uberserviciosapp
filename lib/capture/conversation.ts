import { normalize } from '../vision/voice-commands';
import type { ProductPreference } from '../vision/types';

export type { ProductPreference };

/**
 * The talking half of the walkthrough: what the bot says between shots, and
 * how it understands the answer.
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
 */

const YES = ['si', 'claro', 'dale', 'vale', 'bueno', 'okay', 'ok', 'yes', 'correcto', 'porfa', 'perfecto', 'exacto', 'obvio'];
const YES_PHRASES = ['por favor', 'de acuerdo', 'me parece bien', 'claro que si'];
const NO = ['no', 'nada', 'tampoco', 'nope', 'negativo'];
const NO_PHRASES = ['no gracias', 'mejor no', 'para nada', 'claro que no'];

/** "Sigue", "listo" — get on with the walkthrough, whatever is unanswered. */
const CONTINUE = ['seguir', 'sigue', 'siguiente', 'continuar', 'continua', 'continuemos', 'adelante', 'listo'];

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
  if (/\bno se\b/.test(text) || /\bno estoy segur/.test(text)) return null;

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
  const words = normalize(heard).split(' ');
  return words.some((w) => CONTINUE.includes(w));
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
  /** After the last answer given by voice, as the walk resumes. */
  moveOn: 'Anotado, seguimos.',
  /** The closing questions, once the rooms are done. */
  when: '¿Qué día te vendría bien la limpieza?',
  products: '¿Con qué productos prefieres que limpiemos?',
  tools: '¿Tienes aspiradora y trapeador que podamos usar, o los traemos nosotros?',
  depth: '¿Y qué tipo de limpieza quieres?',
  closing: 'Muy bien, gracias.',
} as const;

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

export const WHEN_LABELS: Record<WhenPreference, string> = {
  asap: 'Lo antes posible',
  this_week: 'Esta semana',
  next_week: 'La semana que viene',
  date: 'Elegir día',
};
export const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: 'Por la mañana',
  afternoon: 'Por la tarde',
  any: 'Me da igual la hora',
};
export const PRODUCT_LABELS: Record<ProductPreference, string> = {
  standard: 'Los normales',
  eco: 'Ecológicos',
  unscented: 'Sin olor',
  own: 'Uso los míos',
};
export const TOOLS_LABELS: Record<ToolsPreference, string> = {
  customer: 'Tengo, pueden usarlos',
  bring: 'Tráiganlos ustedes',
};

/** "esta semana por la mañana" — either part, both, or neither. */
export function parseWhen(heard: string): { when?: WhenPreference; timeOfDay?: TimeOfDay } {
  const t = normalize(heard);
  const out: { when?: WhenPreference; timeOfDay?: TimeOfDay } = {};
  if (/\b(lo antes posible|cuanto antes|lo mas pronto|urgente|pronto)\b/.test(t)) out.when = 'asap';
  else if (/\b(proxima semana|semana que viene|siguiente semana)\b/.test(t)) out.when = 'next_week';
  else if (/\besta semana\b/.test(t)) out.when = 'this_week';
  if (/\b(por|en) la manana\b/.test(t)) out.timeOfDay = 'morning';
  else if (/\b(por|en) la tarde\b/.test(t)) out.timeOfDay = 'afternoon';
  else if (/\b(me da igual|da igual|cualquier hora)\b/.test(t)) out.timeOfDay = 'any';
  return out;
}

export function parseProducts(heard: string): ProductPreference | null {
  const t = normalize(heard);
  if (/\b(los mios|las mias|mis productos|tengo los mios|uso los mios)\b/.test(t)) return 'own';
  if (/\b(sin olor|sin perfume|sin fragancia|neutros?)\b/.test(t)) return 'unscented';
  if (/\b(ecologic\w*|eco|naturales?)\b/.test(t)) return 'eco';
  if (/\b(normales?|los de siempre|cualquiera|da igual)\b/.test(t)) return 'standard';
  return null;
}

export function parseTools(heard: string): ToolsPreference | null {
  const t = normalize(heard);
  // "No tengo" before "tengo": the longer phrase carries the meaning.
  if (/\b(no tengo|no hay|traiganlos|traiganlas|traigan|traelos|los traen|traiganla)\b/.test(t)) return 'bring';
  if (/\b(tengo|si hay|pueden usar|usen los mios|usen las mias)\b/.test(t)) return 'customer';
  const yes = parseYesNo(t);
  return yes === true ? 'customer' : yes === false ? 'bring' : null;
}

/** The depth of clean, from the closing question. Slugs match the services. */
export function parseDepth(heard: string): string | null {
  const t = normalize(heard);
  if (/\b(mudanza|entrega|vacia|vacio)\b/.test(t)) return 'move-out-cleaning';
  if (/\b(a fondo|profunda|profundo|completa|completo)\b/.test(t)) return 'deep-cleaning';
  if (/\b(por encima|normal|mantenimiento|basica|basico|ligera|ligero)\b/.test(t)) return 'house-cleaning';
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
 */
export function visitNote(details: VisitDetails): string | undefined {
  const parts: string[] = [];

  const day =
    details.when === 'date' && details.date
      ? `el ${spokenDate(details.date)}`
      : details.when && details.when !== 'date'
        ? WHEN_LABELS[details.when].toLowerCase()
        : undefined;
  const time = details.timeOfDay && details.timeOfDay !== 'any' ? TIME_LABELS[details.timeOfDay].toLowerCase() : undefined;
  if (day || time) parts.push(`Día: ${[day, time].filter(Boolean).join(', ')}.`);

  if (details.products) {
    parts.push(
      details.products === 'own'
        ? 'Productos: usa los del cliente.'
        : `Productos: ${PRODUCT_LABELS[details.products].toLowerCase()}.`,
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
export function spokenQuestion(q: { prompt: string; extraMinutes: number }): string {
  return q.extraMinutes > 0 ? `${q.prompt} Serían unos ${q.extraMinutes} minutos más.` : q.prompt;
}
