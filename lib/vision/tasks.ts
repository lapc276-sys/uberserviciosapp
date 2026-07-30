import { ROOM_TYPES, type RoomType, type SoilDimension, type SoilScores, type DetectedObject } from './types';

/**
 * The task catalog — every household chore, and what dirt does to it.
 *
 * The room-level model answers "how long does a kitchen take". This one answers
 * "what are we actually doing in there, and which parts blow up when it's
 * filthy". That distinction matters for three separate reasons:
 *
 * 1. **Calibration.** One number per job is a weak signal — it says the estimate
 *    was wrong but not where. Per-task actuals say *degreasing the stovetop*
 *    took triple, which is a fixable fact about one constant.
 * 2. **The field.** A cleaner needs a checklist, not a total. The pilot hands
 *    them this list and collects a time against each line.
 * 3. **The customer.** "Oven interior: 22 min" is a defensible quote. "$340" is
 *    a number to argue with.
 *
 * ⚠️ Every minute figure here is a **hypothesis**, exactly like the room model.
 * They are informed estimates of professional (not domestic) pace, and they are
 * wrong in ways nobody can predict from a desk. The pilot exists to replace
 * them with measurements.
 */

export type TaskCategory =
  | 'floors'
  | 'surfaces'
  | 'kitchen'
  | 'bathroom'
  | 'bedroom'
  | 'laundry'
  | 'windows'
  | 'organizing'
  | 'outdoor'
  | 'special';

export const TASK_CATEGORY_LABELS: Record<TaskCategory, { en: string; es: string }> = {
  floors: { en: 'Floors', es: 'Pisos' },
  surfaces: { en: 'Surfaces', es: 'Superficies' },
  kitchen: { en: 'Kitchen', es: 'Cocina' },
  bathroom: { en: 'Bathroom', es: 'Baño' },
  bedroom: { en: 'Bedroom', es: 'Dormitorio' },
  laundry: { en: 'Laundry', es: 'Lavandería' },
  windows: { en: 'Windows', es: 'Ventanas' },
  organizing: { en: 'Organizing', es: 'Orden' },
  outdoor: { en: 'Outdoor', es: 'Exteriores' },
  special: { en: 'Special treatment', es: 'Tratamiento especial' },
};

/**
 * How much room there is to clean, relative to a kitchen.
 *
 * Generic chores — dusting, sweeping, mopping, baseboards — scale with floor
 * and surface area, and without this they don't: a hallway would cost the same
 * four minutes of dusting as a living room, and since a dozen generic tasks
 * apply to every room, that error compounds into a wildly overstated job.
 *
 * Room-specific work is deliberately *not* scaled. A toilet takes what it takes
 * regardless of how big the bathroom is.
 *
 * ⚠️ Hypotheses, like everything else here. These are the numbers the pilot is
 * most likely to move first, because they are the easiest to feel wrong in the
 * field.
 */
export const ROOM_EFFORT: Record<RoomType, number> = {
  kitchen: 1,
  living_room: 1,
  dining_room: 0.75,
  bedroom: 0.8,
  office: 0.7,
  bathroom: 0.55,
  laundry: 0.5,
  garage: 1.1,
  patio: 0.8,
  stairs: 0.4,
  hallway: 0.3,
  other: 0.7,
};

export interface CleaningTask {
  id: string;
  label: string;
  /** The pilot is used in the field by Spanish-speaking cleaners. */
  labelEs: string;
  category: TaskCategory;
  /** Rooms this task belongs to. Empty means any room. */
  rooms: RoomType[];
  /** Minutes on a pristine example — the floor, not the average. */
  baseMinutes: number;
  /** The soil dimension that makes this task expensive. */
  driver?: SoilDimension;
  /** Extra minutes at driver soil 100. This is where the real variance lives. */
  soilMinutes?: number;
  /** Skip the task entirely unless this dimension clears the threshold. */
  requiresSoil?: { dimension: SoilDimension; min: number };
  /** Skip unless one of these was actually seen in the footage. */
  requiresObject?: string[];
  /** Restricted to these services. Omit for every service. */
  services?: string[];
  /**
   * Included only on deep, move-in/out and post-construction work.
   * A standard visit that silently did these would run long and lose money;
   * one that charged for them and skipped them would be fraud.
   */
  deepOnly?: boolean;
  note?: string;
}

