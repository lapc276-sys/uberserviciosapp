import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  captionFor,
  droppedNote,
  joinList,
  wordsFor,
  estimateWalkSeconds,
  joinEs,
  planFrameCount,
  shortenedNote,
  MAX_GUIDED_FRAMES,
  SPACE_TEMPLATES,
} from '../lib/capture/guide';
import { MAX_FRAMES } from '../lib/vision/input';
import { TOTAL_BUDGET_CHARS } from '../lib/vision/frames';

/**
 * The walkthrough planner, against the homes people actually live in.
 *
 * The bug this guards against was silent and expensive: a two-bedroom,
 * two-bath apartment with a living and dining room filmed the kitchen, both
 * bathrooms and ONE bedroom, and the planning screen said only that "6 detail
 * shots" would be skipped. The second bedroom, the living room and the dining
 * room were never filmed, so the model never saw them, so the price never
 * charged for them — about a third of the apartment.
 */

const HOMES: Record<string, Record<string, number>> = {
  estudio: { kitchen: 1, bathroom: 1, living_room: 1 },
  '1 hab / 1 baño + sala': { kitchen: 1, bathroom: 1, bedroom: 1, living_room: 1 },
  '2 hab / 2 baños + sala + comedor': { kitchen: 1, bathroom: 2, bedroom: 2, living_room: 1, dining_room: 1 },
  '3 hab / 2 baños + sala + comedor': { kitchen: 1, bathroom: 2, bedroom: 3, living_room: 1, dining_room: 1 },
};

function spacesIn(selection: Record<string, number>): number {
  return Object.values(selection).reduce((a, b) => a + b, 0);
}

for (const [name, selection] of Object.entries(HOMES)) {
  test(`${name}: every space is filmed`, () => {
    const plan = buildPlan(selection);
    const filmed = new Set(plan.steps.map((s) => s.spaceKey));

    assert.equal(filmed.size, spacesIn(selection), `filmed ${[...filmed].join(', ')}`);
    assert.deepEqual(plan.droppedSpaces, []);
    assert.equal(plan.tooManySpaces, false);
    assert.equal(droppedNote(plan), null);
    assert.ok(planFrameCount(plan.steps) <= MAX_GUIDED_FRAMES);
  });
}

test('kitchens and bathrooms keep every required shot', () => {
  // They carry most of the labour and most of the variance; cutting a bedroom
  // close-up costs far less accuracy than cutting the shower.
  const plan = buildPlan(HOMES['3 hab / 2 baños + sala + comedor']);
  for (const template of SPACE_TEMPLATES.filter((t) => t.keepWhole && t.key !== 'closet')) {
    const required = template.steps.filter((s) => !s.optional).map((s) => s.title);
    for (const spaceKey of new Set(plan.steps.filter((s) => s.spaceKey.startsWith(`${template.key}-`)).map((s) => s.spaceKey))) {
      const titles = plan.steps.filter((s) => s.spaceKey === spaceKey).map((s) => s.title);
      for (const title of required) assert.ok(titles.includes(title), `${spaceKey} lost "${title}"`);
    }
  }
});

test('a space cut down keeps its pan and one close-up', () => {
  const plan = buildPlan(HOMES['2 hab / 2 baños + sala + comedor']);
  assert.ok(plan.lightened.length > 0, 'this home needs shortening — the test is not testing anything');

  for (const { es: label } of plan.lightened) {
    const steps = plan.steps.filter((s) => s.spaceLabel === label);
    // The pan is what the room's questions are built from, and the only frame
    // of the whole room. Losing it would leave a close-up of a floor.
    assert.ok(steps.some((s) => s.mode === 'pan' && s.frames >= 2), `${label} lost its pan`);
    assert.equal(steps.filter((s) => s.mode !== 'pan').length, 1, `${label} should keep exactly one close-up`);
  }
});

test('the shortening is said, per space', () => {
  const plan = buildPlan(HOMES['2 hab / 2 baños + sala + comedor']);
  const note = shortenedNote(plan);
  assert.ok(note);
  for (const { es: label } of plan.lightened) assert.ok(note.includes(label), `"${note}" does not name ${label}`);
  // And in English, with the English names.
  const noteEn = shortenedNote(plan, 'en');
  assert.ok(noteEn?.startsWith('To keep it short'));
  for (const { en: label } of plan.lightened) assert.ok(noteEn!.includes(label), `"${noteEn}" does not name ${label}`);
});

test('a small home is not shortened at all', () => {
  const plan = buildPlan(HOMES.estudio);
  assert.deepEqual(plan.lightened, []);
  assert.equal(plan.droppedOptional, 0);
  assert.equal(shortenedNote(plan), null);
});

