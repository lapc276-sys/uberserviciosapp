import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJobVoice } from '../lib/workers/voice';
import { jobRooms } from '../lib/workers/job';
import { OBJECT_WORDS, findObject, objectLabel } from '../lib/workers/objects';
import { OBJECT_TIME_COST } from '../lib/vision/model';
import type { RoomAnalysis } from '../lib/vision/types';

/**
 * Hands-free mode: what a cleaner says with the phone strapped on.
 *
 * A misheard command does not throw — it charges the oven's minutes to the
 * wrong room, or splits the kitchen in two. These tests pin the sentences
 * that matter, including the ones that must do nothing.
 */

function room(type: RoomAnalysis['type'], objects: string[]): RoomAnalysis {
  return {
    type,
    label: type,
    confidence: 0.8,
    objects: objects.map((name) => ({ name, count: 1, confidence: 0.9 })),
    soil: { dust: 0, grease: 0, stains: 0, clutter: 0, hair: 0, trash: 0, mold: 0 },
    condition: 'fair',
    estimatedMinutes: 30,
  } as RoomAnalysis;
}

const rooms = jobRooms(
  {
    rooms: [
      room('kitchen', ['oven', 'stove', 'microwave', 'fridge', 'sink']),
      room('bathroom', ['toilet', 'shower', 'sink', 'mirror']),
      room('bathroom', ['toilet', 'bathtub']),
      room('living_room', ['sofa', 'window']),
    ],
    depthChoices: { 'kitchen:oven': 'deep' },
  },
  'house-cleaning',
);

const say = (text: string, current?: string) => parseJobVoice(text, rooms, current ? { roomKey: current } : null);

test('every word list names a catalogue object, so every object can be predicted', () => {
  for (const key of Object.keys(OBJECT_WORDS)) assert.ok(OBJECT_TIME_COST[key], `"${key}" is not in OBJECT_TIME_COST`);
});

test('an object starts its own clock in the room that has it', () => {
  assert.deepEqual(say('horno'), { kind: 'room', roomKey: 'kitchen-1', taskKey: 'oven', label: 'Limpia el horno por dentro · Cocina' });
  assert.equal((say('el microondas') as { taskKey: string }).taskKey, 'microwave');
  // "fridge" and "refrigerator" and "nevera" are one appliance.
  assert.equal((say('nevera') as { taskKey: string }).taskKey, 'refrigerator');
  assert.equal((say('the fridge') as { taskKey: string }).taskKey, 'refrigerator');
});

test('the same object in two rooms goes to the room she is in', () => {
  assert.equal((say('inodoro', 'bathroom-2') as { roomKey: string }).roomKey, 'bathroom-2');
  assert.equal((say('inodoro', 'kitchen-1') as { roomKey: string }).roomKey, 'bathroom-1');
  // Or to the one she names.
  assert.equal((say('inodoro del baño dos', 'bathroom-1') as { roomKey: string }).roomKey, 'bathroom-2');
  // A bathroom sink is a lavamanos on screen, a kitchen sink a fregadero.
  assert.match((say('lavamanos', 'bathroom-1') as { label: string }).label, /^Lavamanos/);
});

test('rooms by name, with "dos" for the second', () => {
  assert.deepEqual(say('cocina'), { kind: 'room', roomKey: 'kitchen-1', label: 'Cocina' });
  assert.equal((say('baño dos') as { roomKey: string }).roomKey, 'bathroom-2');
  assert.equal((say('segundo baño') as { kind: string }).kind, 'room');
  assert.equal((say('voy al baño') as { roomKey: string }).roomKey, 'bathroom-1');
  // "poceta" is the toilet, not the bathroom.
  assert.equal((say('poceta', 'bathroom-1') as { taskKey: string }).taskKey, 'toilet');
});

test('stopping and leaving', () => {
  assert.deepEqual(say('termino'), { kind: 'pause' });
  // Not "start the oven".
  assert.deepEqual(say('termino el horno'), { kind: 'pause' });
  assert.deepEqual(say('me voy'), { kind: 'leave' });
  assert.deepEqual(say('termino todo'), { kind: 'leave' });
});

test('what is not a command does nothing', () => {
  for (const text of ['hola', 'qué calor hace', 'garaje', 'la lavadora', '', 'horno tostador']) {
    assert.equal(say(text).kind, 'unknown', text);
  }
});

test('longer names win: the toaster oven is not the oven', () => {
  assert.equal(findObject('horno tostador'), 'toaster oven');
  assert.equal(findObject('el horno'), 'oven');
  assert.equal(objectLabel('sink', 'bathroom'), 'Lavamanos');
  assert.equal(objectLabel('bathtub'), 'Bañera');
});
