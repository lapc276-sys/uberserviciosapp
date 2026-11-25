import { normalize, findRoom as findRoomType } from '../vision/voice-commands';
import type { JobRoom } from './job';
import { findObject, canonicalObject } from './objects';

/**
 * What a cleaner says with the phone strapped on, turned into timer actions
 * against this job's rooms.
 *
 * Hands-free mode exists because a phone on the head or chest cannot be
 * tapped, and because timing every object — stove, oven, microwave — by
 * button would be eight taps per kitchen. Said out loud it is one word each:
 *
 *   "horno"           → the oven of the room she is in (or the room it is in)
 *   "baño dos"        → the second bathroom of the walkthrough
 *   "cocina"          → the kitchen
 *   "termino"         → stop the clock (carrying things, between rooms)
 *   "me voy"          → stop the clock; the job itself is closed by hand,
 *                       because "¿hubo que repetir algo?" needs a screen
 *
 * Anything else is nothing. A word misheard as a command splits a room in
 * two or charges an oven's minutes to the wrong one; an unrecognised word
 * costs a repeat. So it errs on doing nothing, like every parser in this repo.
 */

export type JobVoiceAction =
  | { kind: 'room'; roomKey: string; taskKey?: string; label: string }
  | { kind: 'pause' }
  | { kind: 'leave' }
  | { kind: 'unknown'; heard: string };

const STOP = ['termino', 'termine', 'terminado', 'listo', 'acabe', 'pausa', 'parar', 'paro', 'stop', 'done', 'finished', 'pause'];
const LEAVE = ['me voy', 'fin del trabajo', 'termine todo', 'termino todo', 'im leaving', 'end job', 'leaving'];

const ORDINALS: Record<string, number> = {
  uno: 1, una: 1, primero: 1, primera: 1, one: 1, first: 1, '1': 1,
  dos: 2, segundo: 2, segunda: 2, two: 2, second: 2, '2': 2,
  tres: 3, tercero: 3, tercera: 3, three: 3, third: 3, '3': 3,
  cuatro: 4, cuarto: 4, four: 4, fourth: 4, '4': 4,
};

function hasPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => new RegExp(`(^|\\s)${p}(\\s|$)`).test(text));
}

/** "baño dos" → 2. "cuarto" is both a room and "fourth": only after a room word. */
function ordinalIn(text: string): number | null {
  const words = text.split(' ');
  for (let i = 1; i < words.length; i++) {
    const n = ORDINALS[words[i]];
    if (n) return n;
  }
  return null;
}

export function parseJobVoice(
  raw: string,
  rooms: JobRoom[],
  current?: { roomKey?: string } | null,
): JobVoiceAction {
  const text = normalize(raw);
  if (!text) return { kind: 'unknown', heard: raw };

  // Leaving before stopping: "termino todo" contains "termino". And stopping
  // before objects: "termino el horno" ends the oven, it does not start it.
  if (hasPhrase(text, LEAVE)) return { kind: 'leave' };
  if (hasPhrase(text, STOP)) return { kind: 'pause' };

  // Objects before rooms: "poceta" is a toilet, not a bathroom, and "horno
  // tostador" must not start the kitchen.
  const object = findObject(text);
  if (object) {
    const key = canonicalObject(object);
    const here = rooms.find((r) => r.key === current?.roomKey);
    const named = roomNamed(text, rooms);
    const candidates = [named, here, ...rooms].filter((r): r is JobRoom => Boolean(r));
    const room = candidates.find((r) => r.tasks.some((t) => t.taskKey === key));
    if (room) {
      const task = room.tasks.find((t) => t.taskKey === key)!;
      return { kind: 'room', roomKey: room.key, taskKey: key, label: `${task.label} · ${room.label}` };
    }
    // An object the walkthrough never saw has no prediction to learn from.
    return { kind: 'unknown', heard: raw };
  }

  const room = roomNamed(text, rooms);
  if (room) return { kind: 'room', roomKey: room.key, label: room.label };

  return { kind: 'unknown', heard: raw };
}

/** The room a sentence names, with "dos" picking the second of its kind. */
function roomNamed(text: string, rooms: JobRoom[]): JobRoom | null {
  const type = findRoomType(text);
  if (!type) return null;
  const ofType = rooms.filter((r) => r.type === type);
  if (ofType.length === 0) return null;
  const n = ordinalIn(text);
  if (n) return ofType[n - 1] ?? null;
  return ofType[0];
}
