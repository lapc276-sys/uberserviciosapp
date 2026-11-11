import type { Hazard } from './supplies';
import type { DetectedMaterial } from './types';

/**
 * Surfaces that change how a room has to be cleaned.
 *
 * The object catalogue answers "what is in the room". This answers "what is it
 * made of", which the catalogue never could: ninety-seven objects and not one
 * of them was a surface, so a marble vanity and a laminate one were the same
 * job, quoted the same and — worse — packed for the same.
 *
 * They are not the same job. Marble takes a different product and a hand-dry;
 * stainless is wiped along its grain and polished; and the mistake is not a
 * slow clean but a ruined surface, which is a claim for more than the job
 * paid. So a material does two things here: it adds a little time, and it
 * tells the crew what must not touch it.
 *
 * What this deliberately is NOT is a wealth signal. Nothing below reads a
 * brand, a postcode or a price tag. A kitchen costs more because its counter
 * needs a neutral product and a dry buff, which can be said to the customer's
 * face and written on the quote — and is why the note produced here names the
 * material and the minutes rather than hiding either. New York's Algorithmic
 * Pricing Disclosure Act (in force since November 2025) attaches a mandatory
 * warning to prices set from a consumer's personal data; pricing the surface
 * the camera saw is pricing the job.
 *
 * Every `extraMinutes` below is a HYPOTHESIS. None was measured, they are kept
 * small on purpose, and they follow the same rule as the time constants in
 * model.ts: do not tune them from a handful of jobs.
 */

export interface MaterialCare {
  /** Spanish, for the note the customer and the crew both read. */
  label: string;
  /** What the method is, in the same note. */
  care: string;
  /** Told to the vision model so it knows what it is looking for. */
  looksLike: string;
  /** Added once per room where it is seen. Unmeasured — see above. */
  extraMinutes: number;
  /** Chemical families that damage it. */
  avoidHazards: Hazard[];
  /** Supply ids that damage it regardless of chemistry. */
  avoidSupplies: string[];
  /** Supply ids the job needs because of it. */
  requires: string[];
  /** What goes wrong, for the crew's warning. English, like its neighbours. */
  damage: string;
}

/**
 * Deliberately few, and deliberately broad.
 *
 * `natural_stone` lumps marble with granite and anything that merely looks
 * like stone, because a phone photo cannot tell engineered quartz from
 * marble and the two mistakes are not equally expensive: treating quartz as
 * marble costs four minutes and a gentler product, treating marble as quartz
 * costs a countertop.
 */
export const MATERIALS: Record<string, MaterialCare> = {
  natural_stone: {
    label: 'piedra natural',
    care: 'producto pH neutro y secado a mano',
    looksLike:
      'marble, granite, travertine, limestone or any stone-look countertop, vanity top, floor or shower wall — veined or speckled, polished or honed',
    extraMinutes: 4,
    avoidHazards: ['acid'],
    avoidSupplies: [],
    requires: ['stone_cleaner'],
    damage:
      'acid etches it permanently — keep limescale remover, toilet cleaner and vinegar off it, and do not rest those bottles on it',
  },
  stainless_steel: {
    label: 'acero inoxidable',
    care: 'paño en el sentido de la veta y pulido',
    looksLike: 'brushed or polished stainless-steel appliance fronts, sinks, range hoods or worktops',
    extraMinutes: 3,
    avoidHazards: ['bleach'],
    avoidSupplies: [],
    requires: ['stainless_polish'],
    damage: 'bleach pits it and abrasive pads scratch it — wipe along the grain with a soft cloth only',
  },
  hardwood: {
    label: 'suelo de madera',
    care: 'mopa apenas húmeda, nunca vapor',
    looksLike: 'hardwood or engineered-wood flooring with visible planks and grain',
    // No extra time: a damp mop is not slower than a wet one. What it changes
    // is what may be used, which is the warning below.
    extraMinutes: 0,
    avoidHazards: [],
    avoidSupplies: ['steam_cleaner'],
    requires: [],
    damage: 'steam and standing water lift the finish and cup the boards — damp mop only',
  },
  specialty_metal: {
    label: 'grifería de acabado especial',
    care: 'solo paño suave y secado a mano',
    looksLike: 'brass, gold-tone, bronze or matte-black faucets, handles, shower fittings or hardware',
    extraMinutes: 2,
    avoidHazards: ['acid'],
    avoidSupplies: ['scrub_pads'],
    requires: [],
    damage: 'acids and scrub pads strip the finish — mild soap and a soft cloth only',
  },
};

