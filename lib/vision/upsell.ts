import { OBJECT_TIME_COST, depthGapFor, countCapFor, type ObjectDepth } from './model';
import {
  ROOM_LABELS_ES,
  type DetectedDamage,
  type DetectedObject,
  type RoomType,
  type SoilScores,
  type TidyingCounts,
} from './types';
import { DAMAGE, askableDamage, repairPrompt } from './damage';
import type { Lang } from '../capture/lang';
import {
  ASK_DISHES_AT,
  ASK_PUT_AWAY_AT,
  DISHES,
  PUT_AWAY,
  dishesMinutes,
  putAwayMinutes,
} from './tidying';

/**
 * What to ask the person, in the room they are standing in.
 *
 * The walkthrough used to run one fixed script in every kitchen on earth. It
 * could not ask "inside the oven?" because it did not know there was an oven,
 * so depth was a single global question at the end — and a single global
 * question is the wrong shape. Somebody wants the oven done and does not care
 * about the dishwasher, and the difference between those two answers is 14
 * minutes against 5.
 *
 * Two hard rules shape everything here.
 *
 * Only ask about what was actually seen. A question about an oven in a
 * kitchen with no oven tells the customer the app is guessing, and once they
 * believe that they stop trusting the price it produces.
 *
 * Only ask when the answer is worth minutes. Every question spends the one
 * thing a walkthrough cannot buy back, which is patience — somebody standing
 * in a stranger's kitchen holding a phone will answer three questions and
 * abandon the eighth. So they are ranked by minutes at stake and cut short,
 * which means the oven gets asked and the light switch never does.
 */

/** Below this, opening it up is not a different job. */
const MIN_GAP_MINUTES = 2;

/** A shaky detection must not produce a confident question. */
const MIN_CONFIDENCE = 0.45;

/** Nobody answers more than this standing in one room. */
export const MAX_QUESTIONS_PER_ROOM = 4;

/**
 * Clutter at which tidying is worth offering as its own job.
 *
 * Matched to the rubric the model scores against: below this it is a few
 * things on a counter that any clean moves anyway, and offering to tidy reads
 * as an upsell on nothing.
 */
const CLUTTER_OFFER_AT = 45;

/** The id suffix of a room's repair question. */
export const REPAIR = 'repair';

export type QuestionKind = 'depth' | 'declutter' | 'dishes' | 'repair';

export interface RoomQuestion {
  /** Stable id, so an answer can be matched back without string matching. */
  id: string;
  kind: QuestionKind;
  /** The object this is about, for a depth question. */
  object?: string;
  /** For a repair question: the kinds of damage seen (keys of DAMAGE). */
  damage?: string[];
  /**
   * The space it was asked in ("Baño 2"), filled in by the walkthrough, which
   * is the only part that knows. Used where the answer has to say WHICH
   * bathroom — a repair lead that says "baño" in a three-bathroom home sends
   * somebody looking.
   */
  place?: string;
  roomType: RoomType;
  /** Spanish, spoken and shown. */
  prompt: string;
  /** What it adds if they say yes. Shown so a yes is informed, not a trap. */
  extraMinutes: number;
  /** What answering yes means for the estimate. A repair question changes nothing. */
  yes: ObjectDepth;
}

/**
 * What a yes buys, said in Spanish, per object.
 *
 * Keyed by the catalogue's own names — which use spaces ("range hood"), a
 * detail the first version of this table got wrong with underscores, so half
 * its entries never matched and the fallback asked about "el range hood".
 *
 * Each entry is the whole verb phrase rather than a noun dropped into one
 * template, because one template does not survive contact with the list:
 * an oven is cleaned "por dentro", a closet is emptied, a sofa is vacuumed,
 * and nobody can clean the outside of a fourth-floor window. An object with
 * no entry is not asked about at all — a missing question costs one upsell,
 * a question in two languages costs the customer's belief that anyone
 * checked this.
 */