const ANY: RoomType[] = [];

/**
 * Ordered roughly the way a professional works a room: dry before wet, top
 * before bottom, floors last. The order is not cosmetic — mopping before
 * dusting means mopping twice.
 */
export const TASK_CATALOG: CleaningTask[] = [
  // ── Organizing ───────────────────────────────────────────────────────────
  {
    id: 'declutter',
    label: 'Clear and put away items',
    labelEs: 'Despejar y guardar objetos',
    category: 'organizing',
    rooms: ANY,
    baseMinutes: 2,
    driver: 'clutter',
    soilMinutes: 18,
    note: 'Nothing else can start until surfaces are clear — this is the task that silently doubles a job.',
  },
  {
    id: 'trash_out',
    label: 'Empty bins and remove trash',
    labelEs: 'Vaciar papeleras y sacar basura',
    category: 'organizing',
    rooms: ANY,
    baseMinutes: 2,
    driver: 'trash',
    soilMinutes: 12,
  },

  // ── Surfaces ─────────────────────────────────────────────────────────────
  {
    id: 'dust_surfaces',
    label: 'Dust surfaces and furniture',
    labelEs: 'Desempolvar superficies y muebles',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 4,
    driver: 'dust',
    soilMinutes: 10,
  },
  {
    id: 'cobwebs',
    label: 'Remove cobwebs, dust corners and ceiling',
    labelEs: 'Quitar telarañas, esquinas y techo',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 2,
    driver: 'dust',
    soilMinutes: 7,
    requiresSoil: { dimension: 'dust', min: 30 },
  },
  {
    id: 'switches_handles',
    label: 'Disinfect switches, handles and touch points',
    labelEs: 'Desinfectar interruptores, manijas y puntos de contacto',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 3,
    driver: 'stains',
    soilMinutes: 4,
  },
  {
    id: 'baseboards',
    label: 'Wipe baseboards and door frames',
    labelEs: 'Limpiar zócalos y marcos de puertas',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'dust',
    soilMinutes: 8,
    deepOnly: true,
  },
  {
    id: 'walls_spot',
    label: 'Spot-clean walls and doors',
    labelEs: 'Limpiar manchas en paredes y puertas',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 3,
    driver: 'stains',
    soilMinutes: 14,
    requiresSoil: { dimension: 'stains', min: 25 },
  },
  {
    id: 'ceiling_fan',
    label: 'Clean ceiling fan and light fixtures',
    labelEs: 'Limpiar ventilador de techo y lámparas',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'dust',
    soilMinutes: 6,
    requiresObject: ['ceiling fan', 'chandelier'],
  },
  {
    id: 'blinds',
    label: 'Dust blinds and curtains',
    labelEs: 'Desempolvar persianas y cortinas',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'dust',
    soilMinutes: 10,
    requiresObject: ['blinds'],
  },
  {
    id: 'mirrors',
    label: 'Clean mirrors and glass',
    labelEs: 'Limpiar espejos y vidrios',
    category: 'surfaces',
    rooms: ANY,
    baseMinutes: 3,
    driver: 'stains',
    soilMinutes: 4,
    requiresObject: ['mirror'],
  },

  // ── Kitchen ──────────────────────────────────────────────────────────────
  {
    id: 'dishes',
    label: 'Wash or load dishes',
    labelEs: 'Lavar o cargar los platos',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 3,
    driver: 'clutter',
    soilMinutes: 20,
    note: 'A full sink is the single most common reason a kitchen runs over.',
  },
  {
    id: 'counters',
    label: 'Clear and disinfect countertops',
    labelEs: 'Despejar y desinfectar mesones',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 5,
    driver: 'grease',
    soilMinutes: 12,
  },
  {
    id: 'backsplash',
    label: 'Degrease backsplash and wall behind stove',
    labelEs: 'Desengrasar salpicadero y pared tras la estufa',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 4,
    driver: 'grease',
    soilMinutes: 16,
  },
  {
    id: 'stovetop',
    label: 'Degrease stovetop, grates and knobs',
    labelEs: 'Desengrasar estufa, parrillas y perillas',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 6,
    driver: 'grease',
    soilMinutes: 24,
    requiresObject: ['stove', 'oven'],
    note: 'Baked-on grease needs dwell time — the minutes are mostly waiting, then scrubbing.',
  },
  {
    id: 'oven_interior',
    label: 'Clean oven interior',
    labelEs: 'Limpiar el interior del horno',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 12,
    driver: 'grease',
    soilMinutes: 30,
    requiresObject: ['oven'],
    deepOnly: true,
  },
  {
    id: 'range_hood',
    label: 'Degrease range hood and filter',
    labelEs: 'Desengrasar campana y filtro',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 6,
    driver: 'grease',
    soilMinutes: 14,
    requiresObject: ['range hood'],
  },
  {
    id: 'microwave',
    label: 'Clean microwave inside and out',
    labelEs: 'Limpiar microondas por dentro y por fuera',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 4,
    driver: 'grease',
    soilMinutes: 8,
    requiresObject: ['microwave'],
  },
  {
    id: 'fridge_exterior',
    label: 'Clean refrigerator exterior',
    labelEs: 'Limpiar el exterior de la nevera',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 4,
    driver: 'grease',
    soilMinutes: 7,
    requiresObject: ['refrigerator', 'fridge'],
  },
  {
    id: 'fridge_interior',
    label: 'Empty and clean refrigerator interior',
    labelEs: 'Vaciar y limpiar el interior de la nevera',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 15,
    driver: 'stains',
    soilMinutes: 20,
    requiresObject: ['refrigerator', 'fridge'],
    deepOnly: true,
  },
  {
    id: 'cabinets_out',
    label: 'Wipe cabinet fronts',
    labelEs: 'Limpiar el frente de los gabinetes',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 5,
    driver: 'grease',
    soilMinutes: 14,
  },
  {
    id: 'cabinets_in',
    label: 'Clean inside cabinets and drawers',
    labelEs: 'Limpiar el interior de gabinetes y cajones',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 18,
    driver: 'dust',
    soilMinutes: 14,
    deepOnly: true,
  },
  {
    id: 'sink_kitchen',
    label: 'Scrub and polish sink and faucet',
    labelEs: 'Fregar y pulir fregadero y grifo',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 4,
    driver: 'stains',
    soilMinutes: 10,
  },
  {
    id: 'small_appliances',
    label: 'Wipe small appliances',
    labelEs: 'Limpiar electrodomésticos pequeños',
    category: 'kitchen',
    rooms: ['kitchen'],
    baseMinutes: 4,
    driver: 'grease',
    soilMinutes: 7,
  },

  // ── Bathroom ─────────────────────────────────────────────────────────────
  {
    id: 'toilet',
    label: 'Clean and disinfect toilet',
    labelEs: 'Limpiar y desinfectar el inodoro',
    category: 'bathroom',
    rooms: ['bathroom'],
    baseMinutes: 5,
    driver: 'stains',
    soilMinutes: 12,
    requiresObject: ['toilet'],
  },
  {
    id: 'shower_tub',
    label: 'Scrub shower and tub',
    labelEs: 'Fregar ducha y bañera',
    category: 'bathroom',
    rooms: ['bathroom'],
    baseMinutes: 8,
    driver: 'stains',
    soilMinutes: 22,
    requiresObject: ['shower', 'bathtub'],
  },
  {
    id: 'grout_mold',
    label: 'Treat grout and remove mildew',
    labelEs: 'Tratar juntas y quitar moho',
    category: 'bathroom',
    rooms: ['bathroom'],
    baseMinutes: 6,
    driver: 'mold',
    soilMinutes: 34,
    requiresSoil: { dimension: 'mold', min: 15 },
    note: 'The most underestimated task in the catalog. Heavy mildew is slow, chemical, ventilated work.',
  },
  {
    id: 'shower_glass',
    label: 'Remove hard water from glass and fixtures',
    labelEs: 'Quitar sarro de vidrios y grifería',
    category: 'bathroom',
    rooms: ['bathroom'],
    baseMinutes: 5,
    driver: 'stains',
    soilMinutes: 18,
    requiresSoil: { dimension: 'stains', min: 25 },
  },
  {
    id: 'vanity',
    label: 'Clean sink, vanity and mirror',
    labelEs: 'Limpiar lavamanos, tocador y espejo',
    category: 'bathroom',
    rooms: ['bathroom'],
    baseMinutes: 5,
    driver: 'stains',
    soilMinutes: 9,
  },
  {
    id: 'bath_restock',
    label: 'Restock paper, soap and fresh towels',
    labelEs: 'Reponer papel, jabón y toallas limpias',
    category: 'bathroom',
    rooms: ['bathroom'],
    baseMinutes: 3,
  },

  // ── Bedroom ──────────────────────────────────────────────────────────────
  {
    id: 'make_bed',
    label: 'Make the bed',
    labelEs: 'Tender la cama',
    category: 'bedroom',
    rooms: ['bedroom'],
    baseMinutes: 4,
    driver: 'clutter',
    soilMinutes: 4,
    requiresObject: ['bed', 'mattress'],
  },
  {
    id: 'change_linens',
    label: 'Change bed linens',
    labelEs: 'Cambiar las sábanas',
    category: 'bedroom',
    rooms: ['bedroom'],
    baseMinutes: 7,
    requiresObject: ['bed', 'mattress'],
    services: ['airbnb-cleaning', 'move-in-cleaning', 'deep-cleaning'],
  },
  {
    id: 'closet_order',
    label: 'Tidy closet and hang clothing',
    labelEs: 'Ordenar el clóset y colgar ropa',
    category: 'bedroom',
    rooms: ['bedroom'],
    baseMinutes: 4,
    driver: 'clutter',
    soilMinutes: 16,
    requiresSoil: { dimension: 'clutter', min: 30 },
  },
  {
    id: 'under_furniture',
    label: 'Clean under bed and behind furniture',
    labelEs: 'Limpiar debajo de la cama y tras los muebles',
    category: 'bedroom',
    rooms: ['bedroom', 'living_room'],
    baseMinutes: 6,
    driver: 'dust',
    soilMinutes: 10,
    deepOnly: true,
  },

  // ── Living areas ─────────────────────────────────────────────────────────
  {
    id: 'upholstery',
    label: 'Vacuum upholstery and cushions',
    labelEs: 'Aspirar tapicería y cojines',
    category: 'surfaces',
    rooms: ['living_room', 'office'],
    baseMinutes: 5,
    driver: 'hair',
    soilMinutes: 14,
    requiresObject: ['sofa', 'couch'],
  },
  {
    id: 'electronics',
    label: 'Dust electronics, screens and remotes',
    labelEs: 'Limpiar electrónicos, pantallas y controles',
    category: 'surfaces',
    rooms: ['living_room', 'office', 'bedroom'],
    baseMinutes: 4,
    driver: 'dust',
    soilMinutes: 5,
  },

  // ── Floors ───────────────────────────────────────────────────────────────
  {
    id: 'vacuum',
    label: 'Sweep or vacuum floors',
    labelEs: 'Barrer o aspirar los pisos',
    category: 'floors',
    rooms: ANY,
    baseMinutes: 4,
    driver: 'dust',
    soilMinutes: 9,
  },
  {
    id: 'pet_hair',
    label: 'Remove pet hair from floors and furniture',
    labelEs: 'Quitar pelo de mascota de pisos y muebles',
    category: 'special',
    rooms: ANY,
    baseMinutes: 4,
    driver: 'hair',
    soilMinutes: 20,
    requiresSoil: { dimension: 'hair', min: 25 },
    note: 'Pet hair does not vacuum out in one pass — it is rubber-brush work, and it is slow.',
  },
  {
    id: 'mop',
    label: 'Mop floors',
    labelEs: 'Trapear los pisos',
    category: 'floors',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'stains',
    soilMinutes: 12,
  },
  {
    id: 'floor_edges',
    label: 'Detail floor edges and corners',
    labelEs: 'Detallar bordes y esquinas del piso',
    category: 'floors',
    rooms: ANY,
    baseMinutes: 4,
    driver: 'dust',
    soilMinutes: 8,
    deepOnly: true,
  },
  {
    id: 'carpet_spot',
    label: 'Spot-treat carpet stains',
    labelEs: 'Tratar manchas de alfombra',
    category: 'special',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'stains',
    soilMinutes: 18,
    requiresObject: ['carpet', 'rug'],
    requiresSoil: { dimension: 'stains', min: 25 },
  },

  // ── Windows ──────────────────────────────────────────────────────────────
  {
    id: 'windows_interior',
    label: 'Clean interior window glass',
    labelEs: 'Limpiar vidrios interiores',
    category: 'windows',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'dust',
    soilMinutes: 9,
    requiresObject: ['window'],
  },
  {
    id: 'window_tracks',
    label: 'Clean window tracks and sills',
    labelEs: 'Limpiar rieles y alféizares',
    category: 'windows',
    rooms: ANY,
    baseMinutes: 5,
    driver: 'dust',
    soilMinutes: 10,
    requiresObject: ['window'],
    deepOnly: true,
  },

  // ── Laundry ──────────────────────────────────────────────────────────────
  {
    id: 'laundry_run',
    label: 'Run a wash and dry cycle',
    labelEs: 'Poner una carga de ropa a lavar y secar',
    category: 'laundry',
    rooms: ['laundry'],
    baseMinutes: 6,
    note: 'Hands-on minutes only. The machine runs while other work continues.',
  },
  {
    id: 'laundry_fold',
    label: 'Fold and put away laundry',
    labelEs: 'Doblar y guardar la ropa',
    category: 'laundry',
    rooms: ['laundry', 'bedroom'],
    baseMinutes: 8,
    driver: 'clutter',
    soilMinutes: 14,
    requiresSoil: { dimension: 'clutter', min: 20 },
  },
  {
    id: 'washer_dryer',
    label: 'Wipe washer, dryer and lint trap',
    labelEs: 'Limpiar lavadora, secadora y filtro de pelusa',
    category: 'laundry',
    rooms: ['laundry'],
    baseMinutes: 4,
    driver: 'dust',
    soilMinutes: 6,
  },

  // ── Outdoor and utility ──────────────────────────────────────────────────
  {
    id: 'patio_sweep',
    label: 'Sweep patio and outdoor furniture',
    labelEs: 'Barrer patio y muebles de exterior',
    category: 'outdoor',
    rooms: ['patio', 'garage'],
    baseMinutes: 6,
    driver: 'dust',
    soilMinutes: 12,
  },
  {
    id: 'garage_declutter',
    label: 'Organize and clear garage floor',
    labelEs: 'Organizar y despejar el piso del garaje',
    category: 'organizing',
    rooms: ['garage'],
    baseMinutes: 8,
    driver: 'clutter',
    soilMinutes: 26,
  },
  {
    id: 'stairs_detail',
    label: 'Vacuum stairs and wipe railings',
    labelEs: 'Aspirar escaleras y limpiar barandas',
    category: 'floors',
    rooms: ['stairs'],
    baseMinutes: 5,
    driver: 'dust',
    soilMinutes: 8,
  },

  // ── Special treatments ───────────────────────────────────────────────────
  {
    id: 'odor',
    label: 'Deodorize and ventilate',
    labelEs: 'Desodorizar y ventilar',
    category: 'special',
    rooms: ANY,
    baseMinutes: 3,
    driver: 'trash',
    soilMinutes: 8,
    requiresSoil: { dimension: 'trash', min: 40 },
  },
  {
    id: 'construction_dust',
    label: 'Remove construction dust and residue',
    labelEs: 'Retirar polvo y residuos de obra',
    category: 'special',
    rooms: ANY,
    baseMinutes: 10,
    driver: 'dust',
    soilMinutes: 30,
    services: ['post-construction-cleaning'],
  },
];

