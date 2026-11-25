import type { RoomType } from '../vision/types';
import type { Lang } from './lang';

/**
 * What the bot says when the room it asked for is not the room in front of
 * the camera, and when the customer points at something it missed.
 *
 * Both exist because of one test drive: a phone panned around the inside of a
 * car, asked for the kitchen, said "I can see the microwave". The model had
 * been told the room was a kitchen and found one. Now it is asked what the
 * room IS first (lib/vision/scout.ts), and when the answer is "a car" or "an
 * office", the walkthrough says so out loud and lets the person re-film the
 * room or drop it — instead of pricing a kitchen nobody filmed, in front of
 * the investor who asked to try it.
 *
 * Every line here is heard by the same microphone that listens for answers,
 * so none of them may contain a yes, a no, "listo", "foto" or "siguiente" —
 * tests/room-check.test.ts runs every variant through every parser.
 */

const THE_ES: Record<RoomType, string> = {
  kitchen: 'la cocina',
  bathroom: 'el baño',
  bedroom: 'la habitación',
  living_room: 'la sala',
  dining_room: 'el comedor',
  office: 'la oficina',
  laundry: 'el lavadero',
  garage: 'el garaje',
  stairs: 'la escalera',
  hallway: 'el pasillo',
  patio: 'el patio',
  other: 'ese espacio',
};

const THE_EN: Record<RoomType, string> = {
  kitchen: 'the kitchen',
  bathroom: 'the bathroom',
  bedroom: 'the bedroom',
  living_room: 'the living room',
  dining_room: 'the dining room',
  office: 'the office',
  laundry: 'the laundry room',
  garage: 'the garage',
  stairs: 'the staircase',
  hallway: 'the hallway',
  patio: 'the patio',
  other: 'that space',
};

const A_ES: Record<RoomType, string> = {
  kitchen: 'una cocina',
  bathroom: 'un baño',
  bedroom: 'una habitación',
  living_room: 'una sala',
  dining_room: 'un comedor',
  office: 'una oficina',
  laundry: 'un lavadero',
  garage: 'un garaje',
  stairs: 'una escalera',
  hallway: 'un pasillo',
  patio: 'un patio',
  other: 'otro espacio',
};

const A_EN: Record<RoomType, string> = {
  kitchen: 'a kitchen',
  bathroom: 'a bathroom',
  bedroom: 'a bedroom',
  living_room: 'a living room',
  dining_room: 'a dining room',
  office: 'an office',
  laundry: 'a laundry room',
  garage: 'a garage',
  stairs: 'a staircase',
  hallway: 'a hallway',
  patio: 'a patio',
  other: 'another space',
};

/** "la cocina", "el baño 2" — a space spoken with its article. */
export function theSpace(roomType: RoomType, spaceLabel: string, lang: Lang): string {
  const n = spaceLabel.match(/\s(\d+)$/)?.[1];
  const base = (lang === 'en' ? THE_EN : THE_ES)[roomType] ?? (lang === 'en' ? THE_EN.other : THE_ES.other);
  return n && roomType !== 'other' ? `${base} ${n}` : base;
}

/** "una oficina", "an office" — what was seen instead. */
export function aRoom(saw: RoomType, lang: Lang): string {
  return (lang === 'en' ? A_EN : A_ES)[saw];
}

/** The caption of a pointed frame. Spanish, like every caption the model reads. */
export const POINTED_TITLE = 'Algo que faltaba, señalado por el cliente';
export const POINTED_TITLE_EN = 'Something I missed, pointed out';

export const SAY_ROOM_CHECK: Record<
  Lang,
  {
    /** Said as the room is left, when the pan was not that room. */
    mismatch: (saw: RoomType | 'none', space: string) => string;
    /** The pointing step's instruction. */
    point: string;
    /** Said as the pointed frame is taken. */
    pointAfter: string;
    /** What it recognised in the pointed frame: "la lavadora". */
    found: (things: string) => string;
    /** Looked, and could not tell what it was. */
    unknown: string;
  }
> = {
  es: {
    mismatch: (saw, space) =>
      saw === 'none'
        ? `Esto parece estar fuera de una casa, y yo buscaba ${space}.`
        : `Esto parece ${A_ES[saw]}, y yo buscaba ${space}.`,
    point: 'Apunta a lo que me faltó y quédate quieto.',
    pointAfter: 'Hecho; ahora miro qué es.',
    found: (things) => `Veo ${things}. Lo añado.`,
    unknown: 'Lo veo, pero me cuesta saber qué es. Escríbelo en la nota del final.',
  },
  en: {
    mismatch: (saw, space) =>
      saw === 'none'
        ? `This looks like it is outside a home, and I was looking for ${space}.`
        : `This looks like ${A_EN[saw]}, and I was looking for ${space}.`,
    point: 'Point at what I missed and hold still.',
    pointAfter: 'Got it; let me see what it is.',
    found: (things) => `I can see ${things}. Adding it.`,
    unknown: "I can see it, but I can't tell what it is. Write it in the note at the end.",
  },
};
