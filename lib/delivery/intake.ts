import type { ElevatorState, HandoffType } from './types';
import { estimateLaundry, type LaundryEstimate } from './pricing';

/**
 * Turning a text message into an order.
 *
 * The customer writes "necesito recoger 3 bolsas en 1234 SW 8th St apt 502,
 * hoy a las 5" and expects that to be enough. It nearly is — and everything
 * that can be read out of that sentence is a question nobody has to be asked.
 *
 * Two design choices worth defending:
 *
 * 1. **Deterministic first.** Regexes, bilingual, no model call. Parsing a bag
 *    count is not a job for an LLM, and a rule that fails does so predictably
 *    and cheaply. `lib/assistant.ts` can take over the conversational repair
 *    when a field is missing — that is where a model earns its cost.
 * 2. **Every extracted field is also an engine input.** "apt 502" is not just
 *    an address line, it is floor 5, which is 2.4 minutes of vertical time and
 *    14 points of complexity. Intake is where the time model gets its data, so
 *    it asks for the floor rather than hoping.
 */

export interface ParsedIntake {
  items: number;
  floor: number | null;
  /** Address as written, best effort. */
  address: string | null;
  elevatorHint: ElevatorState;
  handoff: HandoffType;
  /** Requested pickup, when the message says one. */
  when: string | null;
  estimate: LaundryEstimate;
  /** Fields the engine needs that the message did not contain. */
  missing: ('address' | 'floor')[];
  language: 'es' | 'en';
}

const ES_MARKERS = /\b(bolsa|bolsas|recoger|lavander|piso|ascensor|hoy|mañana|manana|ropa|necesito|apartamento)\b/i;

