import type { Lang } from '../capture/lang';
import type { RoomType } from './types';

/**
 * What the bot says about a room as the person leaves it — "La cocina se ve
 * muy bien; lo que más trabajo va a dar es la campana, que tiene grasa".
 *
 * This is the part that makes the walkthrough feel like talking to a person
 * rather than filling in a form, so the temptation is to let the model write
 * it. It does not, for two reasons.
 *
 * It must not contradict the price. A model asked to be friendly says "your
 * kitchen looks great!" about a kitchen it then scores as filthy, and the
 * customer remembers the compliment when the number arrives. So the sentence
 * is assembled here from the same per-object scores, and can only ever say
 * what those scores say.
 *
 * And it must be safe to say out loud in someone's home. Free text from a
 * model can describe the people as well as the stove. Templates over a fixed
 * vocabulary — these rooms, these objects, these seven problems — cannot.
 *
 * Every sentence also exists in both languages by construction, and none of
 * them may contain a word the walkthrough listens for: the phone hears itself.
 */

export const ISSUES = ['grease', 'dust', 'stains', 'limescale', 'mold', 'hair', 'food'] as const;
export type Issue = (typeof ISSUES)[number];

/** How dirty one object looked in the room's sweep. */
export interface ObjectCondition {
  name: string;
  /** 0 clean, 1 a little, 2 dirty, 3 very dirty. */
  dirt: number;
  issue?: Issue;
  confidence: number;
}

type Words = Record<Lang, string>;

const ROOM: Record<RoomType, Words> = {
  kitchen: { es: 'La cocina', en: 'The kitchen' },
  bathroom: { es: 'El baño', en: 'The bathroom' },
  bedroom: { es: 'La habitación', en: 'The bedroom' },
  living_room: { es: 'La sala', en: 'The living room' },
  dining_room: { es: 'El comedor', en: 'The dining room' },
  office: { es: 'La oficina', en: 'The office' },
  laundry: { es: 'El lavadero', en: 'The laundry room' },
  garage: { es: 'El garaje', en: 'The garage' },
  stairs: { es: 'La escalera', en: 'The staircase' },
  hallway: { es: 'El pasillo', en: 'The hallway' },
  patio: { es: 'El patio', en: 'The patio' },
  other: { es: 'Este espacio', en: 'This space' },
};

/**
 * Objects worth naming, with their article. Deliberately the ones a person
 * would point at — "the oven", not "the knife block". An object missing here
 * is simply not mentioned.
 */
const NOUN: Record<string, Words | ((room: RoomType) => Words)> = {
  oven: { es: 'el horno', en: 'the oven' },
  stove: { es: 'la estufa', en: 'the stove' },
  cooktop: { es: 'la placa', en: 'the cooktop' },
  'range hood': { es: 'la campana', en: 'the range hood' },
  refrigerator: { es: 'la nevera', en: 'the fridge' },
  fridge: { es: 'la nevera', en: 'the fridge' },
  freezer: { es: 'el congelador', en: 'the freezer' },
  microwave: { es: 'el microondas', en: 'the microwave' },
  dishwasher: { es: 'el lavavajillas', en: 'the dishwasher' },
  'toaster oven': { es: 'el horno tostador', en: 'the toaster oven' },
  sink: (room) => (room === 'bathroom' ? { es: 'el lavamanos', en: 'the sink' } : { es: 'el fregadero', en: 'the sink' }),
  faucet: { es: 'el grifo', en: 'the faucet' },
  backsplash: { es: 'los azulejos de la cocina', en: 'the backsplash' },
  countertop: { es: 'la encimera', en: 'the countertop' },
  'kitchen island': { es: 'la isla', en: 'the kitchen island' },
  cabinet: { es: 'los gabinetes', en: 'the cabinets' },
  'trash can': { es: 'el cubo de basura', en: 'the trash can' },
  toilet: { es: 'el inodoro', en: 'the toilet' },
  shower: { es: 'la ducha', en: 'the shower' },
  bathtub: { es: 'la bañera', en: 'the tub' },
  'shower door': { es: 'la mampara', en: 'the shower door' },
  mirror: { es: 'el espejo', en: 'the mirror' },
  vanity: { es: 'el mueble del baño', en: 'the vanity' },
  bed: { es: 'la cama', en: 'the bed' },
  sofa: { es: 'el sofá', en: 'the sofa' },
  couch: { es: 'el sofá', en: 'the sofa' },
  armchair: { es: 'el sillón', en: 'the armchair' },
  rug: { es: 'la alfombra', en: 'the rug' },
  carpet: { es: 'la alfombra', en: 'the carpet' },
  window: { es: 'las ventanas', en: 'the windows' },
  'window sill': { es: 'los marcos de las ventanas', en: 'the window sills' },
  blinds: { es: 'las persianas', en: 'the blinds' },
  desk: { es: 'el escritorio', en: 'the desk' },
  'dining table': { es: 'la mesa', en: 'the table' },
  'coffee table': { es: 'la mesa de centro', en: 'the coffee table' },
  baseboard: { es: 'los rodapiés', en: 'the baseboards' },
  'ceiling fan': { es: 'el ventilador de techo', en: 'the ceiling fan' },
  'washing machine': { es: 'la lavadora', en: 'the washer' },
  dryer: { es: 'la secadora', en: 'the dryer' },
  'litter box': { es: 'el arenero', en: 'the litter box' },
};

