import { SOIL_DIMENSIONS, ROOM_TYPES, type SoilDimension, type RoomType } from './types';

/**
 * Voice command parsing for hands-free correction.
 *
 * Cleaners are wearing gloves with wet hands — touching a screen mid-job is
 * the worst possible interaction. Speaking "grasa ochenta" is not a gimmick
 * here, it's the difference between the data getting captured and not.
 *
 * Bilingual by necessity: the people doing this work in the US speak Spanish,
 * English, or both in the same sentence.
 */

export type VoiceCommand =
  | { kind: 'set'; dimension: SoilDimension; value: number; roomType?: RoomType }
  | { kind: 'measure'; sqft: number; roomType?: RoomType }
  | { kind: 'clearRoom'; roomType?: RoomType }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'remove' }
  | { kind: 'done' }
  | { kind: 'unknown'; heard: string };

/** Strips accents and punctuation so "baño" and "bano" both match. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Numbers ──────────────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  cero: 0, zero: 0,
  uno: 1, una: 1, one: 1,
  dos: 2, two: 2,
  tres: 3, three: 3,
  cuatro: 4, four: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  siete: 7, seven: 7,
  ocho: 8, eight: 8,
  nueve: 9, nine: 9,
  diez: 10, ten: 10,
  once: 11, eleven: 11,
  doce: 12, twelve: 12,
  trece: 13, thirteen: 13,
  catorce: 14, fourteen: 14,
  quince: 15, fifteen: 15,
  dieciseis: 16, sixteen: 16,
  diecisiete: 17, seventeen: 17,
  dieciocho: 18, eighteen: 18,
  diecinueve: 19, nineteen: 19,
};

const TENS: Record<string, number> = {
  veinte: 20, twenty: 20,
  treinta: 30, thirty: 30,
  cuarenta: 40, forty: 40,
  cincuenta: 50, fifty: 50,
  sesenta: 60, sixty: 60,
  setenta: 70, seventy: 70,
  ochenta: 80, eighty: 80,
  noventa: 90, ninety: 90,
};

// "veintitrés" style contractions, which speech recognition returns as one word.
const TWENTIES: Record<string, number> = {
  veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

const HUNDRED = ['cien', 'ciento', 'hundred', 'cienporciento'];

/**
 * Finds a 0–100 value anywhere in the phrase: digits, single words, or
 * compounds like "ochenta y cinco" / "eighty five".
 */
export function parseNumber(text: string): number | null {
  const words = normalize(text).split(' ');

  // Digits win — speech recognition usually returns them for clear numbers.
  for (const word of words) {
    const digits = word.match(/^(\d{1,3})$/);
    if (digits) {
      const n = Number(digits[1]);
      if (n >= 0 && n <= 100) return n;
    }
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (HUNDRED.includes(word)) return 100;
    if (TWENTIES[word] !== undefined) return TWENTIES[word];

    if (TENS[word] !== undefined) {
      const base = TENS[word];
      // "ochenta y cinco" / "eighty five"
      const nextWord = words[i + 1] === 'y' || words[i + 1] === 'and' ? words[i + 2] : words[i + 1];
      const unit = nextWord ? UNITS[nextWord] : undefined;
      if (unit !== undefined && unit < 10) return base + unit;
      return base;
    }

    if (UNITS[word] !== undefined) return UNITS[word];
  }

  return null;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Words that map to each soil dimension. Order matters: longest first. */
const DIMENSION_WORDS: Record<SoilDimension, string[]> = {
  grease: ['grasa', 'grasoso', 'grease', 'greasy', 'oil', 'aceite'],
  mold: ['moho', 'mold', 'mildew', 'hongo', 'hongos'],
  stains: ['manchas', 'mancha', 'stains', 'stain', 'sucio pegado'],
  clutter: ['desorden', 'desordenado', 'clutter', 'cluttered', 'reguero', 'cosas'],
  hair: ['pelo', 'pelos', 'cabello', 'hair', 'pet hair'],
  trash: ['basura', 'trash', 'garbage', 'residuos'],
  dust: ['polvo', 'dust', 'dusty', 'polvoriento'],
};

const ROOM_WORDS: Partial<Record<RoomType, string[]>> = {
  kitchen: ['cocina', 'kitchen'],
  bathroom: ['bano', 'banio', 'bathroom', 'restroom', 'poceta', 'toilet'],
  bedroom: ['cuarto', 'dormitorio', 'habitacion', 'recamara', 'bedroom'],
  living_room: ['sala', 'living', 'living room', 'estar'],
  dining_room: ['comedor', 'dining', 'dining room'],
  office: ['oficina', 'office', 'estudio'],
  laundry: ['lavanderia', 'laundry'],
  garage: ['garaje', 'garage', 'cochera'],
  stairs: ['escaleras', 'escalera', 'stairs'],
  hallway: ['pasillo', 'hallway', 'corridor'],
  patio: ['patio', 'terraza', 'balcon', 'balcony'],
};

const NEXT_WORDS = ['siguiente', 'proximo', 'proxima', 'next', 'adelante'];
const PREV_WORDS = ['anterior', 'atras', 'previous', 'back', 'regresa'];
const REMOVE_WORDS = ['borrar', 'eliminar', 'quitar', 'remove', 'delete', 'no existe'];
const DONE_WORDS = ['listo', 'terminado', 'terminar', 'done', 'finish', 'finished', 'continuar', 'continue'];
const CLEAR_WORDS = ['limpio', 'limpia', 'todo limpio', 'clean', 'all clean', 'perfecto', 'impecable'];

function findDimension(text: string): SoilDimension | null {
  for (const dim of SOIL_DIMENSIONS) {
    for (const word of DIMENSION_WORDS[dim]) {
      if (new RegExp(`\\b${word}\\b`).test(text)) return dim;
    }
  }
  return null;
}

function findRoom(text: string): RoomType | null {
  for (const type of ROOM_TYPES) {
    for (const word of ROOM_WORDS[type] ?? []) {
      if (new RegExp(`\\b${word}\\b`).test(text)) return type;
    }
  }
  return null;
}

function matchesAny(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(text));
}