test('a home that cannot fit names what is left out', () => {
  // Far past one walk. Something has to go, and it has to be said by name.
  const plan = buildPlan({ kitchen: 1, bathroom: 4, bedroom: 5, living_room: 1, dining_room: 1, office: 1 });

  assert.ok(plan.droppedSpaces.length > 0);
  assert.equal(plan.tooManySpaces, true);
  assert.ok(planFrameCount(plan.steps) <= MAX_GUIDED_FRAMES);

  const note = droppedNote(plan);
  assert.ok(note);
  for (const { es: label } of plan.droppedSpaces) assert.ok(note.includes(label), `"${note}" does not name ${label}`);
  const noteEn = droppedNote(plan, 'en');
  for (const { en: label } of plan.droppedSpaces) assert.ok(noteEn!.includes(label), `"${noteEn}" does not name ${label}`);

  // Whole spaces only: a dropped space contributes nothing, a kept one keeps its pan.
  for (const { es: label } of plan.droppedSpaces) {
    assert.equal(plan.steps.filter((s) => s.spaceLabel === label).length, 0, `${label} half-dropped`);
  }
  for (const key of new Set(plan.steps.map((s) => s.spaceKey))) {
    assert.ok(
      plan.steps.some((s) => s.spaceKey === key && s.mode === 'pan') || key.startsWith('closet-'),
      `${key} kept without its pan`,
    );
  }
  // And the kitchen, filmed first, is never what goes.
  assert.ok(!plan.droppedSpaces.some((s) => s.es === 'Cocina'));
});

test('a two-bedroom apartment stays a few minutes long', () => {
  // The walk is the customer's patience. ~9s a step, ~14s a pan.
  const plan = buildPlan(HOMES['2 hab / 2 baños + sala + comedor']);
  const minutes = estimateWalkSeconds(plan.steps) / 60;
  assert.ok(minutes <= 5, `${minutes.toFixed(1)} min`);
});

test('the server accepts every frame the walkthrough plans', () => {
  // Two constants in two files describing one limit. If the planner ever
  // outgrows the route, the customer finishes the walk and gets a 400.
  assert.ok(MAX_FRAMES >= MAX_GUIDED_FRAMES, `server ${MAX_FRAMES} < walkthrough ${MAX_GUIDED_FRAMES}`);
});

test('each frame still gets a legible share of the upload budget', () => {
  // ~41KB of JPEG per 512px frame is a clean image; much below that and the
  // grout in a shower close-up turns to mush.
  const share = TOTAL_BUDGET_CHARS / MAX_GUIDED_FRAMES;
  assert.ok(share >= 50_000, `only ${Math.round(share)} chars per frame`);
});

test('joinEs reads like Spanish', () => {
  assert.equal(joinEs([]), '');
  assert.equal(joinEs(['Sala']), 'Sala');
  assert.equal(joinEs(['Sala', 'Comedor']), 'Sala y Comedor');
  assert.equal(joinEs(['Habitación 1', 'Sala', 'Comedor']), 'Habitación 1, Sala y Comedor');
});

test('every step can be said in English, with its space named in English', () => {
  const plan = buildPlan({ kitchen: 1, bathroom: 2, bedroom: 1, living_room: 1, dining_room: 1, laundry: 1, office: 1, hallway: 1, closet: 1, other: 1 });
  for (const step of plan.steps) {
    assert.ok(step.en.title && step.en.spoken, `${step.id} has no English`);
    assert.ok(Boolean(step.after) === Boolean(step.en.after), `${step.id}: "after" exists in one language only`);
    assert.notEqual(step.en.spoken, step.spoken, `${step.id} is not translated`);
  }
  const bath2 = plan.steps.find((s) => s.spaceKey === 'bathroom-2')!;
  assert.equal(bath2.spaceLabel, 'Baño 2');
  assert.equal(bath2.en.spaceLabel, 'Bathroom 2');
  assert.equal(wordsFor(bath2, 'en').spaceLabel, 'Bathroom 2');
  assert.equal(wordsFor(bath2, 'es').spoken, bath2.spoken);
});

test('the caption the model reads stays Spanish whatever language the walk is in', () => {
  // Two caption languages would be two ways of describing one oven to the
  // thing that prices it.
  const [first] = buildPlan({ kitchen: 1 }).steps;
  assert.equal(captionFor(first), '[kitchen-1] kitchen — Vista general (Cocina)');
});

test('joinList reads like English too', () => {
  assert.equal(joinList(['Kitchen', 'Bathroom', 'Office'], 'en'), 'Kitchen, Bathroom and Office');
});
