import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettleWatcher, difference, STILL, MOVED } from '../lib/capture/scene';

/**
 * The shutter's decision, against the real module.
 *
 * This is what makes the walkthrough hands-free: it fires when the view
 * changes and then holds still — a fridge door swinging open, then a steady
 * hand. Both ways it can fail are invisible on screen. Trigger-happy and it
 * photographs a wall mid-walk; deaf and it waits out the nine-second timeout
 * on every step, turning a three-minute walkthrough into six.
 *
 * Runs in node rather than a browser because none of this touches a canvas —
 * `signatureOf` does, and is covered by the end-to-end walkthrough instead.
 */

const GRID = 32;

function field(value: (x: number) => number, jitter = 6): Uint8Array {
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < out.length; i++) {
    const noise = Math.round((Math.random() - 0.5) * jitter);
    out[i] = Math.max(0, Math.min(255, value(i % GRID) + noise));
  }
  return out;
}

/** A closed stainless door: flat mid-grey, plus the shake of a held phone. */
const closed = () => field(() => 120);
/** The same door open: bright interior on one side, dark cavity on the other. */
const open = () => field((x) => (x < 20 ? 210 : 90));

test('a door opening clears the movement threshold with margin', () => {
  const moved = difference(closed(), open());
  const still = difference(closed(), closed());

  // Measured at roughly 0.26 and 0.008 against thresholds of 0.09 and 0.035.
  // The margin is asserted rather than the value: a change that halves either
  // gap makes the walkthrough unreliable in a way no screenshot would show.
  assert.ok(moved > MOVED * 2, `door opening ${moved.toFixed(3)} should clear ${MOVED} twice over`);
  assert.ok(still < STILL / 2, `held steady ${still.toFixed(3)} should sit well under ${STILL}`);
});

test('fires only after the view changes and then settles', () => {
  const watcher = new SettleWatcher();
  const script = [closed(), closed(), closed(), open(), open(), open(), open()];

  let firedAt = -1;
  script.forEach((signature, i) => {
    if (watcher.push(signature) && firedAt < 0) firedAt = i;
  });

  // Not while the door merely sits there closed...
  assert.ok(firedAt > 3, 'must not fire before the door opens');
  // ...and not the instant it moves either: the shot is the steady interior.
  assert.ok(firedAt <= 6, `should have fired once settled, got ${firedAt}`);
});

test('never fires on a phone held perfectly still', () => {
  const watcher = new SettleWatcher();
  let fired = false;
  for (let i = 0; i < 20; i++) fired = watcher.push(closed()) || fired;

  // Stillness alone is not a shot. If it were, every step would fire at once,
  // before anyone had aimed at anything.
  assert.equal(fired, false);
});

test('never fires while the camera keeps moving', () => {
  const watcher = new SettleWatcher();
  let fired = false;
  for (let i = 0; i < 20; i++) fired = watcher.push(i % 2 ? open() : closed()) || fired;

  // Someone still walking to the next counter must not be photographed.
  assert.equal(fired, false);
});

test('resets between steps so one settle cannot fire twice', () => {
  const watcher = new SettleWatcher();
  const run = () => {
    let fired = false;
    for (const s of [closed(), open(), open(), open()]) fired = watcher.push(s) || fired;
    return fired;
  };

  assert.equal(run(), true);
  // A watcher that kept its state would fire again on the next step's first
  // steady sample, before that step's instruction had even been followed.
  const watcher2 = new SettleWatcher();
  watcher2.push(closed());
  assert.equal(watcher2.push(closed()), false);
});
