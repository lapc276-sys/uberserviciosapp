import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysis } from '../lib/vision/estimate';
import { taskFor } from '../lib/vision/upsell';
import { OBJECT_TIME_COST } from '../lib/vision/model';
import { SUPPLY_CATALOG } from '../lib/vision/supplies';
import { EMPTY_SOIL, type RawRoomObservation, type SoilScores } from '../lib/vision/types';
import type { CrewPlan, CrewPlanStep } from '../lib/vision/plan';

/**
 * The crew's plan: the order of work, and the chemistry of that order.
 *
 * The scheduling is a convenience. The chemistry is not: this plan is read by
 * somebody about to put products on surfaces, and a line in the wrong place
 * here is a ruined countertop or a bathroom full of chlorine gas. Those tests
 * come first and are written to fail loudly.
 */

const soil = (over: Partial<SoilScores> = {}): SoilScores => ({ ...EMPTY_SOIL, ...over });
const obj = (name: string, count = 1) => ({ name, count, confidence: 0.85 });

function room(over: Partial<RawRoomObservation>): RawRoomObservation {
  return { type: 'bedroom', confidence: 0.85, objects: [], soil: soil(), ...over };
}

function plan(rooms: RawRoomObservation[], serviceSlug = 'house-cleaning', depthChoices?: Record<string, 'surface' | 'deep'>) {
  const analysis = buildAnalysis(rooms, { serviceSlug, source: 'heuristic', depthChoices });
  return { analysis, plan: analysis.crewPlan as CrewPlan };
}

const textOf = (steps: CrewPlanStep[]) => steps.flatMap((s) => s.actions).join('\n');
const stepsFor = (p: CrewPlan, label: string) => p.steps.filter((s) => s.room === label);

const moldyStoneBathroom = room({
  type: 'bathroom',
  objects: [obj('toilet'), obj('shower')],
  soil: soil({ mold: 40, stains: 50 }),
  materials: [{ name: 'natural_stone', confidence: 0.8 }],
});

// ── Chemistry ───────────────────────────────────────────────────────────────

test('bleach and acid are never sprayed in the same room at the same time', () => {
  // Mold remover is chlorine; toilet cleaner is acid. Together: chlorine gas.
  const { plan: p } = plan([room({ type: 'bathroom', objects: [obj('toilet')], soil: soil({ mold: 40 }) })]);
  const spray = p.steps.find((s) => s.kind === 'pretreat')!;

  assert.ok(textOf([spray]).includes('quitamoho'));
  assert.ok(!textOf([spray]).includes('limpiador de inodoro'), 'acid must not be sprayed alongside bleach');

  // It comes later, after a rinse, and the line says why.
  const clean = p.steps.find((s) => s.kind === 'clean')!;
  const line = clean.actions.find((a) => a.includes('limpiador de inodoro'))!;
  assert.ok(line, 'the held-back acid must still be used, later');
  assert.ok(line.includes('Enjuaga'), line);
  assert.ok(line.indexOf('Enjuaga') < line.indexOf('limpiador de inodoro'), 'rinse first, then the acid');
});

test('acids alone are sprayed together — they do not need separating', () => {
  const { plan: p } = plan([
    room({ type: 'bathroom', objects: [obj('toilet')], soil: soil({ stains: 50 }) }),
  ]);
  const spray = textOf(p.steps.filter((s) => s.kind === 'pretreat'));
  assert.ok(spray.includes('limpiador de inodoro'));
  assert.ok(spray.includes('antical'));
});

test('the plan never tells the crew to put acid where stone is', () => {
  // The bug this exists for: the first version warned "nothing acidic on the
  // stone" and two lines later said "apply limescale remover to the shower",
  // in the same bathroom. A warning the plan contradicts is not a warning.
  const { plan: p } = plan([moldyStoneBathroom]);
  const lines = textOf(p.steps).split('\n');

  const applies = lines.filter((l) => /aplica/i.test(l) && l.includes('antical'));
  assert.deepEqual(applies, [], `antical applied next to stone:\n${applies.join('\n')}`);

  const barred = lines.find((l) => l.startsWith('Aquí no uses antical'));
  assert.ok(barred, 'the crew must be told why the usual product is missing');
  assert.ok(barred.includes('pH neutro'), 'and what to use instead');
});

test('a product kept inside a fixture is allowed, with a warning not to splash', () => {
  // Toilet cleaner goes in the bowl, not on the vanity. Dropping it would
  // leave the toilet uncleaned for no reason; using it silently would leave
  // the stone floor unprotected.
  const { plan: p } = plan([moldyStoneBathroom]);
  const line = textOf(p.steps).split('\n').find((l) => l.includes('limpiador de inodoro'))!;
  assert.ok(line);
  assert.ok(line.includes('salpique'), line);
});

