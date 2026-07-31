import { ROOM_LABELS, type RoomType, type DetectedObject, type PropertyAnalysis } from './types';
import { FLOOR_TYPES, FLOOR_TYPE_LABELS, type FloorType, type PetKind } from './tasks';

/**
 * The room-by-room walk.
 *
 * A customer handed an empty camera films their kitchen counter for forty
 * seconds and calls it a house. The result is a confident quote built on a
 * third of the home, and a crew that arrives to twice the work — the single
 * fastest way to destroy the trust that made someone book from a video.
 *
 * So the app leads. It asks how big the home is, builds a queue of rooms, and
 * walks the customer through them one at a time: what to point the camera at,
 * how to move it, when the room is done. Each room's footage is analysed on its
 * own, which is also why the estimate can be per-room rather than one blur.
 *
 * The engine is deliberately pure and UI-free. It answers "what happens next"
 * given what has been captured and answered so far; the screen just renders
 * that and sends back answers.
 */

// ── What the home is ─────────────────────────────────────────────────────────

export interface HomeShape {
  bedrooms: number;
  bathrooms: number;
  hasLivingRoom: boolean;
  hasDiningRoom: boolean;
  hasKitchen: boolean;
  hasLaundry: boolean;
  hasStairs: boolean;
  hasGarage: boolean;
  hasPatio: boolean;
  hasOffice: boolean;
}

export const DEFAULT_HOME_SHAPE: HomeShape = {
  bedrooms: 1,
  bathrooms: 1,
  hasLivingRoom: true,
  hasDiningRoom: false,
  hasKitchen: true,
  hasLaundry: false,
  hasStairs: false,
  hasGarage: false,
  hasPatio: false,
  hasOffice: false,
};

/**
 * The order rooms are visited.
 *
 * Kitchen first on purpose: it is the room with the most variance and the most
 * follow-up questions, so asking it while the customer is still fresh gets
 * better answers than asking it eighth. Circulation space goes last because it
 * is the least interesting and the most likely to be skipped.
 */
export function buildRoomQueue(shape: HomeShape): { type: RoomType; label: string; labelEs: string }[] {
  const queue: { type: RoomType; label: string; labelEs: string }[] = [];
  const push = (type: RoomType, label: string, labelEs: string) => queue.push({ type, label, labelEs });

  if (shape.hasKitchen) push('kitchen', 'Kitchen', 'La cocina');
  if (shape.hasLivingRoom) push('living_room', 'Living room', 'La sala');
  if (shape.hasDiningRoom) push('dining_room', 'Dining room', 'El comedor');

  const bedrooms = Math.max(0, Math.min(shape.bedrooms, 10));
  for (let i = 1; i <= bedrooms; i++) {
    const suffix = bedrooms > 1 ? ` ${i}` : '';
    push('bedroom', `Bedroom${suffix}`, `El cuarto${suffix}`);
  }

  const bathrooms = Math.max(0, Math.min(shape.bathrooms, 10));
  for (let i = 1; i <= bathrooms; i++) {
    const suffix = bathrooms > 1 ? ` ${i}` : '';
    push('bathroom', `Bathroom${suffix}`, `El baño${suffix}`);
  }

  if (shape.hasOffice) push('office', 'Office', 'La oficina');
  if (shape.hasLaundry) push('laundry', 'Laundry', 'La lavandería');
  if (shape.hasStairs) push('stairs', 'Stairs', 'Las escaleras');
  if (shape.hasGarage) push('garage', 'Garage', 'El garaje');
  if (shape.hasPatio) push('patio', 'Patio', 'El patio');

  return queue;
}

// ── How to film each room ────────────────────────────────────────────────────

export interface CaptureInstruction {
  titleEs: string;
  title: string;
  bodyEs: string;
  body: string;
  /** Roughly how long the sweep should take. */
  seconds: number;
}

const SWEEP = {
  bodyEs: 'Párate en la entrada y gira despacio de derecha a izquierda, mostrando todo el cuarto. Sin prisa.',
  body: 'Stand in the doorway and turn slowly from right to left, showing the whole room. Take your time.',
};