/** Fast lookup by id, for calibration writes coming back from the field. */
export const TASK_BY_ID: Record<string, CleaningTask> = Object.fromEntries(
  TASK_CATALOG.map((t) => [t.id, t]),
);

/**
 * Reference soil levels.
 *
 * Used to publish the catalog as a readable table and to label the pilot's
 * capture screen — a cleaner grades a room "moderate", not "57".
 */
export const SOIL_LEVELS = [
  { key: 'pristine', score: 0, en: 'Pristine', es: 'Impecable' },
  { key: 'light', score: 25, en: 'Light', es: 'Ligera' },
  { key: 'moderate', score: 50, en: 'Moderate', es: 'Moderada' },
  { key: 'heavy', score: 75, en: 'Heavy', es: 'Fuerte' },
  { key: 'severe', score: 100, en: 'Severe', es: 'Extrema' },
] as const;

export type SoilLevelKey = (typeof SOIL_LEVELS)[number]['key'];

/**
 * Minutes for one task at a given level of its driving soil dimension.
 *
 * `roomType` scales generic chores by the room's size. Omit it for the catalog
 * reference table, which quotes the unscaled figure.
 */
export function taskMinutesAt(task: CleaningTask, soilScore: number, roomType?: RoomType): number {
  const score = Math.max(0, Math.min(soilScore, 100));
  const extra = task.driver && task.soilMinutes ? (score / 100) * task.soilMinutes : 0;

  // Only chores that apply anywhere scale with the room. A task written for one
  // room already assumes that room's size.
  const scale = roomType && task.rooms.length === 0 ? ROOM_EFFORT[roomType] : 1;

  return Number(((task.baseMinutes + extra) * scale).toFixed(1));
}

