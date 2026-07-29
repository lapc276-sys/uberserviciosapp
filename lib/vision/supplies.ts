import type { RoomType, SoilScores, DetectedObject } from './types';

/**
 * Supply planning: what to actually bring to a job.
 *
 * Deliberately generic product *types*, never brands. Brands differ by country
 * and naming one is an endorsement we can't stand behind — a platform sold to
 * cleaning companies worldwide has to describe "heavy-duty degreaser", not a
 * specific bottle.
 *
 * Costs are rough US retail per unit, used for honest margin math rather than
 * billing. Tune them per market.
 */

export type SupplyCategory = 'chemical' | 'tool' | 'consumable' | 'ppe';

/**
 * Chemical families that must never be combined. Bleach with ammonia produces
 * chloramine gas; bleach with acid produces chlorine gas. Both send people to
 * the emergency room, and both are easy to cause by cleaning a shower with one
 * product and the glass with another.
 */
export type Hazard = 'bleach' | 'ammonia' | 'acid' | 'caustic' | 'solvent';

export interface Supply {
  id: string;
  name: string;
  category: SupplyCategory;
  unit: string;
  /** USD per unit, for supply-cost estimation. */
  costPerUnit: number;
  /** Roughly how many minutes of work one unit covers. Omit for reusable tools. */
  coversMinutes?: number;
  hazard?: Hazard;
  /** Protective equipment this product requires. */
  requiresPpe?: string[];
  note?: string;
}

/**
 * Costs and coverage reflect how a working cleaning business actually buys:
 * concentrate by the gallon, diluted on site, and cloths that get laundered
 * rather than binned. A retail spray bottle per job would put consumables near
 * $100 a visit, which is nowhere near reality — real per-job consumables land
 * in the single digits to low tens. Getting this wrong doesn't just misprice
 * supplies, it makes the margin figure a lie.
 */
