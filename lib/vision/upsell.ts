import { OBJECT_TIME_COST, depthGapFor, countCapFor, type ObjectDepth } from './model';
import type { DetectedObject, RoomType, SoilScores } from './types';

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

export type QuestionKind = 'depth' | 'declutter';

export interface RoomQuestion {
  /** Stable id, so an answer can be matched back without string matching. */
  id: string;
  kind: QuestionKind;
  /** The object this is about, for a depth question. */
  object?: string;
  roomType: RoomType;
  /** Spanish, spoken and shown. */
  prompt: string;
  /** What it adds if they say yes. Shown so a yes is informed, not a trap. */
  extraMinutes: number;
  /** What answering yes means for the estimate. */
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

/** The Spanish question for an object, or null when there is none to ask. */
export function promptFor(name: string, roomType: RoomType): string | null {
  const entry = ASK[name];
  if (!entry) return null;
  const phrase = typeof entry === 'function' ? entry(roomType) : entry;
  return `¿Quieres que ${phrase}?`;
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
  { alreadyDeep = false }: { alreadyDeep?: boolean } = {},
): RoomQuestion[] {
  const questions: RoomQuestion[] = [];

  if (!alreadyDeep) {
    const seen = new Set<string>();
    const candidates = objects
      .map((o) => ({ ...o, name: o.name.trim().toLowerCase() }))
      .filter((o) => OBJECT_TIME_COST[o.name])
      .filter((o) => (o.confidence ?? 0.5) >= MIN_CONFIDENCE)
      .filter((o) => depthGapFor(o.name) >= MIN_GAP_MINUTES)
      .map((o) => ({ object: o, minutes: gapMinutes(o), prompt: promptFor(o.name, roomType) }))
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

  // Tidying is offered, never assumed. Deciding for somebody that their
  // things need rearranging is how a cleaner gets told not to come back, and
  // a closed cupboard cannot be judged from a photograph anyway.
  if (soil.clutter >= CLUTTER_OFFER_AT) {
    questions.push({
      id: `${roomType}:declutter`,
      kind: 'declutter',
      roomType,
      prompt: 'Veo bastantes cosas fuera de sitio. ¿Quieres que las ordenemos también?',
      // Priced through the clutter dimension the estimator already weighs,
      // not as an object, so there is no minute figure to promise here.
      extraMinutes: 0,
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
    if (q.kind !== 'depth' || !q.object) continue;
    const answer = answers[q.id];
    if (answer === undefined) continue;
    choices[`${q.roomType}:${q.object}`] = answer ? 'deep' : 'surface';
  }
  return choices;
}

/**
 * The free-text note the declutter answers add, so the crew is told.
 *
 * Returned as `focus` text rather than as minutes because clutter is already
 * a scored dimension: adding minutes here on top would charge for the same
 * mess twice.
 */
export function noteFrom(questions: RoomQuestion[], answers: Answers): string | undefined {
  const rooms = questions
    .filter((q) => q.kind === 'declutter' && answers[q.id])
    .map((q) => q.roomType);
  if (rooms.length === 0) return undefined;
  return `El cliente pidió que también se ordene: ${[...new Set(rooms)].join(', ')}.`;
}
