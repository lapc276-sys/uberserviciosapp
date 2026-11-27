import { ROOM_LABELS_ES, type ProductPreference, type RoomAnalysis, type RoomType } from './types';
import { SUPPLY_CATALOG, type SupplyPlan } from './supplies';
import { MATERIALS, WARN_AT_CONFIDENCE } from './materials';
import { DISHES, PUT_AWAY } from './tidying';
import { depthChoiceFor, depthGapFor, isDeepService, type DepthChoices } from './model';
import { taskFor } from './upsell';
import { damageCaution } from './damage';

/**
 * The order to do the job in, for the person doing it.
 *
 * Everything else in this engine answers "how long". This answers "in what
 * order", and the order matters for one reason that the minutes alone cannot
 * see: some products work on their own. Sprayed first, the toilet cleaner
 * and the oven cleaner do their part while the kitchen counters are wiped and
 * the bedrooms vacuumed. A cleaner who sprays the bathroom and then stands in
 * it waiting has spent ten minutes on nothing; one who sprays it first and
 * comes back last has spent them on the kitchen.
 *
 * So the plan has two passes. First every room that needs it is pre-treated,
 * the slowest product first so its clock starts earliest. Then the rooms are
 * cleaned in the usual working order — kitchen, living areas, bedrooms,
 * bathrooms last — except that a room whose product has not finished working
 * is skipped until it has, and if nothing else is left the wait is reported.
 *
 * Three things this deliberately does NOT do:
 *
 * It does not change the price. Every step's minutes come from the estimate,
 * and they sum to `totalMinutes` exactly. The overlap it finds is real, but
 * the room constants it is built on are unmeasured, and a schedule built on
 * guesses produces a very precise-looking wrong number. That is a job for
 * the job timer, which records these same rooms.
 *
 * It does not model walking. Between rooms of a city apartment it is seconds,
 * and the room constants already carry some of it.
 *
 * It never puts bleach and acid in the same room at the same time. Mold
 * remover is chlorine; toilet cleaner and limescale remover are acids; the
 * two together release chlorine gas. The supply list already warns about the
 * pair — this is where the warning becomes an order of work.
 */

export interface CrewPlanStep {
  /** In Spanish, numbered when repeated: "Baño 2". */
  room: string;
  roomType: RoomType;
  kind: 'pretreat' | 'clean';
  /** What to do, in Spanish, in order. */
  actions: string[];
  /** Hands-on minutes. */
  minutes: number;
  /** Clock time when the step starts, counted from arrival. */
  startsAt: number;
  /** After a pre-treatment: how long it is left to work. */
  dwellMinutes?: number;
  /** What must not touch this room's surfaces, in Spanish. */
  cautions: string[];
}

export interface CrewPlan {
  /** What the customer asked about products, said before anything else. */
  notes?: string[];
  steps: CrewPlanStep[];
  /** Equals the analysis total. The plan never moves the price. */
  handsOnMinutes: number;
  /** Product working time that ran while other work was being done. */
  overlappedMinutes: number;
  /** Time the cleaner would stand waiting for a product, if any. */
  idleMinutes: number;
}

/** Spraying one product. A hypothesis, carved out of the room's own minutes. */
const PRETREAT_MINUTES_PER_PRODUCT = 1;

/** No more than this many "inside the oven" lines per room. */
const MAX_INSIDE_TASKS = 6;

/**
 * The usual working order once everything is sprayed: the kitchen while the
 * bathrooms work, the living areas, the bedrooms, and the bathrooms last so
 * their products have had the longest.
 */
const ROOM_ORDER: RoomType[] = [
  'kitchen',
  'living_room',
  'dining_room',
  'office',
  'hallway',
  'stairs',
  'bedroom',
  'laundry',
  'bathroom',
  'garage',
  'patio',
  'other',
];

