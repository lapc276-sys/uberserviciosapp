import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIDY_SECONDS,
  TIDY_COUNT_CAP,
  ASK_DISHES_AT,
  ASK_PUT_AWAY_AT,
  coerceTidying,
  tidyingMinutes,
} from '../lib/vision/tidying';
import { questionsForRoom, depthChoicesFrom, noteFrom } from '../lib/vision/upsell';
import { buildAnalysis } from '../lib/vision/estimate';
import { coerceObservations } from '../lib/vision/analyzer';
import { soilWeightsFor } from '../lib/vision/model';
import { EMPTY_SOIL, type RawRoomObservation, type SoilScores, type TidyingCounts } from '../lib/vision/types';

/**
 * Putting things away: counted, priced from MOST, and never charged twice.
 *
 * The old clutter score topped out at about a dozen minutes a room however
 * bad it was, and a sink full of pots added nothing at all. These tests hold
 * the replacement to three promises: a messy room now costs what tidying it
 * takes, optional work is only billed when somebody said yes, and a room the
 * analyzer did not count is priced exactly as it was before.
 */

const soil = (over: Partial<SoilScores> = {}): SoilScores => ({ ...EMPTY_SOIL, ...over });

function room(over: Partial<RawRoomObservation> = {}): RawRoomObservation {
  return { type: 'bedroom', confidence: 0.8, objects: [], soil: soil(), ...over };
}

const minutesOf = (r: RawRoomObservation, depthChoices?: Record<string, 'surface' | 'deep'>) =>
  buildAnalysis([r], { serviceSlug: 'house-cleaning', source: 'heuristic', depthChoices }).totalMinutes;

const counts = (toClear: number, elsewhere = 0, dishes = 0): TidyingCounts => ({ toClear, elsewhere, dishes });

test('a room you cannot see the floor of now costs what clearing it takes', () => {
  // The old ceiling: a bedroom at clutter 100 added its full clutter weight
  // and not a minute more, however many things were on the floor.
  const oldCeiling = soilWeightsFor('bedroom').clutter;

  const tidy = minutesOf(room({ soil: soil({ clutter: 100 }), tidying: counts(0) }));
  const buried = minutesOf(room({ soil: soil({ clutter: 100 }), tidying: counts(120) }));

  // 120 things at ten seconds each is twenty minutes of bending, which is
  // more than the old score could ever charge for the same room.
  assert.ok(buried - tidy >= 19, `${tidy} → ${buried}`);
  assert.ok(buried - tidy > oldCeiling, `counting must be able to exceed the old ${oldCeiling}-minute ceiling`);
});

test('clearing scales with the count, the way a score never could', () => {
  // "Messy" and "you cannot see the floor" both score near the top. Counted,
  // they are different jobs.
  const twenty = minutesOf(room({ soil: soil({ clutter: 80 }), tidying: counts(20) }));
  const hundred = minutesOf(room({ soil: soil({ clutter: 80 }), tidying: counts(100) }));
  assert.ok(hundred - twenty >= 12, `${twenty} → ${hundred}`);
});

test('the same mess is not charged as a score and again as a count', () => {
  // Same forty things on the floor; one room reports a clutter score of 0,
  // the other of 100. Once counted, the score must stop being minutes — or
  // the second room pays for its socks twice.
  const lowScore = minutesOf(room({ soil: soil({ clutter: 0 }), tidying: counts(40) }));
  const highScore = minutesOf(room({ soil: soil({ clutter: 100 }), tidying: counts(40) }));
  assert.equal(highScore, lowScore);
});

test('a room nobody counted is priced exactly as before counting existed', () => {
  // The heuristic analyzer and any older reply carry no counts. They must
  // keep the clutter score as their only measure of mess, unchanged.
  const weight = soilWeightsFor('bedroom').clutter;
  const calm = minutesOf(room({ soil: soil({ clutter: 0 }) }));
  const chaotic = minutesOf(room({ soil: soil({ clutter: 100 }) }));
  assert.equal(chaotic - calm, weight);
});

test('putting things away is only charged when somebody said yes', () => {
  // Deciding where a stranger's belongings live is not the cleaner's call,
  // and a basement with no signal means nobody may have been asked at all.
  const r = room({ tidying: counts(30, 20) });
  const unasked = minutesOf(r);
  const declined = minutesOf(r, { 'bedroom:declutter': 'surface' });
  const agreed = minutesOf(r, { 'bedroom:declutter': 'deep' });

  assert.equal(declined, unasked, 'a no must cost the same as not being asked');
  // Twenty things at fifteen extra seconds each.
  assert.equal(agreed - unasked, Math.round((20 * TIDY_SECONDS.elsewhere) / 60));
});

test('the dishes are only washed, and billed, on a yes', () => {
  const kitchen = room({ type: 'kitchen', tidying: counts(0, 0, 30) });
  const unasked = minutesOf(kitchen);
  const agreed = minutesOf(kitchen, { 'kitchen:dishes': 'deep' });

  // Thirty items at forty seconds is twenty minutes — the sink of pots that
  // used to add nothing at all.
  assert.equal(agreed - unasked, 20);
});

test('a yes in the bedroom does not wash the kitchen sink', () => {
  const r = room({ type: 'kitchen', tidying: counts(0, 0, 30) });
  assert.equal(minutesOf(r, { 'bedroom:dishes': 'deep' }), minutesOf(r));
});

