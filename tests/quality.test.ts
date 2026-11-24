import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DARK_P90,
  SHARP_HEIGHT,
  SHARP_WIDTH,
  brightnessOf,
  isTooDark,
  panTooFast,
  sharpnessOf,
  usablePanFrames,
} from '../lib/capture/quality';

/**
 * The checks behind "está muy oscuro" and "más despacio".
 *
 * What matters most here is the false alarm. A bot that says "está oscuro" in
 * a lit kitchen, every step, is a bot people learn to ignore — so the frames
 * that must NOT trip it are tested as carefully as the ones that must.
 */

const GRID = 32 * 32;

/** Chromium's fake camera, as measured: green field ~79, a bright shape ~150. */
function fakeCamera(): Uint8Array {
  const out = new Uint8Array(GRID);
  for (let i = 0; i < GRID; i++) out[i] = i % 32 > 11 && i % 32 < 21 && i > 300 && i < 700 ? 150 : 79;
  return out;
}

function scaled(signature: Uint8Array, factor: number): Uint8Array {
  return signature.map((v) => Math.round(v * factor));
}

test('the test camera is not dark — so the browser tests never wait for light', () => {
  assert.equal(isTooDark(fakeCamera()), false);
  assert.ok(brightnessOf(fakeCamera())! > DARK_P90);
});

test('a frame with no light is dark', () => {
  // Measured: the fake camera darkened to 12% sits under 20.
  assert.equal(isTooDark(scaled(fakeCamera(), 0.12)), true);
});

test('a black stovetop in a lit kitchen is not dark', () => {
  // Mostly black, but a lit room leaves reflections and surroundings in the
  // frame. The mean says "dark"; the brightest tenth says "there is light".
  const out = new Uint8Array(GRID).fill(28);
  for (let i = 0; i < GRID; i += 6) out[i] = 210;
  assert.equal(isTooDark(out), false);
});

test('nothing to measure is not dark', () => {
  assert.equal(isTooDark(null), false);
  assert.equal(brightnessOf(null), null);
});

test('a slow sweep is fine and a swing is not', () => {
  assert.equal(panTooFast([0.05, 0.08, 0.1, 0.07]), false);
  assert.equal(panTooFast([0.06, 0.31, 0.36, 0.29]), true);
  // Too early to judge.
  assert.equal(panTooFast([0.4, 0.5]), false);
});

function checkerboard(cell: number): Uint8Array {
  const out = new Uint8Array(SHARP_WIDTH * SHARP_HEIGHT);
  for (let y = 0; y < SHARP_HEIGHT; y++) {
    for (let x = 0; x < SHARP_WIDTH; x++) {
      out[y * SHARP_WIDTH + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 200 : 40;
    }
  }
  return out;
}

/** A horizontal box blur: what a phone swung sideways does to an image. */
function smeared(gray: Uint8Array, radius: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < SHARP_HEIGHT; y++) {
    for (let x = 0; x < SHARP_WIDTH; x++) {
      let sum = 0;
      let n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = Math.max(0, Math.min(SHARP_WIDTH - 1, x + dx));
        sum += gray[y * SHARP_WIDTH + xx];
        n++;
      }
      out[y * SHARP_WIDTH + x] = Math.round(sum / n);
    }
  }
  return out;
}

test('a smeared frame measures softer than the same frame still', () => {
  const still = checkerboard(8);
  assert.ok(sharpnessOf(still) > sharpnessOf(smeared(still, 4)) * 1.5);
  assert.equal(sharpnessOf(new Uint8Array(SHARP_WIDTH * SHARP_HEIGHT).fill(120)), 0);
  assert.equal(sharpnessOf(null), 0);
});

test('a pan keeps lit, sharp frames, in sweep order, and never too few', () => {
  const pan = [
    { id: 'a', dark: false, sharpness: 9 },
    { id: 'blur', dark: false, sharpness: 2 },
    { id: 'b', dark: false, sharpness: 8 },
    { id: 'dark', dark: true, sharpness: 9 },
    { id: 'c', dark: false, sharpness: 10 },
  ];

  const kept = usablePanFrames(pan, 2).map((f) => f.id);
  assert.deepEqual(kept, ['a', 'b', 'c']);

  // All dark: there is nothing better, so keep what there is.
  const night = pan.map((f) => ({ ...f, dark: true }));
  assert.ok(usablePanFrames(night, 2).length >= 2);

  // Never fewer than the pan promised: when too few clear the bar, the
  // sharpest of the rest make up the number, still in sweep order.
  const soft = [
    { id: 'w', dark: false, sharpness: 20 },
    { id: 'x', dark: false, sharpness: 1 },
    { id: 'y', dark: false, sharpness: 1.1 },
    { id: 'z', dark: false, sharpness: 25 },
  ];
  assert.deepEqual(usablePanFrames(soft, 3).map((f) => f.id), ['w', 'y', 'z']);

  // Relative, not absolute: a pan that is soft all over (a white hallway) is
  // not thrown away for being soft.
  const plain = [1, 1.1, 0.9, 1.2].map((sharpness, i) => ({ id: String(i), dark: false, sharpness }));
  assert.equal(usablePanFrames(plain, 2).length, 4);
});
