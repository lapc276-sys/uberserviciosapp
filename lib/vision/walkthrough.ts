import {
  TASK_CATALOG,
  TASK_BY_ID,
  FLOOR_TYPE_LABELS,
  PET_LABELS,
  FLOOR_TYPES,
  PET_KINDS,
  isTaskInServiceScope,
} from './tasks';
import type { PropertyAnalysis, RoomAnalysis } from './types';

/**
 * The guided walkthrough.
 *
 * A passive upload gets whatever the customer happened to film, and then the
 * model guesses at everything it didn't see: the inside of the oven, whether
 * the carpet is carpet, whether there is a dog. Guessing is where wrong quotes
 * come from, and a quote that moves on arrival destroys the trust that made
 * someone book from a video in the first place.
 *
 * So the app runs a conversation instead. It asks what the camera reads badly,
 * asks what the customer actually wants done, and asks for a second look at the
 * few places where a closed door hides most of the work. Every answer changes
 * the price, which is the whole point — a question whose answer is ignored is
 * worse than no question.
 */

export type PromptKind =
  | 'film'      // point the camera somewhere specific
  | 'choice'    // pick from options
  | 'confirm';  // yes / no

export interface WalkthroughPrompt {
  id: string;
  kind: PromptKind;
  /** Spanish first: most people using this read the first line only. */
  questionEs: string;
  question: string;
  helpEs?: string;
  help?: string;
  /** For `choice`. */
  options?: { value: string; labelEs: string; label: string }[];
  multiple?: boolean;
  /** The task this unlocks, when answering yes adds work. */
  taskId?: string;
  /** Rooms this prompt relates to, for ordering the walk. */
  roomLabel?: string;
  /**
   * True when skipping leaves a real hole in the estimate. Used to decide what
   * is worth insisting on versus what can be quietly defaulted.
   */
  important?: boolean;
}

/**
 * Asked once per home, before or during the walk.
 *
 * Deliberately short. Every extra question costs completions, and a customer
 * who abandons the walkthrough is worth less than a slightly wider price band.
 */
export function propertyPrompts(): WalkthroughPrompt[] {
  return [
    {
      id: 'floors',
      kind: 'choice',
      multiple: true,
      important: true,
      questionEs: '¿Qué tipo de pisos hay en la casa?',
      question: 'What kind of floors does the home have?',
      helpEs: 'La alfombra toma bastante más tiempo que el piso duro.',
      help: 'Carpet takes considerably longer than hard floor.',
      options: FLOOR_TYPES.map((f) => ({
        value: f,
        labelEs: FLOOR_TYPE_LABELS[f].es,
        label: FLOOR_TYPE_LABELS[f].en,
      })),
    },
    {
      id: 'pets',
      kind: 'choice',
      multiple: true,
      important: true,
      questionEs: '¿Hay mascotas en casa?',
      question: 'Are there pets at home?',
      helpEs: 'El pelo de mascota casi nunca se ve bien en video, y es la razón más común de que un trabajo se alargue.',
      help: 'Pet hair rarely shows up well on video, and it is the most common reason a job runs over.',
      options: [
        ...PET_KINDS.map((p) => ({ value: p, labelEs: PET_LABELS[p].es, label: PET_LABELS[p].en })),
        { value: 'none', labelEs: 'Ninguna', label: 'None' },
      ],
    },
  ];
}

/**
 * Objects that hide most of their work behind a door or a lid.
 *
 * The outside of an oven tells you almost nothing about the inside, and the
 * inside is where the twenty expensive minutes are. These are the only places
 * worth interrupting someone's walk to ask for a second shot.
 */
const LOOK_INSIDE: { object: string; taskId: string; promptEs: string; prompt: string }[] = [
  {
    object: 'oven',
    taskId: 'oven_interior',
    promptEs: 'Abre el horno y enfoca el interior unos segundos.',
    prompt: 'Open the oven and point the camera inside for a few seconds.',
  },
  {
    object: 'microwave',
    taskId: 'microwave',
    promptEs: 'Abre el microondas y muestra por dentro.',
    prompt: 'Open the microwave and show the inside.',
  },
  {
    object: 'refrigerator',
    taskId: 'fridge_interior',
    promptEs: 'Si quieres la nevera por dentro, ábrela y enfócala.',
    prompt: 'If you want the fridge cleaned inside, open it and film it.',
  },
  {
    object: 'shower',
    taskId: 'grout_mold',
    promptEs: 'Acerca la cámara a las juntas de la ducha.',
    prompt: 'Move the camera close to the shower grout.',
  },
];

/** Optional work worth offering when the thing that needs it was detected. */
const OFFERABLE: { taskId: string; requiresObject?: string[]; questionEs: string; question: string }[] = [
  {
    taskId: 'oven_interior',
    requiresObject: ['oven'],
    questionEs: '¿Quieres que limpiemos el horno por dentro?',
    question: 'Would you like the inside of the oven cleaned?',
  },
  {
    taskId: 'fridge_interior',
    requiresObject: ['refrigerator', 'fridge'],
    questionEs: '¿Quieres la nevera limpia por dentro?',
    question: 'Would you like the fridge cleaned inside?',
  },
  {
    taskId: 'cabinets_in',
    questionEs: '¿Limpiamos también por dentro de los gabinetes?',
    question: 'Should we clean inside the cabinets too?',
  },
  {
    taskId: 'windows_interior',
    requiresObject: ['window'],
    questionEs: '¿Incluimos los vidrios de las ventanas?',
    question: 'Should we include the interior window glass?',
  },
  {
    taskId: 'laundry_run',
    questionEs: '¿Quieres que pongamos una carga de ropa?',
    question: 'Would you like us to run a load of laundry?',
  },
  {
    taskId: 'change_linens',
    requiresObject: ['bed', 'mattress'],
    questionEs: '¿Cambiamos las sábanas? (deja las limpias a la vista)',
    question: 'Should we change the bed linens? (leave clean ones out)',
  },
  {
    taskId: 'baseboards',
    questionEs: '¿Incluimos zócalos y marcos de puertas?',
    question: 'Should we include baseboards and door frames?',
  },
];

