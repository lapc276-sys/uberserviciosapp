import type { RoomType } from '@/lib/vision/types';

/**
 * The small jobs nobody asked for.
 *
 * A cleaner standing in a kitchen can see a dozen things worth five minutes
 * that were not in the quote: the outside of the bin, the fridge handles, the
 * skirting they are already kneeling next to. Doing one and showing the
 * customer costs almost nothing and is the difference between a job that was
 * completed and a job somebody tips for.
 *
 * The whole design turns on one distinction, because getting it wrong is
 * expensive in a way the upside never covers:
 *
 *   unprompted  Wiping an accessible surface. Nothing opens, nothing moves,
 *               nothing can break. Do it, photograph it, put it in the report.
 *
 *   ask_first   Opening equipment, aggressive chemicals, working at height, or
 *               handling someone's belongings. Offer it and price it. Never do
 *               it because it seemed helpful.
 *
 * An air-conditioner filter is the case that makes the rule concrete. It reads
 * as a two-minute favour, and it is — until a clip snaps or a fin bends, and an
 * eight-dollar filter becomes a four-hundred-dollar repair, an argument about
 * who authorised it, and a customer gone. Offering it instead turns exactly the
 * same observation into revenue.
 */

export type ExtraConsent = 'unprompted' | 'ask_first';

export interface ExtraTask {
  id: string;
  /** Shown to the worker, in Spanish. */
  label: string;
  /** Said out loud when suggested mid-job. */
  spoken: string;
  consent: ExtraConsent;
  /** Typical minutes. Feeds the estimate when the customer accepts an offer. */
  minutes: number;
  /** Suggested add-on price, for `ask_first` items. */
  price?: number;
  /** Where it makes sense. Empty means anywhere. */
  rooms: RoomType[];
  /**
   * Object names (as the analyzer reports them) that make this worth
   * suggesting. Empty means suggest on room type alone.
   */
  triggers: string[];
  /** Why it needs consent, or why it is safe without. Shown in the admin. */
  note: string;
}

