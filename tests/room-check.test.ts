import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceScout, sceneVerdict } from '../lib/vision/scout';
import { coerceObservations } from '../lib/vision/analyzer';
import { objectNoun } from '../lib/vision/remarks';

/**
 * "Ya vi el microondas" — said in a car.
 *
 * The model was told "This is a kitchen" and found one. These pin the
 * gates that stop a told-you-so from becoming objects, questions and money,
 * and the ones that stop the check itself from insulting somebody standing
 * in their own open-plan kitchen.
 */

test('a car is not a kitchen, however the model was asked', () => {
  const car = coerceScout({
    scene: 'none',
    sceneConfidence: 0.9,
    objects: [{ name: 'microwave', count: 1, confidence: 0.7, dirt: 1 }],
    clutter: 40,
    damage: [{ kind: 'cabinet', confidence: 0.8 }],
  });
  // Whatever it listed, it imagined.
  assert.equal(car.scene, 'none');
  assert.deepEqual(car.objects, []);
  assert.deepEqual(car.conditions, []);
  assert.equal(car.soil.clutter, 0);
  assert.equal(car.damage, undefined);
  assert.deepEqual(sceneVerdict('kitchen', car.scene, car.sceneConfidence), { matches: false, saw: 'none' });
});

test('an office shown as the kitchen is said, not priced as a kitchen', () => {
  assert.deepEqual(sceneVerdict('kitchen', 'office', 0.8), { matches: false, saw: 'office' });
  assert.deepEqual(sceneVerdict('bathroom', 'bedroom', 0.75), { matches: false, saw: 'bedroom' });
});

test('the check errs towards leaving people alone', () => {
  // An open-plan kitchen read as the living room is the right room.
  assert.equal(sceneVerdict('kitchen', 'living_room', 0.95).matches, true);
  assert.equal(sceneVerdict('dining_room', 'kitchen', 0.9).matches, true);
  // Too dark or too close to tell: never a mismatch.
  assert.equal(sceneVerdict('kitchen', 'unclear', 0.9).matches, true);
  // A model that is not sure does not get to say "this is not your kitchen".
  assert.equal(sceneVerdict('kitchen', 'none', 0.5).matches, true);
  assert.equal(sceneVerdict('kitchen', 'office', 0.55).matches, true);
  // A bedroom that is really a study is the same clean.
  assert.equal(sceneVerdict('bedroom', 'office', 0.95).matches, true);
  assert.equal(sceneVerdict('other', 'garage', 0.95).matches, true);
});

test('a reply without a scene is "unclear", which never stops anybody', () => {
  const old = coerceScout({ objects: [{ name: 'oven', count: 1, confidence: 0.8 }] });
  assert.equal(old.scene, 'unclear');
  assert.equal(old.objects.length, 1);
  assert.equal(sceneVerdict('kitchen', old.scene, old.sceneConfidence).matches, true);
  // And a made-up scene is not a room type.
  assert.equal(coerceScout({ scene: 'spaceship', sceneConfidence: 1 }).scene, 'unclear');
});

test('the final analysis drops what was not a home, and counts it', () => {
  const { rooms, notAHome } = coerceObservations({
    rooms: [
      { type: 'none', confidence: 0.9, objects: [{ name: 'microwave', count: 1, confidence: 0.8 }], soil: { dust: 50 } },
      { type: 'bathroom', confidence: 0.8, objects: [{ name: 'toilet', count: 1, confidence: 0.9 }], soil: {} },
    ],
  });
  assert.deepEqual(
    rooms.map((r) => r.type),
    ['bathroom'],
  );
  assert.equal(notAHome, 1);
  // An unknown type is still "other", as before: only "none" means not a home.
  assert.equal(coerceObservations({ rooms: [{ type: 'attic', objects: [], soil: {} }] }).rooms[0].type, 'other');
});

test('what the customer pointed at is named in their language', () => {
  assert.equal(objectNoun('washing machine', 'laundry', 'es'), 'la lavadora');
  assert.equal(objectNoun('sink', 'bathroom', 'es'), 'el lavamanos');
  assert.equal(objectNoun('oven', 'kitchen', 'en'), 'the oven');
  assert.equal(objectNoun('knife block', 'kitchen', 'es'), null);
});

import { SAY_ROOM_CHECK, aRoom, theSpace } from '../lib/capture/roomcheck';
import {
  COMMANDS,
  parseDepth,
  parseProducts,
  parseTools,
  parseWhen,
  parseYesNo,
  wantsToContinue,
} from '../lib/capture/conversation';
import { ROOM_TYPES } from '../lib/vision/types';
import { normalize } from '../lib/vision/voice-commands';

/** Every sentence the room check can say, in both languages. */
function everyLine(): string[] {
  const lines: string[] = [];
  for (const lang of ['es', 'en'] as const) {
    const say = SAY_ROOM_CHECK[lang];
    for (const asked of ROOM_TYPES) {
      for (const label of ['Cocina', 'Baño 2', 'Habitación 1']) {
        const space = theSpace(asked, label, lang);
        lines.push(say.mismatch('none', space));
        for (const saw of ROOM_TYPES) lines.push(say.mismatch(saw, space));
      }
    }
    lines.push(say.point, say.pointAfter, say.unknown);
    for (const things of [['la lavadora'], ['el horno', 'la nevera'], ['the washer'], ['the oven', 'the fridge']]) {
      lines.push(say.found(things.join(lang === 'en' ? ' and ' : ' y ')));
    }
  }
  return [...new Set(lines)];
}

test('nothing the room check says can be heard back as an answer or a command', () => {
  // Said through the same speaker the microphone hears. "No veo la cocina"
  // would have answered the next question "no"; "...y sigue" would have
  // moved the walk on by itself.
  const commands = [...COMMANDS.es.capture, ...COMMANDS.en.capture, ...COMMANDS.es.skip, ...COMMANDS.en.skip];
  const offenders: string[] = [];
  for (const line of everyLine()) {
    const words = ` ${normalize(line)} `;
    if (parseYesNo(line) !== null) offenders.push(`yes/no: ${line}`);
    if (wantsToContinue(line)) offenders.push(`continue: ${line}`);
    if (Object.keys(parseWhen(line)).length) offenders.push(`when: ${line}`);
    if (parseProducts(line) !== null) offenders.push(`products: ${line}`);
    if (parseTools(line) !== null) offenders.push(`tools: ${line}`);
    if (parseDepth(line) !== null) offenders.push(`depth: ${line}`);
    for (const c of commands) if (words.includes(` ${normalize(c)} `)) offenders.push(`"${c}": ${line}`);
  }
  assert.deepEqual(offenders, []);
  assert.ok(everyLine().length > 100, 'the check should be looking at real sentences');
});

test('spaces and rooms are spoken with their articles', () => {
  assert.equal(theSpace('bathroom', 'Baño 2', 'es'), 'el baño 2');
  assert.equal(theSpace('kitchen', 'Cocina', 'es'), 'la cocina');
  assert.equal(theSpace('bathroom', 'Bathroom 2', 'en'), 'the bathroom 2');
  assert.equal(theSpace('other', 'Armario / despensa (organizar)', 'es'), 'ese espacio');
  assert.equal(SAY_ROOM_CHECK.es.mismatch('office', 'la cocina'), 'Esto parece una oficina, y yo buscaba la cocina.');
  assert.equal(aRoom('office', 'en'), 'an office');
});