const ASK: Record<string, string | ((roomType: RoomType) => string)> = {
  // Cocina
  oven: 'limpiemos el horno por dentro',
  stove: 'hagamos la estufa a fondo, con quemadores y parrillas',
  cooktop: 'hagamos la placa de la cocina a fondo',
  'range hood': 'hagamos la campana a fondo, filtros incluidos',
  refrigerator: 'limpiemos la nevera por dentro',
  fridge: 'limpiemos la nevera por dentro',
  freezer: 'limpiemos el congelador por dentro',
  microwave: 'limpiemos el microondas por dentro',
  dishwasher: 'limpiemos el lavavajillas por dentro',
  'toaster oven': 'limpiemos el horno tostador por dentro',
  'air fryer': 'limpiemos la freidora de aire por dentro',
  sink: (room) =>
    room === 'bathroom' ? 'hagamos el lavamanos a fondo' : 'hagamos el fregadero a fondo',
  backsplash: 'hagamos a fondo los azulejos de la cocina',
  countertop: 'despejemos y limpiemos toda la encimera',
  'kitchen island': 'despejemos y limpiemos toda la isla de la cocina',
  cabinet: 'vaciemos y limpiemos los gabinetes por dentro',
  drawer: 'vaciemos y limpiemos los cajones por dentro',
  pantry: 'vaciemos y limpiemos la despensa por dentro',
  'trash can': 'lavemos el cubo de basura por dentro',

  // Baño
  toilet: 'hagamos el inodoro a fondo, base y juntas incluidas',
  bidet: 'hagamos el bidé a fondo',
  shower: 'hagamos la ducha a fondo, juntas incluidas',
  bathtub: 'hagamos la bañera a fondo, juntas incluidas',
  'shower door': 'quitemos la cal de la mampara de la ducha',
  'shower curtain': 'lavemos la cortina de la ducha',
  vanity: 'vaciemos y limpiemos el mueble del baño por dentro',
  'medicine cabinet': 'vaciemos y limpiemos el botiquín por dentro',
  'exhaust fan': 'limpiemos el extractor a fondo',

  // Dormitorio y sala
  closet: 'vaciemos y limpiemos el armario por dentro',
  wardrobe: 'vaciemos y limpiemos el ropero por dentro',
  dresser: 'vaciemos y limpiemos la cómoda por dentro',
  bookshelf: 'limpiemos la estantería quitando todo de los estantes',
  desk: 'despejemos y limpiemos el escritorio',
  bed: 'limpiemos también debajo y alrededor de la cama',
  'bunk bed': 'limpiemos la litera a fondo',
  mattress: 'aspiremos el colchón a fondo',
  sofa: 'aspiremos el sofá a fondo, cojines incluidos',
  couch: 'aspiremos el sofá a fondo, cojines incluidos',
  carpet: 'tratemos las manchas de la alfombra',
  rug: 'tratemos las manchas de la alfombra',
  curtains: 'aspiremos las cortinas a fondo',
  blinds: 'limpiemos las persianas lama por lama',
  // Inside only. Nobody is leaning out of a fourth-floor window, and a
  // question must not sell what the crew cannot safely do.
  window: 'limpiemos las ventanas por dentro, con marcos y rieles',
  baseboard: 'limpiemos los rodapiés uno por uno',
  'ceiling fan': 'limpiemos el ventilador de techo a fondo',
  chandelier: 'limpiemos la lámpara de araña pieza por pieza',
  radiator: 'limpiemos el radiador a fondo',
  fireplace: 'limpiemos la chimenea a fondo',
  piano: 'limpiemos el piano a fondo',

  // Lavadero y exterior
  'washing machine': 'limpiemos la lavadora por dentro',
  dryer: 'limpiemos la secadora por dentro',
  balcony: 'hagamos el balcón a fondo',

  // Bebés y mascotas
  crib: 'limpiemos la cuna a fondo',
  'high chair': 'limpiemos la silla alta del bebé a fondo',
  playpen: 'limpiemos el corral del bebé a fondo',
  stroller: 'limpiemos el cochecito a fondo',
  'litter box': 'vaciemos y lavemos el arenero del gato',
  'pet bed': 'lavemos la cama de la mascota',
  'pet crate': 'limpiemos la jaula de la mascota a fondo',
};

/**
 * The same offers in English, key for key.
 *
 * Written, not translated phrase by phrase: "hagamos la estufa a fondo" is
 * "deep clean the stove", and a word-for-word version reads like a machine,
 * which is exactly what a customer should not be thinking about while
 * deciding whether to trust the price. A key missing here means the object is
 * not asked about in English — the same rule as the Spanish table.
 */
