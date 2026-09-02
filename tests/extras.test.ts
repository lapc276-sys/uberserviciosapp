import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestExtras, priceExtras, EXTRA_TASKS } from '../lib/ops/extras';

/**
 * The consent split is the whole point of this table, so it is what gets
 * tested. Everything else here is a list of strings; the rule that anything
 * opening equipment, working at height, or handling belongings must be offered
 * rather than assumed is the part that costs money when it drifts.
 */

test('nothing that opens equipment or works at height is ever unprompted', () => {
  const risky = ['ac-filter', 'oven-inside', 'inside-cabinets', 'windows-outside', 'shower-descale'];
  for (const id of risky) {
    const task = EXTRA_TASKS.find((t) => t.id === id);
    assert.ok(task, `${id} missing from the catalogue`);
    assert.equal(task!.consent, 'ask_first', `${id} must be offered, never assumed`);
  }
});

test('every ask_first task carries a price', () => {
  // An extra somebody has to stop and ask about, then does for free, is worse
  // than not offering it: it costs time and teaches the customer it is free.
  for (const task of EXTRA_TASKS.filter((t) => t.consent === 'ask_first')) {
    assert.ok((task.price ?? 0) > 0, `${task.id} needs a price`);
  }
});

test('unprompted tasks stay small', () => {
  // These are done without asking, so they must never eat the job. Anything
  // over ten minutes is a decision, not a favour.
  for (const task of EXTRA_TASKS.filter((t) => t.consent === 'unprompted')) {
    assert.ok(task.minutes <= 10, `${task.id} at ${task.minutes} min is too big to do unasked`);
    assert.equal(task.price, undefined, `${task.id} is unprompted and must not be billed`);
  }
});

test('suggests by room and by what was actually seen', () => {
  const kitchen = suggestExtras({
    type: 'kitchen',
    objects: [{ name: 'refrigerator' }, { name: 'trash can' }, { name: 'oven' }],
    soil: {},
  });
  const ids = kitchen.map((t) => t.id);
  assert.ok(ids.includes('fridge-handles'));
  assert.ok(ids.includes('bin-outside'));

  // A bathroom must not be told to wipe the fridge.
  const bath = suggestExtras({ type: 'bathroom', objects: [{ name: 'mirror' }], soil: {} });
  assert.ok(!bath.map((t) => t.id).includes('fridge-handles'));
});

test('puts the do-it-now suggestions first and keeps the list short', () => {
  const list = suggestExtras({
    type: 'kitchen',
    objects: [{ name: 'refrigerator' }, { name: 'trash can' }, { name: 'oven' }, { name: 'cabinet' }],
    soil: {},
  });
  // A panel of ten is a panel nobody reads, and a worker who learns to dismiss
  // it stops seeing the one that mattered.
  assert.ok(list.length <= 3);
  assert.equal(list[0].consent, 'unprompted');
});

test('accepted offers add their minutes and their money', () => {
  const { minutes, price } = priceExtras(['oven-inside', 'ac-filter']);
  assert.equal(minutes, 45);
  assert.equal(price, 50);
  // An unknown id must be ignored rather than counted as zero-priced work.
  assert.deepEqual(priceExtras(['nope']), { minutes: 0, price: 0 });
});