export function parseIntake(text: string): ParsedIntake {
  const raw = text.trim();
  const language: 'es' | 'en' = ES_MARKERS.test(raw) ? 'es' : 'en';

  // ── Bags ───────────────────────────────────────────────────────────────────
  const bagMatch = raw.match(/(\d+)\s*(bolsas?|bags?|loads?|cargas?)/i);
  const items = bagMatch ? Math.min(20, Math.max(1, parseInt(bagMatch[1], 10))) : 1;

  // ── Floor ──────────────────────────────────────────────────────────────────
  // "apt 502" means the 5th floor; "piso 6" and "6to piso" mean the 6th.
  let floor: number | null = null;
  const pisoMatch = raw.match(/(?:piso|floor)\s*(\d{1,2})/i) ?? raw.match(/(\d{1,2})\s*(?:er|do|to|mo|vo|st|nd|rd|th)?\s*(?:piso|floor)/i);
  if (pisoMatch) floor = clampFloor(parseInt(pisoMatch[1], 10));

  const unitMatch = raw.match(/(?:apt|apto|apartamento|unit|suite|ste|#)\s*\.?\s*([0-9]{1,4})/i);
  if (floor === null && unitMatch) {
    const unit = unitMatch[1];
    // 502 → 5th floor, 12 → 1st floor, 4 → 4th floor. Wrong sometimes; the
    // courier's first visit corrects it, and a guess beats no floor at all.
    floor = clampFloor(unit.length >= 3 ? parseInt(unit.slice(0, unit.length - 2), 10) : parseInt(unit, 10) > 20 ? 1 : parseInt(unit, 10));
  }

  // ── Elevator ───────────────────────────────────────────────────────────────
  let elevatorHint: ElevatorState = 'unknown';
  if (/\b(sin ascensor|no elevator|walk[- ]?up|escaleras?|stairs)\b/i.test(raw)) elevatorHint = 'no';
  else if (/\b(con ascensor|ascensor|elevator|lift)\b/i.test(raw)) elevatorHint = 'yes';

  // ── Handoff ────────────────────────────────────────────────────────────────
  let handoff: HandoffType = 'hand_to_customer';
  if (/\b(deja(r|lo)? en la puerta|leave (it )?at (the )?door|dejalo afuera)\b/i.test(raw)) handoff = 'leave_at_door';
  else if (/\b(bajo|te espero abajo|meet me outside|lobby|downstairs)\b/i.test(raw)) handoff = 'meet_outside';

  // ── Address ────────────────────────────────────────────────────────────────
  const address = extractAddress(raw);

  // ── When ───────────────────────────────────────────────────────────────────
  const whenMatch = raw.match(/\b(hoy|mañana|manana|today|tomorrow|tonight|esta tarde|esta noche)\b[^,.;]*/i)
    ?? raw.match(/\b(?:a las|at)\s*\d{1,2}\s*(?::\d{2})?\s*(?:am|pm|hrs)?/i);

  const missing: ParsedIntake['missing'] = [];
  if (!address) missing.push('address');
  if (floor === null) missing.push('floor');

  return {
    items,
    floor,
    address,
    elevatorHint,
    handoff,
    when: whenMatch ? whenMatch[0].trim() : null,
    estimate: estimateLaundry(items),
    missing,
    language,
  };
}

function clampFloor(n: number): number | null {
  if (!Number.isFinite(n) || n < 1 || n > 60) return null;
  return n;
}

/**
 * Pulls the street address out of a sentence. Anchored on a house number
 * followed by street words, which is reliable enough in a US market and fails
 * loudly (null) rather than confidently wrong.
 */
function extractAddress(text: string): string | null {
  const afterPreposition = text.match(/\b(?:en|at|dirección|direccion|address)\s*:?\s*([^,.;\n]{6,120})/i);
  const numbered = text.match(
    /\b(\d{1,6}\s+(?:[NSEW]{1,2}\.?\s+)?[A-Za-z0-9À-ÿ'.\-]+(?:\s+[A-Za-z0-9À-ÿ'.\-]+){0,4}\s*(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ct|court|ln|lane|way|ter|terrace|pl|place|calle|avenida)\.?)/i,
  );

  const candidate = numbered?.[1] ?? afterPreposition?.[1];
  if (!candidate) return null;

  // Trim trailing unit references — they belong in `floor`, not the street line.
  return candidate.replace(/\s*(?:,)?\s*(?:apt|apto|apartamento|unit|suite|ste|#)\s*\.?\s*[0-9]{1,4}\s*$/i, '').trim();
}

/**
 * What to text back. Either the estimate and a card link, or exactly the one
 * question we still need answered — never a form, never a menu.
 */
export function intakeReply(parsed: ParsedIntake, opts: { ref?: string; cardUrl?: string | null } = {}): string {
  const es = parsed.language === 'es';

  if (parsed.missing.includes('address')) {
    return es
      ? '¡Listo! ¿Cuál es la dirección de recogida (calle y número)?'
      : 'Got it! What’s the pickup address (street and number)?';
  }

  if (parsed.missing.includes('floor')) {
    return es
      ? '¿En qué piso estás? Nos ayuda a calcular el tiempo real de la entrega.'
      : 'Which floor are you on? It helps us plan the trip properly.';
  }

  const estimate = parsed.estimate;
  const money = `$${estimate.low.toFixed(2)}–$${estimate.high.toFixed(2)}`;

  if (opts.cardUrl) {
    return es
      ? `Perfecto — ${parsed.items} ${parsed.items === 1 ? 'bolsa' : 'bolsas'} (~${estimate.estimatedPounds} lb), aprox. ${money} con recogida y entrega. Guarda tu tarjeta aquí (no se cobra nada ahora, solo después de pesar): ${opts.cardUrl}`
      : `Perfect — ${parsed.items} ${parsed.items === 1 ? 'bag' : 'bags'} (~${estimate.estimatedPounds} lb), about ${money} including pickup and delivery. Save your card here (nothing is charged now, only after it's weighed): ${opts.cardUrl}`;
  }

  return es
    ? `Perfecto — ${parsed.items} ${parsed.items === 1 ? 'bolsa' : 'bolsas'} (~${estimate.estimatedPounds} lb), aprox. ${money}. Te mandamos el enlace de pago en un momento${opts.ref ? ` (orden ${opts.ref})` : ''}.`
    : `Perfect — ${parsed.items} ${parsed.items === 1 ? 'bag' : 'bags'} (~${estimate.estimatedPounds} lb), about ${money}. We'll text you the payment link in a moment${opts.ref ? ` (order ${opts.ref})` : ''}.`;
}