/**
 * Two thresholds, because the two mistakes cost different things.
 *
 * A warning shown for a surface that turned out to be laminate costs nothing.
 * A missing one costs a countertop. So the crew is warned on a weak sighting,
 * and the customer is only billed on a firm one.
 */
export const WARN_AT_CONFIDENCE = 0.35;
export const BILL_AT_CONFIDENCE = 0.5;

/**
 * Known materials only, one entry each, keeping the firmest sighting.
 *
 * Anything outside the table is dropped here — a model that volunteers
 * "Sub-Zero" or "expensive-looking" gets exactly as far as this line.
 */
export function knownMaterials(materials: DetectedMaterial[] | undefined): DetectedMaterial[] {
  const best = new Map<string, number>();
  for (const m of materials ?? []) {
    const name = String(m?.name ?? '').trim().toLowerCase();
    if (!MATERIALS[name]) continue;
    const confidence = Math.max(0, Math.min(Number(m.confidence) || 0.5, 1));
    best.set(name, Math.max(best.get(name) ?? 0, confidence));
  }
  return [...best.entries()].map(([name, confidence]) => ({ name, confidence }));
}

/** The ones firm enough to charge for. */
function billable(materials: DetectedMaterial[] | undefined): DetectedMaterial[] {
  return knownMaterials(materials).filter((m) => m.confidence >= BILL_AT_CONFIDENCE);
}

/**
 * Minutes a room's materials add.
 *
 * Once per material per room — a kitchen with marble on the counter and the
 * backsplash is one neutral product and one buffing pass, not two — and
 * weighted by confidence exactly as objects are, so a shaky sighting cannot
 * inflate a bill. Bounded by construction: the whole table sums to under ten
 * minutes.
 */
export function materialMinutes(materials: DetectedMaterial[] | undefined): number {
  return billable(materials).reduce(
    (sum, m) => sum + MATERIALS[m.name].extraMinutes * m.confidence,
    0,
  );
}

/**
 * Says why, in the customer's language.
 *
 * A surcharge nobody can explain is the thing this module exists to avoid, so
 * every billed minute is named next to the surface that caused it.
 */
export function materialNote(materials: DetectedMaterial[] | undefined): string | undefined {
  const parts = billable(materials).map((m) => {
    const care = MATERIALS[m.name];
    const minutes = Math.round(care.extraMinutes * m.confidence);
    return minutes > 0 ? `${care.label} — ${care.care} (+${minutes} min)` : `${care.label} — ${care.care}`;
  });
  return parts.length ? `Materiales: ${parts.join('; ')}` : undefined;
}

/** Supplies the job needs because of what its surfaces are made of. */
export function suppliesRequiredBy(materials: DetectedMaterial[] | undefined): { supply: string; reason: string }[] {
  return knownMaterials(materials)
    .filter((m) => m.confidence >= WARN_AT_CONFIDENCE)
    .flatMap((m) =>
      MATERIALS[m.name].requires.map((supply) => ({
        supply,
        reason: `${m.name.replace(/_/g, ' ')} seen in the walkthrough`,
      })),
    );
}

/**
 * What in the van must not touch what in the house.
 *
 * Checked against the supplies actually planned for this job, not a generic
 * list: the warning that matters is "the limescale remover you are carrying
 * for the shower will etch the vanity next to it", and that only exists once
 * both halves are known.
 */
export function materialWarnings(
  materials: DetectedMaterial[] | undefined,
  planned: { id: string; name: string; hazard?: Hazard }[],
): string[] {
  const warnings: string[] = [];

  for (const m of knownMaterials(materials)) {
    if (m.confidence < WARN_AT_CONFIDENCE) continue;
    const care = MATERIALS[m.name];

    const clashing = planned.filter(
      (s) => (s.hazard && care.avoidHazards.includes(s.hazard)) || care.avoidSupplies.includes(s.id),
    );
    if (clashing.length === 0) continue;

    const surface = m.name.replace(/_/g, ' ');
    const names = clashing.map((s) => s.name.toLowerCase()).join(', ');
    warnings.push(
      `This home has ${surface}: ${care.damage}. On this job that means keeping these away from it: ${names}.`,
    );
  }

  return warnings;
}