/**
 * Per-room filming instructions.
 *
 * The specifics matter more than they look. "Show me the counters and the
 * stove" produces usable frames; "film your kitchen" produces a shot of the
 * floor and a thumb. Every instruction names the surfaces that carry the
 * minutes.
 */
const CAPTURE: Partial<Record<RoomType, CaptureInstruction>> = {
  kitchen: {
    titleEs: 'La cocina',
    title: 'The kitchen',
    bodyEs: 'Gira despacio de derecha a izquierda. Muestra los mesones, la estufa, el fregadero y los gabinetes.',
    body: 'Turn slowly right to left. Show the counters, the stove, the sink and the cabinets.',
    seconds: 20,
  },
  bathroom: {
    titleEs: 'El baño',
    title: 'The bathroom',
    bodyEs: 'Muestra la ducha o bañera, el inodoro y el lavamanos. Acércate un poco a las juntas.',
    body: 'Show the shower or tub, the toilet and the sink. Get a little closer to the grout.',
    seconds: 15,
  },
  bedroom: {
    titleEs: 'El cuarto',
    title: 'The bedroom',
    bodyEs: 'Gira despacio mostrando la cama, el piso y el clóset si está abierto.',
    body: 'Turn slowly, showing the bed, the floor and the closet if it is open.',
    seconds: 15,
  },
  living_room: {
    titleEs: 'La sala',
    title: 'The living room',
    bodyEs: 'Gira despacio de derecha a izquierda. Muestra los muebles, el piso y las ventanas.',
    body: 'Turn slowly right to left. Show the furniture, the floor and the windows.',
    seconds: 20,
  },
  stairs: {
    titleEs: 'Las escaleras',
    title: 'The stairs',
    bodyEs: 'Grábalas desde abajo hacia arriba, mostrando los escalones y el pasamanos.',
    body: 'Film from the bottom looking up, showing the steps and the handrail.',
    seconds: 12,
  },
};

const DEFAULT_CAPTURE: Omit<CaptureInstruction, 'titleEs' | 'title'> = { ...SWEEP, seconds: 15 };

/**
 * The instruction always carries the room's own label, never the script's.
 *
 * Otherwise the second bedroom is announced as "El cuarto" exactly like the
 * first, and someone halfway through a house has no idea which room the app
 * thinks it is on — the fastest way to get two sweeps of the same room and none
 * of another.
 */
export function captureInstruction(type: RoomType, labelEs: string, label: string): CaptureInstruction {
  const specific = CAPTURE[type];
  return specific
    ? { ...specific, titleEs: labelEs, title: label }
    : { titleEs: labelEs, title: label, ...DEFAULT_CAPTURE };
}

// ── Frame quality ────────────────────────────────────────────────────────────

/**
 * Below this mean luminance (0–255) a frame is too dark to grade soil from.
 *
 * Set from what the failure actually looks like: a dim phone frame flattens
 * grease and mildew into shadow, and the model reports a suspiciously clean
 * room rather than admitting it cannot see. That produces a confident low quote
 * — the worst possible failure, because nothing looks wrong until the crew
 * arrives.
 */
export const DARK_FRAME_THRESHOLD = 62;

export interface FrameQuality {
  meanBrightness: number;
  tooDark: boolean;
  /** Share of frames that were too dark, 0–1. */
  darkShare: number;
}

export interface QualityAdvice {
  messageEs: string;
  message: string;
  /** Offer to switch the torch on rather than just complaining about the dark. */
  suggestTorch: boolean;
}

export function adviseOnQuality(quality: FrameQuality): QualityAdvice | null {
  if (!quality.tooDark) return null;
  return {
    messageEs: 'Este sitio se ve muy oscuro. ¿Puedes encender la luz? Si no, activo la linterna.',
    message: 'This looks very dark. Could you turn on a light? Otherwise I can switch the torch on.',
    suggestTorch: true,
  };
}

// ── Reading the room ─────────────────────────────────────────────────────────

