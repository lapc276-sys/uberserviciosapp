import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPrice, SERVICE_MULTIPLIER } from '../lib/pricing/klaudy';

/**
 * The quoted prices, exactly.
 *
 * This is the one table in the codebase where "close enough" is a real cost:
 * every dollar of drift is a dollar off a job, on every job, and the owner
 * ends up arguing with his own website. These four are numbers he committed to
 * out loud — if a refactor moves any of them, it should fail here rather than
 * in a doorway.
 */

test('the four quoted prices come out to the dollar', () => {
  const quoted: [number, number, number][] = [
    [1, 1, 110],
    [2, 1, 150],
    [2, 2, 170],
    [3, 2, 190],
  ];

  for (const [beds, baths, expected] of quoted) {
    const { price } = listPrice({ bedrooms: beds, bathrooms: baths, serviceSlug: 'house-cleaning' });
    assert.equal(price, expected, `${beds} bed / ${baths} bath should be $${expected}, got $${price}`);
  }
});

test('the bedroom ladder is not linear, on purpose', () => {
  const at = (b: number) => listPrice({ bedrooms: b, bathrooms: 1, serviceSlug: 'house-cleaning' }).price;

  // Second bedroom adds $40, third adds $20. Setup, travel and the kitchen are
  // paid for once, so a bigger place costs less per room. A linear model would
  // have to miss at least one real quote.
  assert.equal(at(2) - at(1), 40);
  assert.equal(at(3) - at(2), 20);
});

test('a studio prices as a one-bedroom', () => {
  // It is the same work, and quoting a studio lower invites a job that takes
  // just as long for less money.
  assert.equal(listPrice({ bedrooms: 0, bathrooms: 1, serviceSlug: 'house-cleaning' }).price, 110);
});

test('deep cleaning is the owner\'s 45 percent', () => {
  assert.equal(SERVICE_MULTIPLIER['deep-cleaning'], 1.45);
  assert.equal(listPrice({ bedrooms: 1, bathrooms: 1, serviceSlug: 'deep-cleaning' }).price, 160);
  assert.equal(listPrice({ bedrooms: 2, bathrooms: 1, serviceSlug: 'deep-cleaning' }).price, 218);
});

test('prices are whole dollars', () => {
  // $159.50 reads as a machine's output; $160 reads as a price somebody chose.
  for (const slug of Object.keys(SERVICE_MULTIPLIER)) {
    for (let b = 0; b <= 6; b++) {
      const { price } = listPrice({ bedrooms: b, bathrooms: 2, serviceSlug: slug });
      assert.equal(price, Math.round(price), `${slug} ${b}-bed produced ${price}`);
    }
  }
});

test('marks sizes beyond anything actually quoted', () => {
  assert.equal(listPrice({ bedrooms: 3, bathrooms: 2, serviceSlug: 'house-cleaning' }).quoted, true);
  // Past here the ladder is extrapolating, and the page must say "from" rather
  // than present a guess with the confidence of a real quote.
  assert.equal(listPrice({ bedrooms: 5, bathrooms: 2, serviceSlug: 'house-cleaning' }).quoted, false);
  assert.equal(listPrice({ bedrooms: 2, bathrooms: 4, serviceSlug: 'house-cleaning' }).quoted, false);
});

test('never returns less than the smallest quoted job', () => {
  // A bad input must not produce a price under the floor the owner set.
  for (let b = 0; b <= 6; b++) {
    for (let ba = 1; ba <= 5; ba++) {
      const { price } = listPrice({ bedrooms: b, bathrooms: ba, serviceSlug: 'house-cleaning' });
      assert.ok(price >= 110, `${b}/${ba} produced $${price}`);
    }
  }
});
