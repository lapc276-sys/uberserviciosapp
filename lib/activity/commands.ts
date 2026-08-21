import { normalize, findRoom } from '../vision/voice-commands';
import type { RoomType } from '../vision/types';

/**
 * Chat commands for logging how long each part of a job actually took.
 *
 * The pilot records one total per job, which is enough to know the model is
 * wrong and useless for knowing *where*. A job that ran 40 minutes long says
 * nothing about whether the kitchen or the bathroom caused it, and those are
 * separate constants needing separate corrections.
 *
 * Said out loud on the way into a room, this turns one labelled sample per
 * job into one per room — the cheapest multiplier available on a dataset that
 * currently has zero rows in it.
 *
 * Bilingual because the people holding the phone are, and forgiving of
 * phrasing because nobody consults a manual with wet gloves on.
 */

export type ActivityCommand =
  | { kind: 'startJob'; label?: string }
  | { kind: 'startRoom'; room: RoomType; task?: string }
  | { kind: 'endRoom' }
  | { kind: 'endJob' }
  | { kind: 'status' }
  | { kind: 'cancel' }
  | { kind: 'help' }
  | { kind: 'unknown'; heard: string };

const START_JOB = ['nuevo trabajo', 'empiezo trabajo', 'inicio trabajo', 'nueva casa', 'new job', 'start job'];
const END_JOB = ['fin del trabajo', 'fin trabajo', 'termine todo', 'termino todo', 'acabe todo', 'end job', 'finish job'];
const START_ROOM = ['empiezo', 'empezando', 'inicio', 'entrando', 'comienzo', 'start', 'starting'];
const END_ROOM = ['termino', 'termine', 'terminado', 'listo', 'acabado', 'done', 'finished', 'end'];
const STATUS = ['estado', 'status', 'como voy', 'donde estoy'];
const CANCEL = ['cancelar', 'cancela', 'cancel', 'olvidalo'];
const HELP = ['ayuda', 'help', 'comandos', '/start', '/help'];

function has(text: string, phrases: string[]): boolean {
  return phrases.some(
    (p) => text === p || text.startsWith(`${p} `) || text.includes(` ${p} `) || text.endsWith(` ${p}`),
  );
}

/**
 * Order matters here.
 *
 * "termino cocina" must read as ending a room, not starting one, and the
 * whole-job phrases have to be checked before the room ones because "termine
 * todo" contains "termine". Getting this backwards silently mislabels the
 * data, which is worse than refusing to parse at all.
 */
export function parseActivity(raw: string): ActivityCommand {
  const text = normalize(raw);
  if (!text) return { kind: 'unknown', heard: raw };

  if (has(text, HELP)) return { kind: 'help' };
  if (has(text, CANCEL)) return { kind: 'cancel' };
  if (has(text, STATUS)) return { kind: 'status' };

  if (has(text, END_JOB)) return { kind: 'endJob' };
  if (has(text, START_JOB)) {
    const label = raw.trim().split(/\s+/).slice(2).join(' ').trim();
    return { kind: 'startJob', label: label || undefined };
  }

  const room = findRoom(text);

  if (has(text, END_ROOM)) return { kind: 'endRoom' };

  if (has(text, START_ROOM)) {
    // "empiezo" with no room named is ambiguous between starting a job and
    // starting a room. It is read as the job: a stray open job is visible in
    // the next reply, while a room labelled with the wrong type is not.
    if (!room) return { kind: 'startJob' };
    return { kind: 'startRoom', room, task: extractTask(text, room) };
  }

  // A bare room name is the most natural thing to say walking in.
  if (room) return { kind: 'startRoom', room, task: extractTask(text, room) };

  return { kind: 'unknown', heard: raw };
}

/** Free-form detail after the room, e.g. "cocina el horno" → "cocina el horno". */
function extractTask(text: string, room: RoomType): string | undefined {
  const stripped = text
    .split(' ')
    .filter((w) => !START_ROOM.includes(w))
    .join(' ')
    .trim();
  return stripped.length > room.length + 4 ? stripped.slice(0, 80) : undefined;
}

export const HELP_TEXT = `Registro de tiempos. Habla o escribe:

• "nuevo trabajo" — abre un trabajo (puedes añadir un nombre)
• "cocina" — empieza a contar la cocina
• "baño el moho" — empieza el baño, con detalle
• "termino" — cierra la habitación actual
• "fin del trabajo" — cierra todo y te doy el resumen
• "estado" — qué hay abierto ahora
• "cancelar" — descarta lo abierto

Las notas de voz también valen.`;