/** The task's minutes at every reference level — the calibration table. */
export function taskMinutesByLevel(task: CleaningTask): Record<SoilLevelKey, number> {
  return Object.fromEntries(
    SOIL_LEVELS.map((level) => [level.key, taskMinutesAt(task, level.score)]),
  ) as Record<SoilLevelKey, number>;
}

export interface TaskLine {
  id: string;
  label: string;
  labelEs: string;
  category: TaskCategory;
  /** Estimated minutes for this room, at this room's soil. */
  minutes: number;
  /** The soil dimension driving the estimate, when one does. */
  driver?: SoilDimension;
  /** That dimension's score in this room, so the field can sanity-check it. */
  driverScore?: number;
  note?: string;
}

export interface TaskPlan {
  lines: TaskLine[];
  totalMinutes: number;
}

const DEEP_SERVICES = new Set([
  'deep-cleaning',
  'move-in-cleaning',
  'move-out-cleaning',
  'post-construction-cleaning',
]);

/**
 * What the customer asked for, on top of what the footage showed.
 *
 * The walkthrough is a conversation, not a scan: someone says "clean inside the
 * oven" or "don't touch the garage". Those answers have to reach the price, or
 * the app asked a question it then ignored — which is worse than not asking.
 */
/**
 * Facts about the home that a camera reads badly or not at all.
 *
 * Floor type is the clearest case: carpet and tile look similar in a dim phone
 * frame and behave nothing alike — carpet cannot be mopped, needs slow
 * overlapping vacuum passes, and holds pet hair that hard floors release. Pets
 * are worse: the animal is usually not in shot, but its hair is everywhere and
 * it is the single most common reason a job runs over.
 *
 * So the walkthrough asks. One question each, and both change the price.
 */
