import type { PropertyAnalysis, RoomType } from '../vision/types';
import { countCapFor, depthChoiceFor, objectMinutesFor, isDeepService, type DepthChoices } from '../vision/model';
import { askedObjects, taskFor } from '../vision/upsell';

/**
 * The job as the timer sees it: the rooms the walkthrough filmed, each with
 * what the engine predicted for it, and the paid extras worth timing apart.
 *
 * This is what turns a stopwatch into training data. A segment that only says
 * "kitchen, 46 min" can be compared with every other kitchen; a segment that
 * says "kitchen-1, 46 min, predicted 40" can be compared with *this* kitchen,
 * whose grease and clutter are already inside the 40. That ratio is what the
 * pace model learns from (lib/workers/pace.ts).
 *
 * Predictions are read here, on the server, from the stored analysis — never
 * taken from the phone. A predicted figure the client could set is a ratio
 * the client could set.
 */

export interface JobExtra {
  /** Catalogue object, e.g. "oven". */
  taskKey: string;
  depth: 'deep';
  /** The crew's wording, the same sentence the customer was asked. */
  label: string;
  predictedMinutes: number;
}

export interface JobRoom {
  /** Stable within the job: "kitchen-1", "bathroom-2". */
  key: string;
  type: RoomType;
  label: string;
  /** The engine's minutes for the whole room, extras included. */
  predictedMinutes: number;
  extras: JobExtra[];
}

/** Room labels for the timer, in Spanish like the rest of the crew screens. */
const ROOM_ES: Record<RoomType, string> = {
  kitchen: 'Cocina',
  bathroom: 'Baño',
  bedroom: 'Habitación',
  living_room: 'Sala',
  dining_room: 'Comedor',
  office: 'Oficina',
  laundry: 'Lavadero',
  garage: 'Garaje',
  stairs: 'Escaleras',
  hallway: 'Pasillo',
  patio: 'Patio',
  other: 'Otro espacio',
};

/**
 * Only the objects a customer can be asked about are extras. Those are where
 * the money is in doubt — a yes to the oven adds minutes to someone's bill
 * that today are a hypothesis — and timing them is what tests it. Timing the
 * toaster as well would be eight taps per kitchen, and a timer that asks for
 * eight taps stops being used by the third job.
 */
const EXTRA_OBJECTS = new Set(askedObjects('es'));

/** Keys and labels for the rooms of an analysis, in walkthrough order. */
export function jobRooms(
  analysis: Pick<PropertyAnalysis, 'rooms'> & { depthChoices?: DepthChoices },
  serviceSlug: string,
): JobRoom[] {
  const seen = new Map<string, number>();
  const ofType = new Map<string, number>();
  for (const room of analysis.rooms) ofType.set(room.type, (ofType.get(room.type) ?? 0) + 1);

  return analysis.rooms.map((room) => {
    const n = (seen.get(room.type) ?? 0) + 1;
    seen.set(room.type, n);
    const base = ROOM_ES[room.type] ?? ROOM_ES.other;

    const extras: JobExtra[] = [];
    const named = new Set<string>();
    for (const obj of room.objects) {
      const key = obj.name.trim().toLowerCase();
      if (!EXTRA_OBJECTS.has(key)) continue;
      const depth = depthChoiceFor(key, room.type, analysis.depthChoices) ?? (isDeepService(serviceSlug) ? 'deep' : 'surface');
      if (depth !== 'deep') continue;
      const label = taskFor(key, room.type);
      // "fridge" and "refrigerator" are one appliance and one button.
      if (!label || named.has(label)) continue;
      named.add(label);
      const count = Math.max(1, Math.min(obj.count || 1, countCapFor(key)));
      extras.push({
        taskKey: key,
        depth: 'deep',
        label,
        predictedMinutes: round1(objectMinutesFor(key, serviceSlug, 'deep') * count),
      });
    }

    return {
      key: `${room.type}-${n}`,
      type: room.type,
      label: (ofType.get(room.type) ?? 0) > 1 ? `${base} ${n}` : base,
      predictedMinutes: round1(room.estimatedMinutes),
      extras,
    };
  });
}

/** The room a key names, or null — a key from the phone is checked, not trusted. */
export function findRoom(rooms: JobRoom[], key: string | undefined): JobRoom | null {
  return rooms.find((r) => r.key === key) ?? null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
