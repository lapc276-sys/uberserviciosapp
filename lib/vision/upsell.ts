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

/** Spanish names for the objects worth asking about. */
const OBJECT_ES: Record<string, string> = {
  oven: 'el horno',
  refrigerator: 'la nevera',
  freezer: 'el congelador',
  microwave: 'el microondas',
  dishwasher: 'el lavavajillas',
  cabinet: 'los gabinetes',
  pantry: 'la despensa',
  closet: 'el armario',
  drawer: 'los cajones',
  washing_machine: 'la lavadora',
  dryer: 'la secadora',
  shower: 'la ducha',
  bathtub: 'la bañera',
  toilet: 'el inodoro',
  window: 'las ventanas',
  blinds: 'las persianas',
  range_hood: 'la campana',
  grill: 'la parrilla',
  toaster: 'la tostadora',
  coffee_maker: 'la cafetera',
};

function spanishFor(name: string): string {
  return OBJECT_ES[name] ?? `el ${name.replace(/_/g, ' ')}`;
}

/**
 * Phrasing per object, because "¿quieres limpiar dentro de las ventanas?"
 * is not Spanish. The fallback covers anything added to the catalogue later
 * without anyone remembering to come back here.
 */
function promptFor(name: string): string {
  const es = spanishFor(name);
  switch (name) {
    case 'window':
    case 'blinds':
      return `¿Quieres que limpiemos ${es} por dentro y por fuera?`;
    case 'cabinet':
    case 'drawer':
    case 'pantry':
    case 'closet':
      return `¿Quieres que vaciemos y limpiemos ${es} por dentro?`;
    case 'toilet':
    case 'shower':
    case 'bathtub':
      return `¿Quieres que hagamos ${es} a fondo, juntas incluidas?`;
    default:
      return `¿Quieres que limpiemos ${es} por dentro?`;
  }
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
      // One question per kind of thing: two fridges in one kitchen is one
      // question about fridges, not two identical prompts in a row.
      .filter((o) => (seen.has(o.name) ? false : (seen.add(o.name), true)))
      .map((o) => ({ object: o, minutes: gapMinutes(o) }))
      .sort((a, b) => b.minutes - a.minutes);

    for (const { object, minutes } of candidates.slice(0, MAX_QUESTIONS_PER_ROOM)) {
      questions.push({
        id: `${roomType}:${object.name}`,
        kind: 'depth',
        object: object.name,
        roomType,
        prompt: promptFor(object.name),
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
