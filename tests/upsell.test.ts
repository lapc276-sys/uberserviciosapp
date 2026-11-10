import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionsForRoom, depthChoicesFrom, noteFrom, promptFor, MAX_QUESTIONS_PER_ROOM } from '../lib/vision/upsell';
import { depthGapFor } from '../lib/vision/model';
import { objectMinutesFor, depthChoiceFor, OBJECT_TIME_COST } from '../lib/vision/model';
import { buildAnalysis } from '../lib/vision/estimate';
import { EMPTY_SOIL, type RawRoomObservation, type SoilScores } from '../lib/vision/types';

/**
 * The questions asked mid-walkthrough, and whether answering them moves money.
 *
 * A question that does not change the price is worse than no question: it
 * spends the customer's patience and then quotes them the same number, which
 * is how somebody learns the app is theatre.
 */

const soil = (over: Partial<SoilScores> = {}): SoilScores => ({ ...EMPTY_SOIL, ...over });

const obj = (name: string, count = 1, confidence = 0.8) => ({ name, count, confidence });

test('it only asks about things it actually saw', () => {
  // A question about an oven in a kitchen with no oven tells the customer the
  // app is guessing, and then they stop believing the price too.
  const questions = questionsForRoom('kitchen', [obj('microwave')], soil());
  const asked = questions.map((q) => q.object);

  assert.ok(asked.includes('microwave'));
  assert.ok(!asked.includes('oven'));
  assert.ok(!asked.includes('refrigerator'));
});

test('it does not ask about things that cost the same either way', () => {
  // Opening a light switch is not a different job. Asking spends the one
  // thing a walkthrough cannot buy back.
  const flat = Object.entries(OBJECT_TIME_COST).find(([, c]) => c.deep - c.surface < 2);
  assert.ok(flat, 'expected at least one object with no meaningful depth gap');

  const questions = questionsForRoom('kitchen', [obj(flat[0])], soil());
  assert.equal(questions.length, 0, `${flat[0]} should not be worth a question`);
});

test('the biggest money is asked about first, and the tail is cut', () => {
  const questions = questionsForRoom(
    'kitchen',
    [obj('toaster'), obj('coffee maker'), obj('microwave'), obj('oven'), obj('refrigerator'), obj('dishwasher')],
    soil(),
  );

  assert.ok(questions.length <= MAX_QUESTIONS_PER_ROOM + 1);
  // Somebody answers three questions and abandons the eighth, so the oven and
  // the fridge have to come before the toaster rather than after it.
  assert.equal(questions[0].object, 'oven');
  assert.ok(!questions.map((q) => q.object).includes('toaster'));

  const minutes = questions.filter((q) => q.kind === 'depth').map((q) => q.extraMinutes);
  assert.deepEqual(minutes, [...minutes].sort((a, b) => b - a), 'questions must be ranked by minutes');
});

test('ten cabinets is worth more than one', () => {
  const one = questionsForRoom('kitchen', [obj('cabinet', 1)], soil())[0];
  const ten = questionsForRoom('kitchen', [obj('cabinet', 10)], soil())[0];

  // A question that promises minutes the estimator will not charge for loses
  // money on every yes, so the count has to be the estimator's own cap.
  assert.ok(ten.extraMinutes > one.extraMinutes * 5, `${one.extraMinutes} → ${ten.extraMinutes}`);
});

test('one question per kind of thing, not one per thing', () => {
  const questions = questionsForRoom('kitchen', [obj('refrigerator'), obj('refrigerator')], soil());
  assert.equal(questions.filter((q) => q.object === 'refrigerator').length, 1);
});

test('a shaky detection does not produce a confident question', () => {
  assert.equal(questionsForRoom('kitchen', [obj('oven', 1, 0.2)], soil()).length, 0);
  assert.ok(questionsForRoom('kitchen', [obj('oven', 1, 0.9)], soil()).length > 0);
});

test('a deep clean does not ask you to confirm what you already bought', () => {
  // Asking again invites somebody to decline something they have paid for.
  const questions = questionsForRoom('kitchen', [obj('oven'), obj('refrigerator')], soil(), {
    alreadyDeep: true,
  });
  assert.equal(questions.filter((q) => q.kind === 'depth').length, 0);
});

test('tidying is offered only when there is real clutter, and only offered', () => {
  assert.equal(questionsForRoom('bedroom', [], soil({ clutter: 10 })).length, 0);

  const offered = questionsForRoom('bedroom', [], soil({ clutter: 70 }));
  assert.equal(offered.length, 1);
  assert.equal(offered[0].kind, 'declutter');
  // Priced through the clutter dimension the estimator already weighs, so it
  // must not also promise minutes of its own.
  assert.equal(offered[0].extraMinutes, 0);
});