test('clearing is not scaled by how deep the clean is', () => {
  // Forty bends are forty bends on a maintenance visit and on a deep one.
  // Scaling them would charge the depth twice — the mistake objects were
  // separated out to stop.
  const withItems = room({ tidying: counts(60) });
  const without = room({ tidying: counts(0) });
  const at = (r: RawRoomObservation, slug: string) =>
    buildAnalysis([r], { serviceSlug: slug, source: 'heuristic' }).totalMinutes;

  assert.equal(
    at(withItems, 'house-cleaning') - at(without, 'house-cleaning'),
    at(withItems, 'deep-cleaning') - at(without, 'deep-cleaning'),
  );
});

test('a count the model invented cannot run away with the bill', () => {
  const wild = coerceTidying({ toClear: 4000, elsewhere: 4000, dishes: 4000 })!;
  assert.equal(wild.toClear, TIDY_COUNT_CAP.toClear);
  assert.equal(wild.dishes, TIDY_COUNT_CAP.dishes);
  assert.ok(wild.elsewhere <= wild.toClear);
});

test('more things elsewhere than on the floor is a contradiction, resolved downward', () => {
  // Everything bound for another room still has to be picked up first. A reply
  // claiming otherwise is the model disagreeing with itself, and the smaller
  // number is the one that cannot overcharge.
  const t = coerceTidying({ toClear: 10, elsewhere: 40, dishes: 0 })!;
  assert.equal(t.elsewhere, 10);
});

test('garbage in the counts becomes zero, not a crash', () => {
  assert.deepEqual(coerceTidying({ toClear: 'lots', elsewhere: null, dishes: -5 }), counts(0, 0, 0));
  assert.equal(coerceTidying(undefined), undefined);
  assert.equal(coerceTidying('a sink full'), undefined);
});

test('the model reply is counted at the door', () => {
  const { rooms } = coerceObservations({
    rooms: [
      { type: 'kitchen', objects: [], soil: {}, tidying: { toClear: 12, elsewhere: 3, dishes: 25 } },
      { type: 'bedroom', objects: [], soil: {} },
    ],
  });
  assert.deepEqual(rooms[0].tidying, counts(12, 3, 25));
  assert.equal(rooms[1].tidying, undefined, 'a room without counts must fall back, not invent zeros');
});

test('the questions name roughly how many, and what a yes costs', () => {
  const qs = questionsForRoom('bedroom', [], soil(), { tidying: counts(30, 20) });
  const putAway = qs.find((q) => q.kind === 'declutter');
  assert.ok(putAway);
  assert.ok(putAway.prompt.includes('20'), putAway.prompt);
  assert.equal(putAway.extraMinutes, Math.round((20 * TIDY_SECONDS.elsewhere) / 60));
});

test('a couple of mugs is not worth interrupting somebody for', () => {
  const few = questionsForRoom('kitchen', [], soil(), { tidying: counts(0, 0, ASK_DISHES_AT - 1) });
  assert.equal(few.filter((q) => q.kind === 'dishes').length, 0);

  const sink = questionsForRoom('kitchen', [], soil(), { tidying: counts(0, 0, 25) });
  const dishes = sink.find((q) => q.kind === 'dishes');
  assert.ok(dishes && dishes.prompt.includes('25'));
  assert.equal(dishes.extraMinutes, Math.round((25 * TIDY_SECONDS.dish) / 60));
});

test('a few things out of place are not a question either', () => {
  const qs = questionsForRoom('bedroom', [], soil({ clutter: 90 }), {
    tidying: counts(10, ASK_PUT_AWAY_AT - 1),
  });
  // With a count, the count decides — even if the score alone would have asked.
  assert.equal(qs.filter((q) => q.kind === 'declutter').length, 0);
});

test('without counts, the old clutter question still appears and promises nothing', () => {
  const qs = questionsForRoom('bedroom', [], soil({ clutter: 70 }));
  const q = qs.find((x) => x.kind === 'declutter');
  assert.ok(q);
  assert.equal(q.extraMinutes, 0, 'a score cannot honestly support a minute figure');
});

test('the answers reach the price through the same channel as the oven', () => {
  const qs = [
    ...questionsForRoom('bedroom', [], soil(), { tidying: counts(30, 20) }),
    ...questionsForRoom('kitchen', [], soil(), { tidying: counts(0, 0, 30) }),
  ];
  const choices = depthChoicesFrom(qs, { 'bedroom:declutter': true, 'kitchen:dishes': false });
  assert.equal(choices['bedroom:declutter'], 'deep');
  assert.equal(choices['kitchen:dishes'], 'surface');
});

test('the crew is told what was asked for, in Spanish', () => {
  const qs = [
    ...questionsForRoom('bedroom', [], soil(), { tidying: counts(30, 20) }),
    ...questionsForRoom('kitchen', [], soil(), { tidying: counts(0, 0, 30) }),
  ];
  const note = noteFrom(qs, { 'bedroom:declutter': true, 'kitchen:dishes': true }) ?? '';
  assert.ok(note.includes('dormitorio'), note);
  assert.ok(note.includes('cocina'), note);
  assert.ok(!note.includes('bedroom') && !note.includes('kitchen'), `English leaked: ${note}`);
  assert.equal(noteFrom(qs, {}), undefined);
});

test('tidying minutes add up the way the comments say', () => {
  const m = tidyingMinutes(counts(60, 20, 30), 'kitchen', {
    'kitchen:declutter': 'deep',
    'kitchen:dishes': 'deep',
  });
  assert.equal(m.clearing, 10);
  assert.equal(m.puttingAway, 5);
  assert.equal(m.dishes, 20);
  assert.equal(m.total, 35);
});