test('brass taps keep the limescale remover away too', () => {
  const { plan: p } = plan([
    room({
      type: 'bathroom',
      objects: [obj('toilet'), obj('shower')],
      soil: soil({ stains: 50 }),
      materials: [{ name: 'specialty_metal', confidence: 0.8 }],
    }),
  ]);
  const lines = textOf(p.steps).split('\n');
  assert.equal(lines.filter((l) => /aplica/i.test(l) && l.includes('antical')).length, 0);
  assert.ok(lines.some((l) => l.startsWith('Aquí no uses antical')));
});

test('a stone bathroom does not stop the next bathroom getting limescale remover', () => {
  // The bottle is still in the van; it is only barred where it would harm.
  const { plan: p } = plan([
    moldyStoneBathroom,
    room({ type: 'bathroom', objects: [obj('toilet')], soil: soil({ stains: 50 }) }),
  ]);
  const second = textOf(stepsFor(p, 'Baño 2'));
  assert.ok(second.includes('antical') && !second.includes('Aquí no uses antical'), second);
});

test('every pre-treatment the plan uses was actually packed', () => {
  const { analysis, plan: p } = plan([
    room({ type: 'kitchen', objects: [obj('oven')], soil: soil({ grease: 60 }) }),
    moldyStoneBathroom,
  ]);
  const packed = new Set(analysis.supplyPlan!.lines.map((l) => l.id));
  const names: Record<string, string> = {
    oven_cleaner: 'limpiahornos',
    degreaser: 'desengrasante',
    mold_remover: 'quitamoho',
    limescale: 'antical',
    toilet_cleaner: 'limpiador de inodoro',
  };
  const applied = textOf(p.steps)
    .split('\n')
    .filter((l) => /^Aplica|aplica /.test(l));
  for (const [id, es] of Object.entries(names)) {
    if (applied.some((l) => l.includes(es))) assert.ok(packed.has(id), `${es} applied but ${id} not packed`);
  }
});

test('every product that is left to soak says for how long', () => {
  for (const id of ['oven_cleaner', 'degreaser', 'mold_remover', 'limescale', 'toilet_cleaner']) {
    assert.ok(SUPPLY_CATALOG[id].dwellMinutes, `${id} has no dwell time`);
  }
});

// ── Time ────────────────────────────────────────────────────────────────────

test('the plan never changes the price', () => {
  // Its overlaps are real, but its room constants are unmeasured, and a
  // schedule built on guesses gives a precise-looking wrong number. The
  // minutes it hands out must add up to the quote, to the minute.
  const { analysis, plan: p } = plan([
    room({ type: 'kitchen', objects: [obj('oven'), obj('refrigerator')], soil: soil({ grease: 60, clutter: 40 }), tidying: { toClear: 12, elsewhere: 3, dishes: 20 } }),
    moldyStoneBathroom,
    room({ type: 'bathroom', objects: [obj('toilet')], soil: soil({ stains: 20 }) }),
    room({ type: 'living_room', objects: [obj('sofa')], soil: soil({ dust: 40, hair: 50 }) }),
    room({ type: 'bedroom', objects: [obj('bed')] }),
  ], 'house-cleaning', { 'kitchen:dishes': 'deep', 'kitchen:oven': 'deep' });

  assert.equal(p.handsOnMinutes, analysis.totalMinutes);
});

test('the slowest product is sprayed first, so its clock starts earliest', () => {
  const { plan: p } = plan([
    room({ type: 'bathroom', objects: [obj('toilet')], soil: soil({ stains: 50 }) }),
    room({ type: 'kitchen', objects: [obj('oven')], soil: soil({ grease: 60 }) }),
  ]);
  const sprays = p.steps.filter((s) => s.kind === 'pretreat');
  assert.equal(sprays[0].room, 'Cocina', 'the oven cleaner needs the longest');
  for (let i = 1; i < sprays.length; i++) {
    assert.ok((sprays[i - 1].dwellMinutes ?? 0) >= (sprays[i].dwellMinutes ?? 0));
  }
});

test('a room is never finished before its product has worked', () => {
  const { plan: p } = plan([
    room({ type: 'kitchen', objects: [obj('oven')], soil: soil({ grease: 60 }) }),
    room({ type: 'bathroom', objects: [obj('toilet')] }),
    room({ type: 'bedroom', objects: [obj('bed')] }),
  ]);
  for (const spray of p.steps.filter((s) => s.kind === 'pretreat')) {
    const finish = p.steps.find((s) => s.kind === 'clean' && s.room === spray.room)!;
    assert.ok(finish, `${spray.room} was sprayed and never finished`);
    const ready = spray.startsAt + spray.minutes + (spray.dwellMinutes ?? 0);
    assert.ok(finish.startsAt >= ready, `${spray.room}: finished at ${finish.startsAt}, ready at ${ready}`);
  }
});