/**
 * Interprets a spoken phrase.
 *
 * Examples that work:
 *   "grasa ochenta"            → set grease 80 on the current room
 *   "cocina moho 30"           → set mold 30 on the kitchen
 *   "kitchen grease eighty"    → same, in English
 *   "todo limpio"              → zero every dimension on the current room
 *   "siguiente"                → move to the next room
 */
/** Tokens that join two dimensions: "doce POR diez", "twelve BY ten". */
const BY_WORDS = ['por', 'by', 'x'];
/** Saying the unit is what switches to paces; bare numbers are read as feet. */
const PACE_WORDS = ['paso', 'pasos', 'pace', 'paces', 'step', 'steps'];

/**
 * Reads "doce por diez" into square feet.
 *
 * Feet is the default for a bare pair because that is how people describe
 * rooms out loud ("it's twelve by ten"). Paces have to be said explicitly:
 * silently guessing paces would inflate every room by 6x, and a wrong unit is
 * far worse here than a missing measurement, which the person can simply
 * repeat.
 */
export function parseDimensions(text: string): number | null {
  const words = normalize(text).split(' ');
  const at = words.findIndex((w) => BY_WORDS.includes(w));
  if (at <= 0 || at === words.length - 1) return null;

  const a = parseNumber(words.slice(0, at).join(' '));
  const b = parseNumber(words.slice(at + 1).join(' '));
  if (a === null || b === null || a <= 0 || b <= 0) return null;

  const factor = words.some((w) => PACE_WORDS.includes(w)) ? 2.5 : 1;
  const sqft = Math.round(a * factor * b * factor);

  // A room outside this range is a misheard number, not a room.
  return sqft >= 4 && sqft <= 5000 ? sqft : null;
}

export function parseVoiceCommand(raw: string): VoiceCommand {
  const text = normalize(raw);
  if (!text) return { kind: 'unknown', heard: raw };

  // Navigation and control first — these have no number and shouldn't be
  // mistaken for a value.
  if (matchesAny(text, REMOVE_WORDS)) return { kind: 'remove' };
  if (matchesAny(text, NEXT_WORDS)) return { kind: 'next' };
  if (matchesAny(text, PREV_WORDS)) return { kind: 'prev' };

  const dimension = findDimension(text);
  const roomType = findRoom(text) ?? undefined;

  // A measurement is two numbers joined by "por"/"by", and is checked before
  // the soil branch so "doce por diez" is never read as a severity score.
  const measured = parseDimensions(text);
  if (measured !== null && !dimension) {
    return { kind: 'measure', sqft: measured, roomType };
  }

  // "todo limpio" only counts when no specific dimension was named, so
  // "manchas limpio" doesn't wipe the whole room.
  if (!dimension && matchesAny(text, CLEAR_WORDS)) {
    return { kind: 'clearRoom', roomType };
  }

  if (matchesAny(text, DONE_WORDS)) return { kind: 'done' };

  if (dimension) {
    const value = parseNumber(text);
    if (value !== null) {
      return { kind: 'set', dimension, value: Math.max(0, Math.min(100, value)), roomType };
    }
  }

  return { kind: 'unknown', heard: raw };
}

/** Short spoken-style confirmation, for on-screen feedback. */
export function describeCommand(command: VoiceCommand, roomLabel?: string): string {
  switch (command.kind) {
    case 'set':
      return `${command.dimension} → ${command.value}${roomLabel ? ` · ${roomLabel}` : ''}`;
    case 'clearRoom':
      return `All clean${roomLabel ? ` · ${roomLabel}` : ''}`;
    case 'next':
      return 'Next room';
    case 'prev':
      return 'Previous room';
    case 'remove':
      return 'Room removed';
    case 'done':
      return 'Done correcting';
    case 'measure':
      return `${command.sqft} sq ft${roomLabel ? ` · ${roomLabel}` : ''}`;
    default:
      return `Didn’t catch that: “${command.heard}”`;
  }
}