interface Pretreatment {
  supply: string;
  /** Spanish product name. */
  name: string;
  /** Where it goes, in Spanish. */
  where: string;
  /**
   * Whether this room calls for it. Mirrors the job-level rules in
   * supplies.ts room by room; a product is only ever used if the job's supply
   * plan actually packed it, so the plan cannot ask for a bottle that is not
   * in the van.
   */
  applies: (room: RoomAnalysis) => boolean;
  /**
   * Surfaces this product ends up on in normal use. Limescale remover goes
   * on the shower and the taps, which is exactly where stone walls and brass
   * fittings are; toilet cleaner goes inside the bowl and touches neither.
   * That difference decides whether a clash means "drop it here" or only
   * "do not let it drip".
   */
  touches: string[];
  /** Catalogue objects this already does from the inside. */
  covers?: string[];
}

const has = (room: RoomAnalysis, pattern: RegExp) => room.objects.some((o) => pattern.test(o.name));

/** Soft furnishings, where pet hair actually needs the rubber brush. */
const SOFT = /\b(sofa|couch|bed|rug|carpet|mattress|curtains?|armchair)\b/;

const PRETREATMENTS: Pretreatment[] = [
  {
    supply: 'oven_cleaner',
    name: 'limpiahornos',
    where: 'el interior del horno',
    applies: (r) => r.type === 'kitchen' && has(r, /oven/) && r.soil.grease >= 25,
    touches: [],
    covers: ['oven'],
  },
  {
    supply: 'mold_remover',
    name: 'quitamoho',
    where: 'las juntas con moho',
    applies: (r) => r.soil.mold >= 20,
    touches: ['natural_stone'],
  },
  {
    supply: 'toilet_cleaner',
    name: 'limpiador de inodoro',
    where: 'el interior de la taza',
    applies: (r) => r.type === 'bathroom' || has(r, /toilet/),
    touches: [],
  },
  {
    supply: 'limescale',
    name: 'antical',
    where: 'la ducha y la grifería',
    applies: (r) => r.type === 'bathroom' && r.soil.stains >= 35,
    touches: ['natural_stone', 'specialty_metal'],
  },
  {
    supply: 'degreaser',
    name: 'desengrasante',
    where: 'la estufa y la campana',
    applies: (r) => r.type === 'kitchen' && r.soil.grease >= 30,
    touches: ['stainless_steel'],
  },
];

/**
 * What changes when the customer asked for ecological products.
 *
 * Not dropped but swapped: the joints still need treating and the oven still
 * needs time to soak, so the step stays — with a product the customer agreed
 * to. Keeping the step also keeps its place in the order, which matters for
 * the mould remover: a bleach-free one is still not to be mixed with the
 * bathroom's acids, so they still wait for a rinse.
 */
const ECO_SWAP: Record<string, string> = {
  oven_cleaner: 'pasta de bicarbonato y agua',
  mold_remover: 'quitamoho sin cloro (con peróxido)',
};

const PRODUCT_NOTES: Partial<Record<ProductPreference, string>> = {
  eco: 'El cliente pidió productos ecológicos: nada de cloro, ni limpiahornos, ni limpiacristales con amoníaco.',
  unscented: 'El cliente pidió productos sin olor.',
  own: 'Usa los productos del cliente; los tuyos, solo para lo que falte.',
};

function pretreatmentsFor(products?: ProductPreference): Pretreatment[] {
  if (products !== 'eco') return PRETREATMENTS;
  return PRETREATMENTS.map((p) => (ECO_SWAP[p.supply] ? { ...p, name: ECO_SWAP[p.supply] } : p));
}