export const FLOOR_TYPES = ['carpet', 'rug_over_hard', 'hardwood', 'tile', 'vinyl', 'laminate', 'concrete'] as const;
export type FloorType = (typeof FLOOR_TYPES)[number];

export const FLOOR_TYPE_LABELS: Record<FloorType, { en: string; es: string }> = {
  carpet: { en: 'Wall-to-wall carpet', es: 'Alfombra de pared a pared' },
  rug_over_hard: { en: 'Rugs over hard floor', es: 'Alfombras sobre piso duro' },
  hardwood: { en: 'Hardwood', es: 'Madera' },
  tile: { en: 'Tile', es: 'Cerámica o baldosa' },
  vinyl: { en: 'Vinyl', es: 'Vinilo' },
  laminate: { en: 'Laminate', es: 'Laminado' },
  concrete: { en: 'Concrete', es: 'Cemento' },
};

/**
 * How much longer floor work takes on each surface, relative to vinyl.
 *
 * Carpet is slow because vacuuming it properly means overlapping passes, not
 * one sweep. Tile is slow because of grout. Hypotheses, like everything else —
 * and among the first the pilot should check, since floor type is easy to
 * record and hard to argue about.
 */
export const FLOOR_EFFORT: Record<FloorType, number> = {
  carpet: 1.45,
  rug_over_hard: 1.2,
  tile: 1.15,
  concrete: 1.1,
  hardwood: 1.05,
  laminate: 1,
  vinyl: 1,
};