const ASK_EN: Record<string, string | ((roomType: RoomType) => string)> = {
  // Kitchen
  oven: 'clean the inside of the oven',
  stove: 'deep clean the stove, burners and grates included',
  cooktop: 'deep clean the cooktop',
  'range hood': 'deep clean the range hood, filters included',
  refrigerator: 'clean the inside of the fridge',
  fridge: 'clean the inside of the fridge',
  freezer: 'clean the inside of the freezer',
  microwave: 'clean the inside of the microwave',
  dishwasher: 'clean the inside of the dishwasher',
  'toaster oven': 'clean the inside of the toaster oven',
  'air fryer': 'clean the inside of the air fryer',
  sink: (room) => (room === 'bathroom' ? 'deep clean the bathroom sink' : 'deep clean the kitchen sink'),
  backsplash: 'deep clean the kitchen backsplash',
  countertop: 'clear and clean the whole countertop',
  'kitchen island': 'clear and clean the whole kitchen island',
  cabinet: 'empty and clean the inside of the cabinets',
  drawer: 'empty and clean the inside of the drawers',
  pantry: 'empty and clean the inside of the pantry',
  'trash can': 'wash out the trash can',

  // Bathroom
  toilet: 'deep clean the toilet, base and seals included',
  bidet: 'deep clean the bidet',
  shower: 'deep clean the shower, grout included',
  bathtub: 'deep clean the bathtub, grout included',
  'shower door': 'remove the limescale from the shower door',
  'shower curtain': 'wash the shower curtain',
  vanity: 'empty and clean the inside of the vanity',
  'medicine cabinet': 'empty and clean the inside of the medicine cabinet',
  'exhaust fan': 'deep clean the exhaust fan',

  // Bedrooms and living areas
  closet: 'empty and clean the inside of the closet',
  wardrobe: 'empty and clean the inside of the wardrobe',
  dresser: 'empty and clean the inside of the dresser',
  bookshelf: 'clean the bookshelf, taking everything off the shelves',
  desk: 'clear and clean the desk',
  bed: 'clean under and around the bed as well',
  'bunk bed': 'deep clean the bunk bed',
  mattress: 'vacuum the mattress thoroughly',
  sofa: 'vacuum the sofa thoroughly, cushions included',
  couch: 'vacuum the sofa thoroughly, cushions included',
  carpet: 'treat the stains on the carpet',
  rug: 'treat the stains on the rug',
  curtains: 'vacuum the curtains thoroughly',
  blinds: 'clean the blinds slat by slat',
  // Inside only, as in Spanish.
  window: 'clean the windows on the inside, frames and tracks included',
  baseboard: 'clean the baseboards one by one',
  'ceiling fan': 'deep clean the ceiling fan',
  chandelier: 'clean the chandelier piece by piece',
  radiator: 'deep clean the radiator',
  fireplace: 'deep clean the fireplace',
  piano: 'deep clean the piano',

  // Laundry and outside
  'washing machine': 'clean the inside of the washing machine',
  dryer: 'clean the inside of the dryer',
  balcony: 'deep clean the balcony',

  // Babies and pets
  crib: 'deep clean the crib',
  'high chair': 'deep clean the high chair',
  playpen: 'deep clean the playpen',
  stroller: 'deep clean the stroller',
  'litter box': 'empty and wash the litter box',
  'pet bed': 'wash the pet bed',
  'pet crate': 'deep clean the pet crate',
};

/** The question for an object, or null when there is none to ask in that language. */
export function promptFor(name: string, roomType: RoomType, lang: Lang = 'es'): string | null {
  const entry = (lang === 'en' ? ASK_EN : ASK)[name];
  if (!entry) return null;
  const phrase = typeof entry === 'function' ? entry(roomType) : entry;
  return lang === 'en' ? `Would you like us to ${phrase}?` : `¿Quieres que ${phrase}?`;
}

/** Which objects have a question, per language — for the test that keeps the two tables in step. */
export function askedObjects(lang: Lang): string[] {
  return Object.keys(lang === 'en' ? ASK_EN : ASK);
}

/**
 * The verbs ASK uses, from "let's" to an instruction.
 *
 * The question to the customer and the line in the crew's plan describe the
 * same work, so they come from the same phrase — "limpiemos el horno por
 * dentro" asked, "Limpia el horno por dentro" done. Two tables would drift,
 * and the crew would be told to do something different from what was sold.
 */
const IMPERATIVE: Record<string, string> = {
  aspiremos: 'aspira',
  despejemos: 'despeja',
  hagamos: 'haz',
  lavemos: 'lava',
  limpiemos: 'limpia',
  quitemos: 'quita',
  tratemos: 'trata',
  vaciemos: 'vacía',
};

/** The crew's instruction for an object, or null when there is none. */
export function taskFor(name: string, roomType: RoomType): string | null {
  const entry = ASK[name];
  if (!entry) return null;
  const phrase = typeof entry === 'function' ? entry(roomType) : entry;
  const task = phrase
    .split(' ')
    .map((word) => IMPERATIVE[word] ?? word)
    .join(' ');
  return task.charAt(0).toUpperCase() + task.slice(1);
}