test('a yes is recorded as deep and a no as surface, never as nothing', () => {
  const questions = questionsForRoom('kitchen', [obj('oven'), obj('refrigerator')], soil());
  const choices = depthChoicesFrom(questions, {
    'kitchen:oven': true,
    'kitchen:refrigerator': false,
  });

  assert.equal(choices['kitchen:oven'], 'deep');
  // Dropping a "no" would make it impossible to decline the inside of a
  // fridge on a deep clean, which is the only way that choice can be made.
  assert.equal(choices['kitchen:refrigerator'], 'surface');
});

test('an unanswered question changes nothing', () => {
  const questions = questionsForRoom('kitchen', [obj('oven')], soil());
  assert.deepEqual(depthChoicesFrom(questions, {}), {});
});

test('a room-specific answer beats a general one', () => {
  const choices = { 'kitchen:cabinet': 'deep' as const, cabinet: 'surface' as const };
  assert.equal(depthChoiceFor('cabinet', 'kitchen', choices), 'deep');
  assert.equal(depthChoiceFor('cabinet', 'bathroom', choices), 'surface');
});

test('saying yes to the oven on a standard clean actually costs more', () => {
  // The whole point. 1.5 minutes wiped, 14 opened up.
  const wiped = objectMinutesFor('oven', 'house-cleaning');
  const opened = objectMinutesFor('oven', 'house-cleaning', 'deep');
  assert.ok(opened > wiped * 5, `${wiped} → ${opened}`);
});

test('saying no on a deep clean actually costs less', () => {
  const included = objectMinutesFor('refrigerator', 'deep-cleaning');
  const declined = objectMinutesFor('refrigerator', 'deep-cleaning', 'surface');
  assert.ok(declined < included, `${included} → ${declined}`);
});

test('the answers reach the quote, not just the log', () => {
  const kitchen: RawRoomObservation = {
    type: 'kitchen',
    confidence: 0.8,
    objects: [obj('oven'), obj('refrigerator')],
    soil: soil(),
  };

  const plain = buildAnalysis([kitchen], { serviceSlug: 'house-cleaning', source: 'heuristic' });
  const withYes = buildAnalysis([kitchen], {
    serviceSlug: 'house-cleaning',
    source: 'heuristic',
    depthChoices: { 'kitchen:oven': 'deep', 'kitchen:refrigerator': 'deep' },
  });

  // A question that does not move the total is theatre, and the customer
  // finds out when the crew spends an hour on an oven nobody billed for.
  assert.ok(
    withYes.totalMinutes > plain.totalMinutes + 15,
    `${plain.totalMinutes} → ${withYes.totalMinutes} minutes`,
  );
});

test('the crew is told about tidying, in words, not minutes', () => {
  const questions = questionsForRoom('bedroom', [], soil({ clutter: 70 }));
  const note = noteFrom(questions, { 'bedroom:declutter': true });
  assert.ok(note && note.includes('bedroom'));
  assert.equal(noteFrom(questions, { 'bedroom:declutter': false }), undefined);
});

test('every object worth asking about can be asked about in Spanish', () => {
  // The first version of the phrase table was keyed with underscores while
  // the catalogue uses spaces, so "range hood" never matched and the customer
  // was asked about "el range hood". An object with no phrase is skipped
  // rather than asked in two languages, so a gap here is a silent lost
  // upsell — which is why it is counted instead of trusted.
  const missing = Object.keys(OBJECT_TIME_COST)
    .filter((name) => depthGapFor(name) >= 2)
    .filter((name) => promptFor(name, 'kitchen') === null);

  assert.deepEqual(missing, [], `no Spanish question for: ${missing.join(', ')}`);
});

test('a question never leaks the English catalogue name', () => {
  for (const name of Object.keys(OBJECT_TIME_COST)) {
    const prompt = promptFor(name, 'kitchen');
    if (!prompt || !name.includes(' ')) continue;
    assert.ok(!prompt.includes(name), `"${name}" appears untranslated in: ${prompt}`);
  }
});

test('nobody is sold the outside of a window', () => {
  // The crew is not leaning out of a fourth floor, and a question must not
  // sell what cannot safely be delivered.
  const prompt = promptFor('window', 'living_room');
  assert.ok(prompt && prompt.includes('por dentro'));
  assert.ok(!prompt.includes('por fuera'));
});

test('a sofa and a couch are one question, not an echo', () => {
  const questions = questionsForRoom('living_room', [obj('sofa'), obj('couch')], soil());
  assert.equal(questions.filter((q) => q.kind === 'depth').length, 1);
});

test('a sink is a fregadero in the kitchen and a lavamanos in the bathroom', () => {
  assert.ok(promptFor('sink', 'kitchen')?.includes('fregadero'));
  assert.ok(promptFor('sink', 'bathroom')?.includes('lavamanos'));
});