test('the product works while other rooms are being cleaned', () => {
  // The point of the plan: ten minutes of toilet cleaner in the bowl are ten
  // minutes spent on the bedroom, not ten minutes standing in the bathroom.
  const { plan: p } = plan([
    room({ type: 'bathroom', objects: [obj('toilet')] }),
    room({ type: 'bedroom', objects: [obj('bed')], soil: soil({ dust: 40, clutter: 40 }) }),
    room({ type: 'living_room', objects: [obj('sofa')], soil: soil({ dust: 40 }) }),
  ]);
  assert.equal(p.idleMinutes, 0);
  assert.equal(p.overlappedMinutes, SUPPLY_CATALOG.toilet_cleaner.dwellMinutes);
});

test('when there is nothing else to do, the wait is reported, not hidden', () => {
  // A one-room job with oven cleaner has twenty minutes and nothing to fill
  // them with. Saying so lets the crew skip the soak or start it in the van.
  const { plan: p } = plan([room({ type: 'kitchen', objects: [obj('oven')], soil: soil({ grease: 60 }) })]);
  assert.ok(p.idleMinutes > 0, 'a lone soaking oven must show a wait');
  assert.equal(p.idleMinutes + p.overlappedMinutes, SUPPLY_CATALOG.oven_cleaner.dwellMinutes);
});

test('the bathrooms are finished last, so their products have had the longest', () => {
  const { plan: p } = plan([
    room({ type: 'bathroom', objects: [obj('toilet')] }),
    room({ type: 'bedroom', objects: [obj('bed')], soil: soil({ dust: 40 }) }),
    room({ type: 'living_room', objects: [obj('sofa')], soil: soil({ dust: 40 }) }),
  ]);
  const cleans = p.steps.filter((s) => s.kind === 'clean');
  assert.equal(cleans[cleans.length - 1].roomType, 'bathroom');
});

// ── What the crew reads ─────────────────────────────────────────────────────

test('what the customer agreed to is in the plan, and what they declined is not', () => {
  const kitchen = room({
    type: 'kitchen',
    objects: [obj('refrigerator')],
    tidying: { toClear: 5, elsewhere: 2, dishes: 20 },
  });
  const yes = textOf(plan([kitchen], 'house-cleaning', { 'kitchen:dishes': 'deep', 'kitchen:refrigerator': 'deep' }).plan.steps);
  const no = textOf(plan([kitchen], 'house-cleaning', { 'kitchen:dishes': 'surface' }).plan.steps);

  assert.ok(yes.includes('Lava los platos'), yes);
  assert.ok(yes.includes('nevera por dentro'), yes);
  assert.ok(!no.includes('Lava los platos'), no);
  assert.ok(!no.includes('nevera por dentro'), no);
});

test('the oven is not listed twice when the oven cleaner already does it', () => {
  const { plan: p } = plan(
    [room({ type: 'kitchen', objects: [obj('oven')], soil: soil({ grease: 60 }) })],
    'house-cleaning',
    { 'kitchen:oven': 'deep' },
  );
  const lines = textOf(p.steps).split('\n').filter((l) => /horno/.test(l));
  assert.ok(!lines.some((l) => l.startsWith('Limpia el horno por dentro')), lines.join('\n'));
});

test('the brush for pet hair is only suggested where there is something soft', () => {
  const { plan: p } = plan([
    room({ type: 'bathroom', objects: [obj('toilet')], soil: soil({ hair: 60 }) }),
    room({ type: 'living_room', objects: [obj('sofa')], soil: soil({ hair: 60 }) }),
  ]);
  assert.ok(!textOf(stepsFor(p, 'Baño')).includes('cepillo de goma'));
  assert.ok(textOf(stepsFor(p, 'Sala')).includes('cepillo de goma'));
});

test('rooms are named in Spanish and numbered when repeated', () => {
  const { plan: p } = plan([
    room({ type: 'bedroom' }),
    room({ type: 'bedroom' }),
    room({ type: 'kitchen' }),
  ]);
  const names = new Set(p.steps.map((s) => s.room));
  assert.ok(names.has('Dormitorio 1') && names.has('Dormitorio 2') && names.has('Cocina'), [...names].join(', '));
});

test('every inside-the-object instruction is an instruction, not a question', () => {
  // The crew's lines come from the same phrases as the customer's questions,
  // so the two can never describe different work. Every phrase has to
  // convert: a leftover "limpiemos" in a work order reads as a mistake.
  for (const name of Object.keys(OBJECT_TIME_COST)) {
    const task = taskFor(name, 'kitchen');
    if (!task) continue;
    assert.ok(!/\b\w+(emos|amos)\b/.test(task), `"${name}" was not converted: ${task}`);
    assert.equal(task.charAt(0), task.charAt(0).toUpperCase(), task);
  }
});

test('a house with nothing to soak is simply cleaned in order', () => {
  const { plan: p } = plan([room({ type: 'bedroom' }), room({ type: 'living_room' })]);
  assert.equal(p.steps.filter((s) => s.kind === 'pretreat').length, 0);
  assert.equal(p.idleMinutes, 0);
  assert.equal(p.overlappedMinutes, 0);
  assert.deepEqual(
    p.steps.map((s) => s.roomType),
    ['living_room', 'bedroom'],
  );
});