export const PET_KINDS = ['dog', 'cat', 'other'] as const;
export type PetKind = (typeof PET_KINDS)[number];

export const PET_LABELS: Record<PetKind, { en: string; es: string }> = {
  dog: { en: 'Dog', es: 'Perro' },
  cat: { en: 'Cat', es: 'Gato' },
  other: { en: 'Other pet', es: 'Otra mascota' },
};

/** Tasks whose minutes scale with the floor surface. */
const FLOOR_TASKS = new Set(['vacuum', 'mop', 'floor_edges', 'carpet_spot', 'pet_hair', 'stairs_detail']);

export interface PropertyContext {
  /** Floors present in the home. The slowest one governs, not the average. */
  floorTypes?: FloorType[];
  pets?: PetKind[];
}

export interface TaskPreferences {
  /** Task ids the customer explicitly asked for, overriding service scope. */
  requested?: string[];
  /** Task ids the customer explicitly declined. Declining always wins. */
  declined?: string[];
}

function applies(
  task: CleaningTask,
  ctx: {
    roomType: RoomType;
    soil: SoilScores;
    objects: string[];
    serviceSlug: string;
    preferences?: TaskPreferences;
  },
): boolean {
  if (task.rooms.length > 0 && !task.rooms.includes(ctx.roomType)) return false;

  // Declining beats every other rule, including an explicit request. If both
  // arrive the customer changed their mind, and the safe reading of an
  // ambiguous answer is the one that doesn't bill for unwanted work.
  if (ctx.preferences?.declined?.includes(task.id)) return false;

  const requested = ctx.preferences?.requested?.includes(task.id) ?? false;

  // A request overrides scope gates — that is what asking is for. It does not
  // override the room gate above: no amount of asking puts an oven in a
  // bathroom.
  if (!requested) {
    if (task.services && !task.services.includes(ctx.serviceSlug)) return false;
    if (task.deepOnly && !DEEP_SERVICES.has(ctx.serviceSlug)) return false;

    if (task.requiresSoil && (ctx.soil[task.requiresSoil.dimension] ?? 0) < task.requiresSoil.min) {
      return false;
    }

    // An object-gated task needs evidence. Guessing that a bathroom "probably"
    // has a tub adds minutes to a quote for work that may not exist.
    if (task.requiresObject && !task.requiresObject.some((name) => ctx.objects.includes(name))) {
      return false;
    }
  }

  return true;
}