const ISSUE_WORDS: Record<Issue, Words> = {
  grease: { es: 'grasa', en: 'grease' },
  dust: { es: 'polvo', en: 'dust' },
  stains: { es: 'manchas', en: 'stains' },
  limescale: { es: 'cal', en: 'limescale' },
  mold: { es: 'moho', en: 'mold' },
  hair: { es: 'pelo', en: 'hair' },
  food: { es: 'restos de comida', en: 'food residue' },
};

/** Below this the model is guessing at the object, let alone its state. */
const MIN_CONFIDENCE = 0.45;

/** Named objects in the catalogue, for the test that keeps this table honest. */
export function namedObjects(): string[] {
  return Object.keys(NOUN);
}

/** "la lavadora" / "the washer", or null for an object not worth naming. */
export function objectNoun(name: string, room: RoomType, lang: Lang): string | null {
  return nounFor(name, room, lang);
}

function nounFor(name: string, room: RoomType, lang: Lang): string | null {
  const entry = NOUN[name];
  if (!entry) return null;
  return (typeof entry === 'function' ? entry(room) : entry)[lang];
}

/**
 * The gate a model reply passes through: dirt clamped to 0–3, issues from the
 * list only. An object with no dirt score says nothing about the room.
 */
export function coerceConditions(raw: unknown): ObjectCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: ObjectCondition[] = [];
  for (const o of raw.slice(0, 25)) {
    const r = o as { name?: unknown; dirt?: unknown; issue?: unknown; confidence?: unknown };
    const name = String(r?.name ?? '').trim().toLowerCase();
    const dirt = Number(r?.dirt);
    if (!name || r?.dirt === undefined || r?.dirt === null || !Number.isFinite(dirt)) continue;
    const issue = String(r?.issue ?? '').trim().toLowerCase();
    out.push({
      name,
      dirt: Math.max(0, Math.min(3, Math.round(dirt))),
      issue: (ISSUES as readonly string[]).includes(issue) ? (issue as Issue) : undefined,
      confidence: Math.max(0, Math.min(Number(r?.confidence) || 0.5, 1)),
    });
  }
  return out;
}

function join(items: string[], lang: Lang): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${lang === 'en' ? 'and' : 'y'} ${items[items.length - 1]}`;
}

/**
 * The sentence for one room, or null when there is nothing honest to say —
 * no scored objects, or none the table can name. Silence is better than a
 * remark about a room the camera barely saw.
 */
export function roomRemark(room: RoomType, conditions: ObjectCondition[], lang: Lang): string | null {
  const seen = new Map<string, ObjectCondition & { noun: string }>();
  for (const c of conditions) {
    if (c.confidence < MIN_CONFIDENCE) continue;
    const noun = nounFor(c.name, room, lang);
    if (!noun) continue;
    // "fridge" and "refrigerator" are one appliance; keep the dirtier sighting.
    const prev = seen.get(noun);
    if (!prev || c.dirt > prev.dirt) seen.set(noun, { ...c, noun });
  }
  const named = [...seen.values()];
  if (named.length === 0) return null;

  const subject = ROOM[room]?.[lang] ?? ROOM.other[lang];
  const worst = named.filter((c) => c.dirt >= 2).sort((a, b) => b.dirt - a.dirt).slice(0, 2);
  const slight = named.filter((c) => c.dirt === 1).slice(0, 2);

  if (worst.length) {
    // The problem is named only for the first, so the sentence stays one
    // breath long: "la campana, que tiene grasa, y el horno".
    const [first, second] = worst;
    const issue = first.issue ? ISSUE_WORDS[first.issue][lang] : null;
    const lead =
      lang === 'en'
        ? issue
          ? `${first.noun}, which has some ${issue}`
          : first.noun
        : issue
          ? `${first.noun}, que tiene ${issue}`
          : first.noun;
    const list = second ? `${lead}${lang === 'en' ? ', and' : ', y'} ${second.noun}` : lead;

    if (worst.some((c) => c.dirt === 3)) {
      return lang === 'en'
        ? `${subject} is going to need some work. The toughest part will be ${list}; we will start there.`
        : `${subject} va a necesitar trabajo. Lo que más va a costar es ${list}; por ahí empezamos.`;
    }
    return lang === 'en'
      ? `${subject} is in decent shape overall. What will take the most work is ${list}; we will put the emphasis there.`
      : `${subject} está bastante bien. Lo que más trabajo va a dar es ${list}; ahí vamos a poner énfasis.`;
  }

  if (slight.length) {
    const list = join(slight.map((c) => c.noun), lang);
    return lang === 'en'
      ? `${subject} looks really nice. Just a few small details on ${list}; we will pay attention there.`
      : `${subject} se ve muy bien. Solo hay unos detalles en ${list}; ahí pondremos atención.`;
  }

  // Everything named is clean. "Impecable" only on real evidence — two or
  // more objects seen clean — so one clean mirror does not make a spotless room.
  if (named.length >= 2) {
    return lang === 'en' ? `${subject} looks spotless.` : `${subject} se ve impecable.`;
  }
  return lang === 'en' ? `${subject} looks really nice.` : `${subject} se ve muy bien.`;
}
