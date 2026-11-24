/**
 * Things that are broken — a different question from things that are dirty.
 *
 * Two reasons to look for them, and neither of them is the price of the clean.
 *
 * The customer may want them fixed. A cabinet door hanging off its hinge is a
 * job somebody is going to do, and the walkthrough that noticed it is the
 * obvious moment to ask. The answer is a lead, never a number: this engine
 * does not price repairs and must not look as if it does. The company that
 * receives the lead decides whether it repairs, refers, or says no.
 *
 * And the crew has to know it was broken before they arrived. The expensive
 * conversation in this trade is "you broke my cabinet". A list made from the
 * customer's own walkthrough, before anybody set foot in the home, is the
 * cheapest insurance the job will ever have.
 *
 * A fixed catalogue, like objects and materials: the model may only name kinds
 * from this table, so it cannot volunteer "the owners seem careless" into a
 * sentence a customer will hear.
 */

import type { DetectedDamage } from './types';

export interface DamageKind {
  /** Told to the vision model so it knows what counts. */
  looksLike: string;
  /** Said to the customer after "Veo …". */
  seen: string;
  /** Short, for the crew's notes and the company's lead. */
  label: string;
}

export const DAMAGE: Record<string, DamageKind> = {
  wall: {
    looksLike: 'a hole, crack, dent or broken plaster in a wall',
    seen: 'un golpe o un hueco en la pared',
    label: 'pared dañada',
  },
  ceiling: {
    looksLike: 'a water stain, crack, sag or peeling patch on a ceiling',
    seen: 'una mancha de agua o una grieta en el techo',
    label: 'techo con mancha o grieta',
  },
  cabinet: {
    looksLike: 'a cabinet or drawer that is broken, hanging off its hinge, missing its door, or swollen from water',
    seen: 'un gabinete o un cajón roto',
    label: 'gabinete o cajón roto',
  },
  door: {
    looksLike: 'a room door that is broken, off its hinges, or has a hole in it',
    seen: 'una puerta dañada',
    label: 'puerta dañada',
  },
  floor: {
    looksLike: 'floorboards or floor tiles that are broken, lifted, missing or water-damaged',
    seen: 'una parte del suelo levantada o rota',
    label: 'suelo levantado o roto',
  },
  tile: {
    looksLike: 'wall tiles that are cracked, broken or missing, or grout that has fallen out',
    seen: 'azulejos rotos o sin junta',
    label: 'azulejos rotos o sin junta',
  },
  fixture: {
    looksLike: 'a faucet, handle, knob, towel bar or light fixture that is broken, hanging loose or missing',
    seen: 'un grifo, una manija o una lámpara rota',
    label: 'grifo, manija o lámpara rota',
  },
  window: {
    looksLike: 'a cracked window pane, a broken frame, or a torn screen',
    seen: 'una ventana rota o con la malla rasgada',
    label: 'ventana dañada',
  },
};

/**
 * Two thresholds, because the two mistakes cost different things — the same
 * shape as materials.ts.
 *
 * Telling somebody "veo un hueco en tu pared" when there is none is an insult
 * about their home, so the customer is only asked on a firm sighting. Telling
 * the crew to check a cabinet that turns out fine costs nothing, so they are
 * told on a weaker one.
 */
export const ASK_REPAIR_AT = 0.6;
export const NOTE_DAMAGE_AT = 0.4;

/**
 * Known kinds only, one entry each, keeping the firmest sighting.
 *
 * The gate every model reply passes through: a kind outside the table, a
 * free-text description, an opinion — none of it gets past this line.
 */
export function knownDamage(raw: unknown): DetectedDamage[] {
  if (!Array.isArray(raw)) return [];
  const best = new Map<string, number>();
  for (const d of raw.slice(0, 12)) {
    const kind = String((d as { kind?: unknown })?.kind ?? '').trim().toLowerCase();
    if (!DAMAGE[kind]) continue;
    const confidence = Math.max(0, Math.min(Number((d as { confidence?: unknown })?.confidence) || 0.5, 1));
    best.set(kind, Math.max(best.get(kind) ?? 0, confidence));
  }
  return [...best.entries()].map(([kind, confidence]) => ({ kind, confidence }));
}

function joinEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/**
 * The question, in Spanish — one per room however many things are broken in
 * it. A yes is a request to be contacted, nothing more.
 */
export function repairPrompt(kinds: string[]): string | null {
  const seen = kinds.filter((k) => DAMAGE[k]).map((k) => DAMAGE[k].seen);
  return seen.length ? `Veo ${joinEs(seen)}. ¿Quieres que te contactemos para arreglar eso también?` : null;
}

/** The kinds firm enough to mention to the customer, firmest first. */
export function askableDamage(damage: DetectedDamage[] | undefined): string[] {
  return (damage ?? [])
    .filter((d) => DAMAGE[d.kind] && d.confidence >= ASK_REPAIR_AT)
    .sort((a, b) => b.confidence - a.confidence)
    .map((d) => d.kind);
}

/**
 * What the crew reads at the door, for one room.
 *
 * Phrased as an instruction, not a fact, because a phone photo can be wrong:
 * the point is to look before touching, and to have the customer see it too.
 */
export function damageCaution(damage: DetectedDamage[] | undefined): string | undefined {
  const seen = (damage ?? []).filter((d) => d.confidence >= NOTE_DAMAGE_AT && DAMAGE[d.kind]);
  if (!seen.length) return undefined;
  const labels = seen.map((d) => DAMAGE[d.kind].label).join(', ');
  return `Ya estaba así en el recorrido: ${labels}. Míralo con el cliente antes de empezar y no lo fuerces.`;
}

/** The section of the vision prompts that asks for damage. Shared so the two cannot drift. */
export function damagePromptSection(): string {
  return `Separately, report anything visibly BROKEN or DAMAGED — not dirty: broken. Use EXACTLY these kinds; anything else is discarded:

${Object.entries(DAMAGE)
  .map(([kind, d]) => `- ${kind}: ${d.looksLike}`)
  .join('\n')}

Only report damage you can plainly see in a frame. Dirt, stains that would wipe off, scuffs and ordinary wear are not damage. Never guess at what might be behind a closed door, and never describe the people who live there.`;
}