/**
 * The task list for one room, with minutes.
 *
 * Order follows the catalog, which follows how the work is actually done —
 * the pilot shows this list in sequence, so getting it wrong means asking
 * someone to mop before they dust.
 */
export function planRoomTasks(ctx: {
  roomType: RoomType;
  soil: SoilScores;
  objects: DetectedObject[];
  serviceSlug: string;
  preferences?: TaskPreferences;
  property?: PropertyContext;
}): TaskPlan {
  const objectNames = ctx.objects.map((o) => o.name.trim().toLowerCase());

  // The slowest surface governs. Averaging would quote a carpeted living room
  // as if half of it were vinyl, and the crew still has to vacuum all of it.
  const floorFactor = Math.max(1, ...(ctx.property?.floorTypes ?? []).map((f) => FLOOR_EFFORT[f] ?? 1));
  const hasPets = (ctx.property?.pets?.length ?? 0) > 0;

  const lines: TaskLine[] = TASK_CATALOG.filter((task) =>
    applies(task, {
      roomType: ctx.roomType,
      soil: ctx.soil,
      objects: objectNames,
      serviceSlug: ctx.serviceSlug,
      preferences: ctx.preferences,
    }),
  ).map((task) => {
    const driverScore = task.driver ? (ctx.soil[task.driver] ?? 0) : undefined;
    let minutes = taskMinutesAt(task, driverScore ?? 0, ctx.roomType);

    if (FLOOR_TASKS.has(task.id)) minutes *= floorFactor;

    // A declared pet is stronger evidence than the footage: hair is hard to see
    // in a phone frame and the animal is usually not in shot, so a low hair
    // score on a home with a dog is more likely a missed read than a clean floor.
    if (hasPets && (task.id === 'pet_hair' || task.id === 'upholstery')) minutes *= 1.3;

    return {
      id: task.id,
      label: task.label,
      labelEs: task.labelEs,
      category: task.category,
      minutes: Number(minutes.toFixed(1)),
      driver: task.driver,
      driverScore,
      note: task.note,
    };
  });

  return {
    lines,
    totalMinutes: Number(lines.reduce((sum, l) => sum + l.minutes, 0).toFixed(1)),
  };
}