/** Things that mean a pet lives here, whether or not the animal was in shot. */
const PET_EVIDENCE: Record<string, PetKind> = {
  'litter box': 'cat',
  'cat tree': 'cat',
  'scratching post': 'cat',
  'pet bed': 'other',
  'dog bed': 'dog',
  'dog bowl': 'dog',
  'pet bowl': 'other',
  'pet toy': 'other',
  leash: 'dog',
  crate: 'dog',
  'pet gate': 'dog',
  aquarium: 'other',
  cage: 'other',
};

/** Things that mean small children, which reliably means more clutter. */
const KID_EVIDENCE = new Set(['toy', 'toys', 'high chair', 'stroller', 'crib', 'playpen', 'play mat']);

export interface RoomInference {
  /** Pets inferred from objects, even when nobody declared one. */
  pets: PetKind[];
  /** Small children present — a strong predictor of clutter time. */
  children: boolean;
  /** Free-text notes worth showing back, so inference is never silent. */
  reasonsEs: string[];
  reasons: string[];
}

/**
 * What the objects imply beyond themselves.
 *
 * A litter box is worth more than its own cleaning time: it means cat hair on
 * every soft surface in the home. Inferring that is fair; doing it silently is
 * not, so every inference carries the evidence that produced it and is shown
 * back to the customer for confirmation.
 */
export function inferFromObjects(objects: DetectedObject[]): RoomInference {
  const names = objects.map((o) => o.name.trim().toLowerCase());
  const pets = new Set<PetKind>();
  const reasonsEs: string[] = [];
  const reasons: string[] = [];

  for (const name of names) {
    const kind = PET_EVIDENCE[name];
    if (kind) {
      pets.add(kind);
      reasonsEs.push(`Vi ${name} — asumo que hay mascota.`);
      reasons.push(`Saw ${name} — assuming there is a pet.`);
    }
  }

  const children = names.some((n) => KID_EVIDENCE.has(n));
  if (children) {
    reasonsEs.push('Vi cosas de niños — suele significar más desorden que recoger.');
    reasons.push('Saw children’s things — usually means more picking up.');
  }

  return { pets: [...pets], children, reasonsEs, reasons };
}

// ── Stairs ───────────────────────────────────────────────────────────────────

export const STAIR_PROMPT = {
  questionEs: '¿De qué son las escaleras?',
  question: 'What are the stairs made of?',
  options: FLOOR_TYPES.map((f) => ({
    value: f,
    labelEs: FLOOR_TYPE_LABELS[f].es,
    label: FLOOR_TYPE_LABELS[f].en,
  })),
};

export const HANDRAIL_PROMPT = {
  questionEs: '¿Limpiamos también el pasamanos?',
  question: 'Should we clean the handrail too?',
  taskId: 'stairs_detail',
};

// ── Session state ────────────────────────────────────────────────────────────

export interface CapturedRoom {
  type: RoomType;
  label: string;
  labelEs: string;
  frameCount: number;
  analysis?: PropertyAnalysis;
}

export interface WalkSession {
  shape: HomeShape;
  queue: { type: RoomType; label: string; labelEs: string }[];
  /** Index into `queue` of the room being filmed. */
  current: number;
  captured: CapturedRoom[];
  floorTypes: FloorType[];
  pets: PetKind[];
  requested: string[];
  declined: string[];
}

export function startSession(shape: HomeShape): WalkSession {
  return {
    shape,
    queue: buildRoomQueue(shape),
    current: 0,
    captured: [],
    floorTypes: [],
    pets: [],
    requested: [],
    declined: [],
  };
}

export type WalkStage = 'shape' | 'capture' | 'review' | 'done';

export interface WalkProgress {
  stage: WalkStage;
  /** The room being filmed now, when there is one. */
  room?: { type: RoomType; label: string; labelEs: string };
  instruction?: CaptureInstruction;
  /** Completed rooms out of the total. */
  done: number;
  total: number;
  /** 0–100, for the bar. */
  percent: number;
  /** What to say when moving on, phrased as an invitation rather than an order. */
  nextUpEs?: string;
  nextUp?: string;
}

