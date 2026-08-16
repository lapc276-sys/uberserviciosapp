/**
 * APPA cleanliness levels, used as the anchor for our 0–100 soil scale.
 *
 * The problem this solves is inter-rater agreement. Asking a person — or a
 * vision model — to "score the grease from 0 to 100" produces a number nobody
 * can defend, because 60 means nothing on its own. Two people score the same
 * kitchen differently, the same person scores differently on a Friday, and the
 * training data ends up encoding the rater's mood rather than the room.
 *
 * APPA's five levels are published, widely known in the industry, and written
 * deliberately in *observable* terms so that two raters land on the same level.
 * Anchoring our scale to them buys three things at once: consistent labels for
 * training, a rubric the vision prompt can be held to, and a standard a B2B
 * customer can audit instead of taking our word for a number.
 *
 * Source: APPA, "Operational Guidelines for Educational Facilities: Custodial"
 * (the five-level scale is public; the staffing tables are the paid part).
 *
 * Note the direction: APPA Level 1 is the cleanest, while our soil scale runs
 * 0 = spotless to 100 = filthy. Level 1 therefore maps to the *low* end.
 */

export interface AppaLevel {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** Inclusive range on our 0–100 soil scale. */
  min: number;
  max: number;
  /** What a rater should be able to see. Kept concrete on purpose. */
  observable: string;
  /** Spanish, for the crews who will actually be scoring these rooms. */
  observableEs: string;
}

export const APPA_LEVELS: AppaLevel[] = [
  {
    level: 1,
    name: 'Orderly spotlessness',
    min: 0,
    max: 10,
    observable: 'Surfaces bright and free of dust. No marks, streaks or smudges anywhere. Nothing out of place.',
    observableEs: 'Superficies brillantes y sin polvo. Ni marcas, ni vetas, ni huellas. Nada fuera de sitio.',
  },
  {
    level: 2,
    name: 'Ordinary tidiness',
    min: 11,
    max: 30,
    observable: 'Clean at a glance. Dust only in corners and hard-to-reach spots. Occasional light smudge.',
    observableEs: 'Limpio a simple vista. Polvo solo en rincones y sitios difíciles. Alguna marca leve.',
  },
  {
    level: 3,
    name: 'Casual inattention',
    min: 31,
    max: 55,
    observable: 'Visible dust on surfaces and edges. Smudges on glass and fixtures. Some clutter, bins near full.',
    observableEs: 'Polvo visible en superficies y bordes. Marcas en cristales y grifería. Algo de desorden, papeleras casi llenas.',
  },
  {
    level: 4,
    name: 'Moderate dinginess',
    min: 56,
    max: 80,
    observable: 'Dull, dingy surfaces. Grease or soil built up in layers. Stains that need scrubbing. Clutter blocks work.',
    observableEs: 'Superficies apagadas y sucias. Grasa o mugre acumulada en capas. Manchas que hay que restregar. El desorden estorba.',
  },
  {
    level: 5,
    name: 'Unkempt neglect',
    min: 81,
    max: 100,
    observable: 'Heavy build-up, odour, mould or pest signs. Requires stripping and repeated passes, not cleaning.',
    observableEs: 'Acumulación fuerte, olor, moho o señales de plaga. Requiere decapado y varias pasadas, no una limpieza.',
  },
];

/** The level a 0–100 soil score falls into. */
export function appaLevelFor(score: number): AppaLevel {
  const clamped = Math.max(0, Math.min(100, score));
  return APPA_LEVELS.find((l) => clamped >= l.min && clamped <= l.max) ?? APPA_LEVELS[2];
}

/** Midpoint of a level, for turning a chosen level back into a score. */
export function scoreForLevel(level: AppaLevel['level']): number {
  const found = APPA_LEVELS.find((l) => l.level === level) ?? APPA_LEVELS[2];
  return Math.round((found.min + found.max) / 2);
}

/**
 * Compact rubric for the vision prompt.
 *
 * The model is given the same words the human rater sees, so a disagreement
 * between them is a real disagreement about the room rather than two people
 * using the same number to mean different things.
 */
export function appaPromptRubric(): string {
  return APPA_LEVELS.map((l) => `${l.min}-${l.max} (APPA level ${l.level}, ${l.name}): ${l.observable}`).join('\n');
}