/**
 * Pets make the hair task apply even when the camera saw a tidy floor.
 *
 * Kept separate from `applies` because it is a statement about evidence, not
 * about scope: the declaration is a better signal than the frame.
 */
export function petAwareSoil(soil: SoilScores, property?: PropertyContext): SoilScores {
  if (!property?.pets?.length) return soil;
  const floor = property.pets.includes('dog') || property.pets.includes('cat') ? 30 : 20;
  return { ...soil, hair: Math.max(soil.hair, floor) };
}

/**
 * Whether a service already covers this task without the customer asking.
 *
 * Exported so the walkthrough can decide what is worth *offering*: offering
 * work a service already includes implies an extra charge for something the
 * customer is already paying for, which is the kind of thing that gets noticed
 * in a review.
 */
export function isTaskInServiceScope(task: CleaningTask, serviceSlug: string): boolean {
  if (task.services) return task.services.includes(serviceSlug);
  if (task.deepOnly) return DEEP_SERVICES.has(serviceSlug);
  return true;
}

/** Every task that could ever apply to a room type — the pilot's full checklist. */
export function tasksForRoom(roomType: RoomType): CleaningTask[] {
  return TASK_CATALOG.filter((t) => t.rooms.length === 0 || t.rooms.includes(roomType));
}

/** Sanity guard used by tests and by the catalog page. */
export function catalogCoversEveryRoom(): boolean {
  return ROOM_TYPES.every((room) => tasksForRoom(room).length > 0);
}