export const EXTRA_TASKS: ExtraTask[] = [
  // ── Safe to do and show ───────────────────────────────────────────────────
  {
    id: 'bin-outside',
    label: 'Bote de basura por fuera',
    spoken: 'Si te queda un minuto, pasa un paño por fuera del bote de basura.',
    consent: 'unprompted',
    minutes: 3,
    rooms: ['kitchen'],
    triggers: ['trash can', 'recycling bin'],
    note: 'Superficie accesible, no se abre nada. Casi siempre está sucio y casi nadie lo pide.',
  },
  {
    id: 'fridge-handles',
    label: 'Manijas y frente de la nevera',
    spoken: 'Las manijas de la nevera suelen quedar marcadas. Un repaso rápido.',
    consent: 'unprompted',
    minutes: 2,
    rooms: ['kitchen'],
    triggers: ['refrigerator', 'fridge'],
    note: 'Lo primero que toca el cliente al llegar. Muy visible por muy poco tiempo.',
  },
  {
    id: 'switch-plates',
    label: 'Interruptores y manijas de puerta',
    spoken: 'Pasa el paño por los interruptores y las manijas de las puertas.',
    consent: 'unprompted',
    minutes: 3,
    rooms: [],
    triggers: [],
    note: 'Alto contacto, casi nunca en el presupuesto, se nota al tacto.',
  },
  {
    id: 'baseboards-here',
    label: 'Rodapiés de esta habitación',
    spoken: 'Ya que estás abajo, dale a los rodapiés de esta habitación.',
    consent: 'unprompted',
    minutes: 5,
    rooms: [],
    triggers: ['baseboard'],
    note: 'Sale casi gratis mientras ya se está trabajando el suelo.',
  },
  {
    id: 'mirror-streaks',
    label: 'Repasar espejo sin marcas',
    spoken: 'Revisa el espejo a contraluz — las marcas solo se ven de lado.',
    consent: 'unprompted',
    minutes: 2,
    rooms: ['bathroom'],
    triggers: ['mirror'],
    note: 'Un espejo con marcas hace que todo el baño parezca mal limpiado.',
  },

  // ── Offer, price, never assume ────────────────────────────────────────────
  {
    id: 'ac-filter',
    label: 'Filtros del aire acondicionado',
    spoken: 'Los filtros del aire se ven sucios. Ofrécelo antes de tocarlos.',
    consent: 'ask_first',
    minutes: 15,
    price: 15,
    rooms: [],
    triggers: ['air vent', 'radiator'],
    note: 'Hay que abrir un equipo ajeno. Un clip roto o una aleta doblada es una reparación, no una queja.',
  },
  {
    id: 'oven-inside',
    label: 'Horno por dentro',
    spoken: 'El horno por dentro no entra en este servicio. Pregunta si lo quieren.',
    consent: 'ask_first',
    minutes: 30,
    price: 35,
    rooms: ['kitchen'],
    triggers: ['oven'],
    note: 'Media hora y desengrasante fuerte. Regalarlo se come el margen del trabajo entero.',
  },
  {
    id: 'inside-cabinets',
    label: 'Dentro de armarios y gabinetes',
    spoken: 'Para limpiar dentro de los gabinetes hay que mover sus cosas. Pregunta primero.',
    consent: 'ask_first',
    minutes: 25,
    price: 30,
    rooms: ['kitchen', 'bedroom'],
    triggers: ['cabinet', 'pantry', 'wardrobe', 'closet'],
    note: 'Mover pertenencias ajenas sin permiso genera reclamos por cosas movidas o perdidas.',
  },
  {
    id: 'windows-outside',
    label: 'Ventanas por fuera',
    spoken: 'Las ventanas por fuera se cotizan aparte. No te subas a nada.',
    consent: 'ask_first',
    minutes: 20,
    price: 25,
    rooms: [],
    triggers: ['window', 'balcony'],
    note: 'Altura. Ninguna propina paga una caída, y el seguro pregunta si estaba autorizado.',
  },
  {
    id: 'shower-descale',
    label: 'Quitar sarro de la ducha',
    spoken: 'Hay sarro en la ducha. Quitarlo lleva producto especial — ofrécelo.',
    consent: 'ask_first',
    minutes: 20,
    price: 20,
    rooms: ['bathroom'],
    triggers: ['shower', 'bathtub', 'faucet'],
    note: 'Los ácidos marcan cromados y piedra natural. Con permiso, y avisando del riesgo.',
  },
];

export const EXTRAS_BY_ID = new Map(EXTRA_TASKS.map((t) => [t.id, t]));

export interface RoomLike {
  type: RoomType;
  objects: { name: string }[];
  soil: Record<string, number>;
}

/**
 * Picks the extras worth raising for one room.
 *
 * Suggestions are capped hard. A list of ten is a list nobody reads, and a
 * worker who learns to dismiss the panel stops seeing the one suggestion that
 * mattered. Three is about what somebody will actually act on.
 */
export function suggestExtras(room: RoomLike, limit = 3): ExtraTask[] {
  const names = new Set(room.objects.map((o) => o.name.trim().toLowerCase()));

  const relevant = EXTRA_TASKS.filter((task) => {
    const roomOk = task.rooms.length === 0 || task.rooms.includes(room.type);
    const objectOk = task.triggers.length === 0 || task.triggers.some((t) => names.has(t));
    return roomOk && objectOk;
  });

  // Unprompted first: those can be done right now, and a suggestion that needs
  // a phone call is worth less to somebody standing in the room with a cloth.
  return relevant
    .sort((a, b) => (a.consent === b.consent ? a.minutes - b.minutes : a.consent === 'unprompted' ? -1 : 1))
    .slice(0, limit);
}

/** Minutes and price a set of accepted offers adds to a job. */
export function priceExtras(ids: string[]): { minutes: number; price: number } {
  return ids.reduce(
    (acc, id) => {
      const task = EXTRAS_BY_ID.get(id);
      if (!task) return acc;
      return { minutes: acc.minutes + task.minutes, price: acc.price + (task.price ?? 0) };
    },
    { minutes: 0, price: 0 },
  );
}