/**
 * Minutes a yes is worth, counting how many of the thing there are.
 *
 * Ten cabinet doors is not one cabinet, and the count cap is the same one the
 * estimator uses — a question that promises 40 minutes the estimate will not
 * charge for is a question that loses money on every yes.
 */
function gapMinutes(object: DetectedObject): number {
  const key = object.name.trim().toLowerCase();
  const count = Math.max(1, Math.min(object.count || 1, countCapFor(key)));
  return depthGapFor(key) * count;
}

/**
 * Builds the questions for one room from what the camera just saw.
 *
 * `alreadyDeep` is the service's own answer: on a deep clean the inside of
 * the oven is already included and sold, so asking again would invite someone
 * to decline something they have paid for.
 */
export function questionsForRoom(
  roomType: RoomType,
  objects: DetectedObject[],
  soil: SoilScores,
  {
    alreadyDeep = false,
    tidying,
    damage,
    lang = 'es',
  }: { alreadyDeep?: boolean; tidying?: TidyingCounts; damage?: DetectedDamage[]; lang?: Lang } = {},
): RoomQuestion[] {
  const questions: RoomQuestion[] = [];

  // Asked first, and never cut for room: it is not an upsell on the clean but
  // a different job the customer may well want done, and the person standing
  // in front of the broken cabinet is the one who can say so. One question per
  // room, however many things are broken in it.
  const broken = askableDamage(damage);
  const repair = repairPrompt(broken, lang);
  if (repair) {
    questions.push({
      id: `${roomType}:${REPAIR}`,
      kind: 'repair',
      damage: broken,
      roomType,
      prompt: repair,
      // No minutes and no price. A yes is a request to be contacted.
      extraMinutes: 0,
      yes: 'surface',
    });
  }

  if (!alreadyDeep) {
    const seen = new Set<string>();
    const candidates = objects
      .map((o) => ({ ...o, name: o.name.trim().toLowerCase() }))
      .filter((o) => OBJECT_TIME_COST[o.name])
      .filter((o) => (o.confidence ?? 0.5) >= MIN_CONFIDENCE)
      .filter((o) => depthGapFor(o.name) >= MIN_GAP_MINUTES)
      .map((o) => ({ object: o, minutes: gapMinutes(o), prompt: promptFor(o.name, roomType, lang) }))
      .filter((c): c is { object: DetectedObject; minutes: number; prompt: string } => c.prompt !== null)
      .sort((a, b) => b.minutes - a.minutes)
      // One question per kind of thing, judged by the question itself: two
      // fridges are one question, and so are a "sofa" and a "couch", which the
      // catalogue lists separately and the customer would hear as an echo.
      .filter((c) => (seen.has(c.prompt) ? false : (seen.add(c.prompt), true)));

    for (const { object, minutes, prompt } of candidates.slice(0, MAX_QUESTIONS_PER_ROOM)) {
      questions.push({
        id: `${roomType}:${object.name}`,
        kind: 'depth',
        object: object.name,
        roomType,
        prompt,
        extraMinutes: Math.round(minutes),
        yes: 'deep',
      });
    }
  }

  // Putting things away is offered, never assumed. Deciding for somebody
  // where their belongings live is how a cleaner gets told not to come back.
  //
  // With a count, the question names roughly how many and what a yes costs,
  // because it now genuinely costs something — see tidying.ts. Without one
  // (an older scout reply) it falls back to the clutter score and promises no
  // minutes, which is all that score can honestly support.
  if (tidying) {
    if (tidying.elsewhere >= ASK_PUT_AWAY_AT) {
      questions.push({
        id: `${roomType}:${PUT_AWAY}`,
        kind: 'declutter',
        roomType,
        prompt:
          lang === 'en'
            ? `I can see about ${tidying.elsewhere} things that seem to belong in another room. Would you like us to put them back where they go?`
            : `Veo unas ${tidying.elsewhere} cosas que parecen de otro cuarto. ¿Quieres que las llevemos a su sitio?`,
        extraMinutes: Math.round(putAwayMinutes(tidying)),
        yes: 'deep',
      });
    }
  } else if (soil.clutter >= CLUTTER_OFFER_AT) {
    questions.push({
      id: `${roomType}:${PUT_AWAY}`,
      kind: 'declutter',
      roomType,
      prompt:
        lang === 'en'
          ? 'I can see quite a few things out of place. Would you like us to tidy up as well?'
          : 'Veo bastantes cosas fuera de sitio. ¿Quieres que las ordenemos también?',
      extraMinutes: 0,
      yes: 'deep',
    });
  }

  // Dishes are asked about separately because they are a different job, and
  // one plenty of cleaning companies do not do at all. A couple of mugs is not
  // worth the interruption; a sink is.
  if (tidying && tidying.dishes >= ASK_DISHES_AT) {
    questions.push({
      id: `${roomType}:${DISHES}`,
      kind: 'dishes',
      roomType,
      prompt:
        lang === 'en'
          ? `I can see about ${tidying.dishes} dishes and pots waiting to be washed. Would you like us to wash them?`
          : `Veo unos ${tidying.dishes} platos y ollas por lavar. ¿Quieres que los lavemos?`,
      extraMinutes: Math.round(dishesMinutes(tidying)),
      yes: 'deep',
    });
  }

  return questions;
}