export const SUPPLY_CATALOG: Record<string, Supply> = {
  all_purpose: { id: 'all_purpose', name: 'All-purpose cleaner (concentrate)', category: 'chemical', unit: 'gallon', costPerUnit: 14, coversMinutes: 2400 },
  degreaser: { id: 'degreaser', name: 'Heavy-duty degreaser (concentrate)', category: 'chemical', unit: 'gallon', costPerUnit: 20, coversMinutes: 1500, requiresPpe: ['gloves'], note: 'Let it dwell 5 minutes on baked-on grease before scrubbing.' },
  oven_cleaner: { id: 'oven_cleaner', name: 'Oven cleaner', category: 'chemical', unit: 'can', costPerUnit: 8, coversMinutes: 400, hazard: 'caustic', requiresPpe: ['gloves', 'eye protection'], note: 'Ventilate. Never use on self-cleaning oven interiors.' },
  bathroom_disinfectant: { id: 'bathroom_disinfectant', name: 'Bathroom disinfectant (concentrate)', category: 'chemical', unit: 'gallon', costPerUnit: 16, coversMinutes: 2000 },
  mold_remover: { id: 'mold_remover', name: 'Mold & mildew remover', category: 'chemical', unit: 'gallon', costPerUnit: 14, coversMinutes: 1000, hazard: 'bleach', requiresPpe: ['gloves', 'mask', 'eye protection'], note: 'Ventilate the room. Never mix with any ammonia-based product.' },
  limescale: { id: 'limescale', name: 'Limescale / hard-water remover', category: 'chemical', unit: 'gallon', costPerUnit: 15, coversMinutes: 1200, hazard: 'acid', requiresPpe: ['gloves'], note: 'Never mix with bleach-based products.' },
  glass_cleaner: { id: 'glass_cleaner', name: 'Glass cleaner (concentrate)', category: 'chemical', unit: 'gallon', costPerUnit: 12, coversMinutes: 2400, hazard: 'ammonia', note: 'Most glass cleaners contain ammonia — keep away from bleach products.' },
  toilet_cleaner: { id: 'toilet_cleaner', name: 'Toilet bowl cleaner', category: 'chemical', unit: 'bottle', costPerUnit: 4, coversMinutes: 800, hazard: 'acid' },
  floor_cleaner: { id: 'floor_cleaner', name: 'Floor cleaner (pH-neutral concentrate)', category: 'chemical', unit: 'gallon', costPerUnit: 18, coversMinutes: 2400, note: 'pH-neutral is safe on sealed wood, tile and vinyl alike.' },
  carpet_spot: { id: 'carpet_spot', name: 'Carpet spot treatment', category: 'chemical', unit: 'bottle', costPerUnit: 9, coversMinutes: 900, note: 'Blot, never rub. Test on a hidden patch first.' },
  wood_polish: { id: 'wood_polish', name: 'Wood surface polish', category: 'chemical', unit: 'bottle', costPerUnit: 8, coversMinutes: 1800 },
  stainless_polish: { id: 'stainless_polish', name: 'Stainless steel polish', category: 'chemical', unit: 'bottle', costPerUnit: 8, coversMinutes: 1800 },

  microfiber: { id: 'microfiber', name: 'Microfiber cloths', category: 'consumable', unit: 'pack of 12', costPerUnit: 12, coversMinutes: 6000, note: 'Launder and reuse. Colour-code: one set for bathrooms, another for kitchen.' },
  scrub_pads: { id: 'scrub_pads', name: 'Non-scratch scrub pads', category: 'consumable', unit: 'pack', costPerUnit: 6, coversMinutes: 1200 },
  grout_brush: { id: 'grout_brush', name: 'Grout / detail brush', category: 'tool', unit: 'unit', costPerUnit: 5 },
  extension_duster: { id: 'extension_duster', name: 'Extendable duster', category: 'tool', unit: 'unit', costPerUnit: 12 },
  vacuum: { id: 'vacuum', name: 'Vacuum with attachments', category: 'tool', unit: 'unit', costPerUnit: 0, note: 'Bring the upholstery and crevice heads.' },
  pet_hair_tool: { id: 'pet_hair_tool', name: 'Pet-hair rubber brush', category: 'tool', unit: 'unit', costPerUnit: 8 },
  mop: { id: 'mop', name: 'Mop & bucket', category: 'tool', unit: 'unit', costPerUnit: 0 },
  squeegee: { id: 'squeegee', name: 'Window squeegee', category: 'tool', unit: 'unit', costPerUnit: 10 },
  steam_cleaner: { id: 'steam_cleaner', name: 'Steam cleaner', category: 'tool', unit: 'unit', costPerUnit: 0, note: 'Worth carrying for heavy grease or grout — cuts scrubbing time sharply.' },
  hepa_vacuum: { id: 'hepa_vacuum', name: 'HEPA vacuum', category: 'tool', unit: 'unit', costPerUnit: 0, note: 'Required for construction dust — a standard vacuum just redistributes it.' },

  trash_bags: { id: 'trash_bags', name: 'Heavy-duty trash bags', category: 'consumable', unit: 'roll', costPerUnit: 12, coversMinutes: 1500 },
  paper_towels: { id: 'paper_towels', name: 'Paper towels', category: 'consumable', unit: 'pack', costPerUnit: 8, coversMinutes: 900 },

  gloves: { id: 'gloves', name: 'Nitrile gloves', category: 'ppe', unit: 'box of 100', costPerUnit: 12, coversMinutes: 4000 },
  mask: { id: 'mask', name: 'N95 mask', category: 'ppe', unit: 'unit', costPerUnit: 2, coversMinutes: 480 },
  goggles: { id: 'goggles', name: 'Safety goggles', category: 'ppe', unit: 'unit', costPerUnit: 8, note: 'Reusable — wipe down between jobs.' },
  shoe_covers: { id: 'shoe_covers', name: 'Shoe covers', category: 'consumable', unit: 'pack', costPerUnit: 8, coversMinutes: 2400 },
};