export function progress(session: WalkSession): WalkProgress {
  const total = session.queue.length;
  const done = Math.min(session.current, total);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  if (total === 0) return { stage: 'shape', done: 0, total: 0, percent: 0 };
  if (session.current >= total) return { stage: 'review', done, total, percent: 100 };

  const room = session.queue[session.current];
  const upcoming = session.queue[session.current + 1];

  return {
    stage: 'capture',
    room,
    instruction: captureInstruction(room.type, room.labelEs, room.label),
    done,
    total,
    percent,
    nextUpEs: upcoming ? `Luego seguimos con ${upcoming.labelEs.toLowerCase()}.` : 'Es el último. Ya casi.',
    nextUp: upcoming ? `Next we'll do the ${upcoming.label.toLowerCase()}.` : 'Last one. Almost done.',
  };
}

/** Records a finished room and moves the walk forward. */
export function completeRoom(session: WalkSession, captured: CapturedRoom): WalkSession {
  const inferred = captured.analysis
    ? inferFromObjects(captured.analysis.rooms.flatMap((r) => r.objects))
    : { pets: [] as PetKind[] };

  return {
    ...session,
    captured: [...session.captured, captured],
    // Inference accumulates across rooms: a litter box seen in the laundry is a
    // fact about the whole home, not about that room.
    pets: [...new Set([...session.pets, ...inferred.pets])],
    current: session.current + 1,
  };
}

/** Everything captured so far, merged into one analysis for pricing. */
export function mergeRooms(session: WalkSession): PropertyAnalysis['rooms'] {
  return session.captured.flatMap((room, index) =>
    (room.analysis?.rooms ?? []).map((analysed) => ({
      ...analysed,
      // The customer told us which room this is; trust that over the model's
      // guess, which cannot tell a spare bedroom from an office.
      type: room.type,
      label: session.queue[index]?.label ?? analysed.label,
    })),
  );
}

/** Label a room the way the customer would say it, e.g. "El baño 2". */
export function roomLabelEs(type: RoomType, index?: number): string {
  const base = ROOM_LABELS[type] ?? ROOM_LABELS.other;
  return index && index > 1 ? `${base} ${index}` : base;
}

/**
 * Folds whatever the model returned for one room into a single observation.
 *
 * A model given eight frames of an open-plan kitchen often reports a kitchen
 * *and* a dining room, and sometimes the same kitchen twice from two angles.
 * The customer already told us which room they are standing in, so that is the
 * answer — splitting it would double-count the space and quote the home for
 * more rooms than it has.
 *
 * Soil takes the worst value seen rather than the average: one frame catching
 * the greasy corner of a counter is evidence the grease is there, not evidence
 * that the room is half greasy.
 */
export function collapseToRoom(
  rooms: { soil: Record<string, number>; objects: DetectedObject[]; confidence: number; notes?: string }[],
  type: RoomType,
): {
  type: RoomType;
  confidence: number;
  soil: Record<string, number>;
  objects: DetectedObject[];
  notes?: string;
} {
  const soil: Record<string, number> = {};
  const objects = new Map<string, DetectedObject>();
  let confidence = 0;

  for (const room of rooms) {
    for (const [dimension, score] of Object.entries(room.soil ?? {})) {
      soil[dimension] = Math.max(soil[dimension] ?? 0, Number(score) || 0);
    }
    for (const object of room.objects ?? []) {
      const key = object.name.trim().toLowerCase();
      const existing = objects.get(key);
      // The same oven seen from two angles is one oven, and the clearer look is
      // the one worth keeping.
      if (!existing || object.confidence > existing.confidence) {
        objects.set(key, { ...object, name: key });
      }
    }
    confidence += room.confidence ?? 0.5;
  }

  return {
    type,
    confidence: rooms.length ? Math.max(0, Math.min(confidence / rooms.length, 1)) : 0.5,
    soil,
    objects: [...objects.values()],
    notes: rooms.find((r) => r.notes)?.notes,
  };
}