function detectedObjects(analysis: PropertyAnalysis): Set<string> {
  const names = new Set<string>();
  for (const room of analysis.rooms) {
    for (const object of room.objects) names.add(object.name.trim().toLowerCase());
  }
  return names;
}

/**
 * Second looks worth asking for, given what the first pass saw.
 *
 * Capped, and only for things actually detected. A walkthrough that stops the
 * customer eight times does not get finished.
 */
export function filmPrompts(analysis: PropertyAnalysis, limit = 3): WalkthroughPrompt[] {
  const seen = detectedObjects(analysis);

  return LOOK_INSIDE.filter((entry) => seen.has(entry.object))
    .slice(0, limit)
    .map((entry) => ({
      id: `film_${entry.object}`,
      kind: 'film' as const,
      taskId: entry.taskId,
      questionEs: entry.promptEs,
      question: entry.prompt,
      helpEs: 'Unos segundos bastan.',
      help: 'A few seconds is enough.',
    }));
}

/** Optional work to offer, based on what was detected. */
export function offerPrompts(analysis: PropertyAnalysis, serviceSlug: string): WalkthroughPrompt[] {
  const seen = detectedObjects(analysis);

  return OFFERABLE.filter((offer) => {
    const task = TASK_BY_ID[offer.taskId];
    if (!task) return false;
    // Nothing to offer if the service already covers it — asking would imply an
    // extra charge for work the customer is already paying for.
    if (isTaskInServiceScope(task, serviceSlug)) return false;
    if (offer.requiresObject && !offer.requiresObject.some((name) => seen.has(name))) return false;
    return true;
  }).map((offer) => ({
    id: `offer_${offer.taskId}`,
    kind: 'confirm' as const,
    taskId: offer.taskId,
    questionEs: offer.questionEs,
    question: offer.question,
    helpEs: `Suma unos ${Math.round(TASK_BY_ID[offer.taskId].baseMinutes)} minutos o más según cómo esté.`,
    help: `Adds roughly ${Math.round(TASK_BY_ID[offer.taskId].baseMinutes)} minutes, more if it needs it.`,
  }));
}

/**
 * Plain-language read of a room, for showing back during the walk.
 *
 * Says what was seen and how bad it looked, in the words someone standing in
 * their own kitchen would use. Never states a time or a price — those come
 * from the estimator, and a number spoken here that disagrees with the final
 * quote is exactly the surprise the product exists to avoid.
 */
export function describeRoom(room: RoomAnalysis): { es: string; en: string } {
  const worst = (Object.entries(room.soil) as [string, number][])
    .filter(([, score]) => score >= 35)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  const WORDS: Record<string, { es: string; en: string }> = {
    dust: { es: 'polvo', en: 'dust' },
    grease: { es: 'grasa', en: 'grease' },
    stains: { es: 'manchas', en: 'stains' },
    clutter: { es: 'desorden', en: 'clutter' },
    hair: { es: 'pelo', en: 'hair' },
    trash: { es: 'basura', en: 'trash' },
    mold: { es: 'moho', en: 'mildew' },
  };

  if (worst.length === 0) {
    return {
      es: `${room.label}: se ve en buen estado.`,
      en: `${room.label}: looks to be in good shape.`,
    };
  }

  const heavy = worst[0][1] >= 65;
  const es = worst.map(([dim]) => WORDS[dim]?.es ?? dim).join(' y ');
  const en = worst.map(([dim]) => WORDS[dim]?.en ?? dim).join(' and ');

  return {
    es: `${room.label}: ${heavy ? 'bastante' : 'algo de'} ${es}.`,
    en: `${room.label}: ${heavy ? 'a lot of' : 'some'} ${en}.`,
  };
}

export interface WalkthroughPlan {
  /** Asked once about the home. */
  property: WalkthroughPrompt[];
  /** Second looks worth taking. */
  film: WalkthroughPrompt[];
  /** Optional work to offer. */
  offers: WalkthroughPrompt[];
  /** What we saw, room by room, in plain language. */
  readback: { roomLabel: string; es: string; en: string }[];
}

/**
 * Everything the app should say after a first pass — the script for the rest of
 * the conversation.
 */
export function buildWalkthrough(
  analysis: PropertyAnalysis,
  serviceSlug: string,
  opts: { askProperty?: boolean } = {},
): WalkthroughPlan {
  return {
    property: opts.askProperty === false ? [] : propertyPrompts(),
    film: filmPrompts(analysis),
    offers: offerPrompts(analysis, serviceSlug),
    readback: analysis.rooms.map((room) => ({ roomLabel: room.label, ...describeRoom(room) })),
  };
}

/** Every task a customer could be offered — used by tests and the admin. */
export function offerableTaskIds(): string[] {
  return OFFERABLE.map((o) => o.taskId).filter((id) => TASK_CATALOG.some((t) => t.id === id));
}