export interface SupplyLine {
  id: string;
  name: string;
  category: SupplyCategory;
  /** Units to pack — always whole, because you can't carry half a bottle. */
  quantity: number;
  unit: string;
  /**
   * Cost of what this job actually *consumes*, which is fractional: a bottle
   * that covers 180 minutes used on a 90-minute job costs half a bottle, not
   * a whole one. Charging full units per job overstates cost badly enough to
   * turn a healthy margin negative.
   */
  estimatedCost: number;
  /** Why the plan includes this — shown so a cleaner can sanity-check it. */
  reason: string;
  hazard?: Hazard;
  note?: string;
}

export interface SupplyPlan {
  lines: SupplyLine[];
  totalCost: number;
  /** Protective equipment the chemicals on this job require. */
  ppeRequired: string[];
  /** Never-mix warnings for the combination selected. */
  safetyWarnings: string[];
}

interface Rule {
  supply: string;
  reason: string;
  when: (ctx: RuleContext) => boolean;
}

interface RuleContext {
  soil: SoilScores;
  objects: string[];
  roomTypes: RoomType[];
  serviceSlug: string;
}

const has = (objects: string[], pattern: RegExp) => objects.some((o) => pattern.test(o));

const RULES: Rule[] = [
  // Always-on basics
  { supply: 'all_purpose', reason: 'Every job', when: () => true },
  { supply: 'microfiber', reason: 'Every job', when: () => true },
  { supply: 'gloves', reason: 'Every job', when: () => true },
  { supply: 'trash_bags', reason: 'Every job', when: () => true },

  // Grease
  { supply: 'degreaser', reason: 'Grease detected', when: (c) => c.soil.grease >= 30 },
  { supply: 'scrub_pads', reason: 'Grease or stains need scrubbing', when: (c) => c.soil.grease >= 30 || c.soil.stains >= 40 },
  { supply: 'oven_cleaner', reason: 'Oven present with grease', when: (c) => has(c.objects, /oven|stove|range/) && c.soil.grease >= 25 },
  { supply: 'steam_cleaner', reason: 'Heavy grease — steam saves scrubbing time', when: (c) => c.soil.grease >= 60 },

  // Bathroom
  { supply: 'bathroom_disinfectant', reason: 'Bathroom in scope', when: (c) => c.roomTypes.includes('bathroom') || has(c.objects, /toilet|shower|bathtub/) },
  { supply: 'toilet_cleaner', reason: 'Toilet present', when: (c) => has(c.objects, /toilet/) || c.roomTypes.includes('bathroom') },
  { supply: 'mold_remover', reason: 'Mold detected', when: (c) => c.soil.mold >= 20 },
  { supply: 'limescale', reason: 'Hard-water marks on fixtures', when: (c) => c.soil.stains >= 35 && (c.roomTypes.includes('bathroom') || has(c.objects, /shower|bathtub|sink/)) },
  { supply: 'grout_brush', reason: 'Grout needs detail work', when: (c) => c.soil.mold >= 20 || (c.soil.stains >= 35 && c.roomTypes.includes('bathroom')) },

  // Dust and surfaces
  { supply: 'extension_duster', reason: 'Dust build-up', when: (c) => c.soil.dust >= 35 },
  { supply: 'glass_cleaner', reason: 'Glass or mirrors present', when: (c) => has(c.objects, /window|mirror|glass/) },
  { supply: 'squeegee', reason: 'Interior windows in scope', when: (c) => has(c.objects, /window/) && c.soil.dust >= 30 },
  { supply: 'wood_polish', reason: 'Wood surfaces present', when: (c) => has(c.objects, /cabinet|table|desk|wood/) },
  { supply: 'stainless_polish', reason: 'Stainless appliances present', when: (c) => has(c.objects, /refrigerator|fridge|dishwasher|microwave/) },

  // Floors and soft surfaces
  { supply: 'floor_cleaner', reason: 'Every job', when: () => true },
  { supply: 'mop', reason: 'Every job', when: () => true },
  { supply: 'vacuum', reason: 'Every job', when: () => true },
  { supply: 'carpet_spot', reason: 'Carpet with stains', when: (c) => has(c.objects, /carpet|rug/) && c.soil.stains >= 25 },
  { supply: 'pet_hair_tool', reason: 'Pet hair detected', when: (c) => c.soil.hair >= 30 },

  // Waste and protection
  { supply: 'paper_towels', reason: 'Trash or heavy soiling', when: (c) => c.soil.trash >= 20 || c.soil.grease >= 30 },
  { supply: 'mask', reason: 'Mold or construction dust', when: (c) => c.soil.mold >= 20 || c.serviceSlug === 'post-construction-cleaning' },
  { supply: 'goggles', reason: 'Caustic or bleach products in use', when: (c) => c.soil.mold >= 20 || (has(c.objects, /oven/) && c.soil.grease >= 25) },
  { supply: 'hepa_vacuum', reason: 'Construction dust needs HEPA filtration', when: (c) => c.serviceSlug === 'post-construction-cleaning' },
  { supply: 'shoe_covers', reason: 'Move-in or post-construction handover', when: (c) => ['move-in-cleaning', 'post-construction-cleaning'].includes(c.serviceSlug) },
];