function spanishLabels(rooms: RoomAnalysis[]): string[] {
  const totals = new Map<string, number>();
  for (const r of rooms) totals.set(r.type, (totals.get(r.type) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rooms.map((r) => {
    const base = ROOM_LABELS_ES[r.type] ?? ROOM_LABELS_ES.other;
    if ((totals.get(r.type) ?? 0) < 2) return base;
    const n = (seen.get(r.type) ?? 0) + 1;
    seen.set(r.type, n);
    return `${base} ${n}`;
  });
}

function cautionsFor(room: RoomAnalysis, withDamage = true): string[] {
  const surfaces = (room.materials ?? [])
    .filter((m) => m.confidence >= WARN_AT_CONFIDENCE && MATERIALS[m.name])
    .map((m) => {
      const care = MATERIALS[m.name];
      const label = care.label.charAt(0).toUpperCase() + care.label.slice(1);
      return `${label}: ${care.care}, ${care.avoidEs}.`;
    });
  // Broken before anyone arrived. Said in the room it is in, the first time
  // the crew walks in — because "you broke my cabinet" is the most expensive
  // sentence in this trade and the walkthrough is the only record of how it
  // was. Only once per room: by the second step it is noise.
  const broken = withDamage ? damageCaution(room.damage) : undefined;
  return broken ? [...surfaces, broken] : surfaces;
}

/** What the customer bought done from the inside, as crew instructions. */
function insideTasks(
  room: RoomAnalysis,
  serviceSlug: string,
  choices: DepthChoices | undefined,
  covered: Set<string>,
): string[] {
  const deepByDefault = isDeepService(serviceSlug);
  const seen = new Set<string>();
  return room.objects
    .map((o) => o.name.trim().toLowerCase())
    .filter((name) => !covered.has(name))
    .filter((name) => {
      const chosen = depthChoiceFor(name, room.type, choices);
      return chosen ? chosen === 'deep' : deepByDefault;
    })
    .filter((name) => depthGapFor(name) >= 2)
    .sort((a, b) => depthGapFor(b) - depthGapFor(a))
    .map((name) => taskFor(name, room.type))
    .filter((task): task is string => task !== null)
    .filter((task) => (seen.has(task) ? false : (seen.add(task), true)))
    .slice(0, MAX_INSIDE_TASKS);
}

interface RoomWork {
  index: number;
  room: RoomAnalysis;
  label: string;
  /** Pre-treatments safe to spray at the start. */
  early: Pretreatment[];
  /** Acids held back because the same room is getting bleach. */
  held: Pretreatment[];
  /** Left out because they would land on a surface they damage. */
  barred: { product: Pretreatment; material: string }[];
  /** Used, but kept to their fixture because a surface nearby is at risk. */
  contained: { product: Pretreatment; material: string }[];
  pretreatMinutes: number;
  dwell: number;
  /** Whether the rubber pet-hair brush is in the van. */
  petHair: boolean;
  /** The customer asked for ecological products. */
  eco: boolean;
}

/** Materials seen firmly enough in this room to warn about. */
function materialsIn(room: RoomAnalysis): string[] {
  return (room.materials ?? [])
    .filter((m) => m.confidence >= WARN_AT_CONFIDENCE && MATERIALS[m.name])
    .map((m) => m.name);
}

/** The first material here that this product damages, if any. */
function damages(p: Pretreatment, materials: string[]): string | undefined {
  const hazard = SUPPLY_CATALOG[p.supply]?.hazard;
  if (!hazard) return undefined;
  return materials.find((m) => MATERIALS[m].avoidHazards.includes(hazard));
}

function planRoom(
  room: RoomAnalysis,
  index: number,
  label: string,
  packed: Set<string>,
  products?: ProductPreference,
): RoomWork {
  const present = materialsIn(room);
  const candidates = pretreatmentsFor(products).filter((p) => packed.has(p.supply) && p.applies(room));

  // The supply list warns that acid etches marble. Warning is not enough
  // once there is a plan: a plan that says "be careful with acid" and then
  // "apply limescale remover to the shower" next to a stone wall has told
  // the crew to do the damage. So a product that would land on a surface it
  // harms is taken out of this room altogether, and one that stays inside a
  // fixture is kept with an instruction not to let it drip.
  const barred: RoomWork['barred'] = [];
  const contained: RoomWork['contained'] = [];
  const wanted = candidates.filter((p) => {
    const material = damages(p, present);
    if (!material) return true;
    if (p.touches.includes(material)) {
      barred.push({ product: p, material });
      return false;
    }
    contained.push({ product: p, material });
    return true;
  });
  const usesBleach = wanted.some((p) => SUPPLY_CATALOG[p.supply]?.hazard === 'bleach');
  const isAcid = (p: Pretreatment) => SUPPLY_CATALOG[p.supply]?.hazard === 'acid';

  const early = usesBleach ? wanted.filter((p) => !isAcid(p)) : wanted;
  const held = usesBleach ? wanted.filter(isAcid) : [];

  const pretreatMinutes = Math.min(early.length * PRETREAT_MINUTES_PER_PRODUCT, room.estimatedMinutes);
  // Products in the same room work side by side, so the room is ready when
  // the slowest one is.
  const dwell = early.reduce((max, p) => Math.max(max, SUPPLY_CATALOG[p.supply]?.dwellMinutes ?? 0), 0);

  return {
    index,
    room,
    label,
    early,
    held,
    barred,
    contained,
    pretreatMinutes,
    dwell,
    petHair: packed.has('pet_hair_tool'),
    eco: products === 'eco',
  };
}

/** "el limpiador de inodoro" kept inside the bowl, in words. */
function keepInside(work: RoomWork, p: Pretreatment): string {
  const hit = work.contained.find((c) => c.product.supply === p.supply);
  return hit ? ` Cuidado de que no salpique: hay ${MATERIALS[hit.material].label} cerca.` : '';
}

function cleanActions(work: RoomWork, serviceSlug: string, choices?: DepthChoices): string[] {
  const { room } = work;
  const actions: string[] = [];
  const t = room.tidying;

  if (t && t.toClear > 0) {
    actions.push(`Recoge lo que hay en el suelo y las superficies (unas ${t.toClear} cosas).`);
  }
  if (t && t.elsewhere > 0 && depthChoiceFor(PUT_AWAY, room.type, choices) === 'deep') {
    actions.push(`Lleva a su cuarto lo que no es de aquí (unas ${t.elsewhere} cosas).`);
  }
  if (t && t.dishes > 0 && depthChoiceFor(DISHES, room.type, choices) === 'deep') {
    actions.push(`Lava los platos y las ollas (unos ${t.dishes}).`);
  }

  for (const p of work.early) {
    const dwell = SUPPLY_CATALOG[p.supply]?.dwellMinutes;
    actions.push(
      dwell
        ? `Termina ${p.where}: ya lleva al menos ${dwell} min con ${p.name}.`
        : `Termina ${p.where}.`,
    );
  }

  if (work.held.length) {
    const steps = work.held.map((p) => `${p.name} en ${p.where}`).join(' y ');
    // The reason has to match the bottle actually used: there is no chlorine
    // in an eco job, but peroxide and acid still do not belong together.
    const why = work.eco ? 'no se mezclan' : 'el cloro con ácido suelta gas';
    const first = work.early.find((p) => SUPPLY_CATALOG[p.supply]?.hazard === 'bleach')?.name ?? 'quitamoho';
    actions.push(
      `Enjuaga bien donde pusiste el ${first}. Solo después aplica ${steps} — nunca a la vez: ${why}.${work.held.map((p) => keepInside(work, p)).join('')}`,
    );
  }

  for (const { product, material } of work.barred) {
    const care = MATERIALS[material];
    actions.push(
      `Aquí no uses ${product.name}: hay ${care.label} y la dañaría. Para ${product.where}: ${care.care}.`,
    );
  }

  // The inside of the oven is already the oven cleaner's job; saying both
  // reads as two separate tasks to somebody working down a list.
  const covered = new Set(work.early.flatMap((p) => p.covers ?? []));
  actions.push(...insideTasks(room, serviceSlug, choices, covered).map((t) => (t.endsWith('.') ? t : `${t}.`)));

  // Only where there is something soft for the hair to sit in. A bathroom
  // with hair on the floor needs vacuuming, which every room already gets;
  // the brush is for upholstery, and telling somebody to use it on a tiled
  // floor is the kind of line that teaches a crew to skim the plan.
  if (room.soil.hair >= 30 && work.petHair && SOFT.test(room.objects.map((o) => o.name).join(' '))) {
    actions.push('Hay pelo de mascota: pasa el cepillo de goma por tapizados y alfombras antes de aspirar.');
  }

  actions.push('De arriba abajo, y el suelo al final.');
  return actions;
}

/**
 * Builds the plan for a finished estimate.
 *
 * Pure and deterministic, like the rest of the engine: the same rooms and the
 * same answers always give the same plan, so a crew can be told today and a
 * dispute reconstructed next month.
 */
export function buildCrewPlan(
  rooms: RoomAnalysis[],
  supplyPlan: SupplyPlan | undefined,
  {
    serviceSlug,
    depthChoices,
    products,
  }: { serviceSlug: string; depthChoices?: DepthChoices; products?: ProductPreference },
): CrewPlan {
  const packed = new Set((supplyPlan?.lines ?? []).map((l) => l.id));
  const labels = spanishLabels(rooms);
  const work = rooms.map((room, i) => planRoom(room, i, labels[i], packed, products));
  const note = products ? PRODUCT_NOTES[products] : undefined;

  const steps: CrewPlanStep[] = [];
  let clock = 0;

  // ── Pass 1: spray, slowest clock first ──────────────────────────────────
  const readyAt = new Map<number, number>();
  const pretreat = work
    .filter((w) => w.early.length > 0 && w.pretreatMinutes > 0)
    .sort((a, b) => b.dwell - a.dwell || a.index - b.index);

  /** Rooms whose pre-existing damage has already been pointed out. */
  const toldDamage = new Set<number>();
  const firstVisit = (index: number) => (toldDamage.has(index) ? false : (toldDamage.add(index), true));

  for (const w of pretreat) {
    steps.push({
      room: w.label,
      roomType: w.room.type,
      kind: 'pretreat',
      actions: w.early.map((p) => {
        const dwell = SUPPLY_CATALOG[p.supply]?.dwellMinutes;
        return (
          (dwell
            ? `Aplica ${p.name} en ${p.where} y déjalo actuar ${dwell} min.`
            : `Aplica ${p.name} en ${p.where}.`) + keepInside(w, p)
        );
      }),
      minutes: w.pretreatMinutes,
      startsAt: clock,
      dwellMinutes: w.dwell,
      cautions: cautionsFor(w.room, firstVisit(w.index)),
    });
    clock += w.pretreatMinutes;
    readyAt.set(w.index, clock + w.dwell);
  }

  // ── Pass 2: clean, in working order, never before a product is done ─────
  const rank = (t: RoomType) => {
    const i = ROOM_ORDER.indexOf(t);
    return i === -1 ? ROOM_ORDER.length : i;
  };
  // A room that was sprayed is always revisited, even in the unlikely case
  // that spraying used up all its minutes — otherwise the plan would leave
  // oven cleaner in an oven and never say to come back for it.
  const remaining = work
    .filter((w) => w.room.estimatedMinutes - w.pretreatMinutes > 0 || w.early.length > 0)
    .sort((a, b) => rank(a.room.type) - rank(b.room.type) || a.index - b.index);

  let idle = 0;
  const waited = new Map<number, number>();

  while (remaining.length) {
    let pick = remaining.findIndex((w) => (readyAt.get(w.index) ?? 0) <= clock);
    if (pick === -1) {
      // Everything left is still soaking. Take whichever finishes first and
      // say how long the wait is, rather than hide it.
      pick = remaining.reduce(
        (best, w, i) => ((readyAt.get(w.index) ?? 0) < (readyAt.get(remaining[best].index) ?? 0) ? i : best),
        0,
      );
      const wait = (readyAt.get(remaining[pick].index) ?? 0) - clock;
      idle += wait;
      waited.set(remaining[pick].index, wait);
      clock += wait;
    }

    const [w] = remaining.splice(pick, 1);
    const minutes = w.room.estimatedMinutes - w.pretreatMinutes;
    steps.push({
      room: w.label,
      roomType: w.room.type,
      kind: 'clean',
      actions: cleanActions(w, serviceSlug, depthChoices),
      minutes,
      startsAt: clock,
      cautions: cautionsFor(w.room, firstVisit(w.index)),
    });
    clock += minutes;
  }

  const overlappedMinutes = pretreat.reduce(
    (sum, w) => sum + Math.max(0, w.dwell - (waited.get(w.index) ?? 0)),
    0,
  );

  return {
    ...(note ? { notes: [note] } : {}),
    steps,
    handsOnMinutes: steps.reduce((sum, s) => sum + s.minutes, 0),
    overlappedMinutes,
    idleMinutes: idle,
  };
}