/** Answers, as the capture screen collects them. */
export type Answers = Record<string, boolean>;

/**
 * Turns the yes/no answers into the overrides the estimator understands.
 *
 * A "no" is recorded as `surface` rather than dropped. On a deep clean that
 * is the whole point — it is the only way somebody declines the inside of a
 * fridge they would otherwise be charged for — and on a standard clean it
 * costs nothing to be explicit.
 */
export function depthChoicesFrom(questions: RoomQuestion[], answers: Answers): Record<string, ObjectDepth> {
  const choices: Record<string, ObjectDepth> = {};
  for (const q of questions) {
    const answer = answers[q.id];
    if (answer === undefined) continue;
    // Putting away and dishes ride the same channel as "inside the oven?":
    // 'deep' means do the extra work, 'surface' means leave it. Reusing it
    // means a yes in the kitchen reaches the price through code that already
    // carries one, rather than through a second map that could drift.
    const key =
      q.kind === 'depth' && q.object
        ? `${q.roomType}:${q.object}`
        : q.kind === 'declutter'
          ? `${q.roomType}:${PUT_AWAY}`
          : q.kind === 'dishes'
            ? `${q.roomType}:${DISHES}`
            : null;
    if (key) choices[key] = answer ? 'deep' : 'surface';
  }
  return choices;
}

function roomsAnsweredYes(questions: RoomQuestion[], answers: Answers, kind: QuestionKind): string[] {
  const rooms = questions
    .filter((q) => q.kind === kind && answers[q.id])
    .map((q) => (ROOM_LABELS_ES[q.roomType] ?? q.roomType).toLowerCase());
  return [...new Set(rooms)];
}

/**
 * What the crew has to be told in words, on top of what the price already
 * carries in minutes.
 *
 * The minutes reach the quote through depthChoicesFrom. This is for the
 * person arriving at the door, who needs to know before they start that the
 * customer asked for the laundry to go back to the bedroom and the pots to be
 * washed — neither of which a price says.
 */
export function noteFrom(questions: RoomQuestion[], answers: Answers): string | undefined {
  const parts: string[] = [];
  const putAway = roomsAnsweredYes(questions, answers, 'declutter');
  const dishes = roomsAnsweredYes(questions, answers, 'dishes');
  if (putAway.length) parts.push(`llevar cada cosa a su sitio (${putAway.join(', ')})`);
  if (dishes.length) parts.push(`lavar los platos (${dishes.join(', ')})`);
  return parts.length ? `El cliente pidió también: ${parts.join('; ')}.` : undefined;
}

export interface RepairRequest {
  /** Where, as the walkthrough named it: "Cocina", "Baño 2". */
  place: string;
  /** What, in short Spanish: "gabinete o cajón roto". */
  items: string[];
}

/**
 * The repairs the customer said yes to, for the company that gets the lead.
 *
 * Kept apart from the cleaning notes on purpose: these are not part of the
 * job being quoted, have no price, and may go to a different person — the
 * company decides whether it fixes them, refers them, or declines.
 */
export function repairsFrom(questions: RoomQuestion[], answers: Answers): RepairRequest[] {
  return questions
    .filter((q) => q.kind === 'repair' && answers[q.id] === true)
    .map((q) => ({
      place: q.place ?? ROOM_LABELS_ES[q.roomType] ?? q.roomType,
      items: (q.damage ?? []).filter((k) => DAMAGE[k]).map((k) => DAMAGE[k].label),
    }))
    .filter((r) => r.items.length > 0);
}

/** One line for a lead or a WhatsApp message, or undefined with nothing to say. */
export function repairNote(repairs: RepairRequest[]): string | undefined {
  if (!repairs.length) return undefined;
  const list = repairs.map((r) => `${r.items.join(', ')} (${r.place})`).join('; ');
  return `Quiere que le contacten para arreglar: ${list}.`;
}