/** Chemical pairs that must never be used together. */
const INCOMPATIBLE: { a: Hazard; b: Hazard; warning: string }[] = [
  { a: 'bleach', b: 'ammonia', warning: 'This job needs both a bleach-based product and an ammonia-based one. Never mix or use them on the same surface back-to-back — the combination releases chloramine gas. Rinse thoroughly and ventilate between them.' },
  { a: 'bleach', b: 'acid', warning: 'This job needs both a bleach-based product and an acidic one. Never combine them — the mix releases chlorine gas. Rinse the surface fully before switching products.' },
];

/**
 * Builds the supply plan for a job.
 * Quantities scale with job length so a 6-hour deep clean doesn't get planned
 * with the same single bottle as a 90-minute touch-up.
 */
export function planSupplies(ctx: {
  soil: SoilScores;
  objects: DetectedObject[];
  roomTypes: RoomType[];
  serviceSlug: string;
  totalMinutes: number;
}): SupplyPlan {
  const objectNames = ctx.objects.map((o) => o.name.toLowerCase());
  const ruleContext: RuleContext = {
    soil: ctx.soil,
    objects: objectNames,
    roomTypes: ctx.roomTypes,
    serviceSlug: ctx.serviceSlug,
  };

  const chosen = new Map<string, string>();
  for (const rule of RULES) {
    if (!rule.when(ruleContext)) continue;
    // First rule to select a supply owns the reason — rules are ordered from
    // most specific justification to least.
    if (!chosen.has(rule.supply)) chosen.set(rule.supply, rule.reason);
  }

  const lines: SupplyLine[] = [];
  const ppe = new Set<string>();
  const hazards = new Set<Hazard>();

  for (const [id, reason] of chosen) {
    const supply = SUPPLY_CATALOG[id];
    if (!supply) continue;

    // Pack whole units; charge only what the job burns through. Reusable
    // tools are capital, not a per-job expense, so they cost nothing here.
    const unitsConsumed = supply.coversMinutes ? ctx.totalMinutes / supply.coversMinutes : 0;
    const quantity = supply.coversMinutes ? Math.max(1, Math.ceil(unitsConsumed)) : 1;

    lines.push({
      id: supply.id,
      name: supply.name,
      category: supply.category,
      quantity,
      unit: supply.unit,
      estimatedCost: Number((supply.costPerUnit * unitsConsumed).toFixed(2)),
      reason,
      hazard: supply.hazard,
      note: supply.note,
    });

    for (const item of supply.requiresPpe ?? []) ppe.add(item);
    if (supply.hazard) hazards.add(supply.hazard);
  }

  const safetyWarnings = INCOMPATIBLE.filter((pair) => hazards.has(pair.a) && hazards.has(pair.b)).map(
    (pair) => pair.warning,
  );

  // Consumables and PPE first — those are what gets forgotten in the van.
  const order: SupplyCategory[] = ['chemical', 'consumable', 'ppe', 'tool'];
  lines.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));

  return {
    lines,
    totalCost: Number(lines.reduce((sum, l) => sum + l.estimatedCost, 0).toFixed(2)),
    ppeRequired: [...ppe],
    safetyWarnings,
  };
}
