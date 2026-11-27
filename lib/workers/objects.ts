/**
 * What a cleaner calls each catalogue object out loud, in both languages.
 *
 * The keys are OBJECT_TIME_COST keys (lib/vision/model.ts), so every object
 * that can be named can be set against a prediction. The first word of each
 * list is the label on screen. Matching is done on normalized text (no
 * accents, lower case), so "baño", "bano" and "Baño" are one word.
 *
 * Deliberately the objects somebody spends minutes on, not the whole
 * catalogue: nobody times the pictureframe, and a word list that includes
 * every noun in a house starts matching things that were not commands.
 */
export const OBJECT_WORDS: Record<string, string[]> = {
  // Kitchen
  oven: ['horno', 'oven'],
  stove: ['estufa', 'fogones', 'hornillas', 'quemadores', 'stove', 'burners'],
  cooktop: ['placa', 'vitroceramica', 'vitro', 'cooktop'],
  'range hood': ['campana', 'extractor', 'range hood', 'hood'],
  refrigerator: ['nevera', 'refrigerador', 'refrigeradora', 'refri', 'heladera', 'fridge', 'refrigerator'],
  freezer: ['congelador', 'freezer'],
  microwave: ['microondas', 'microwave'],
  dishwasher: ['lavavajillas', 'lavaplatos', 'dishwasher'],
  'toaster oven': ['horno tostador', 'toaster oven'],
  'air fryer': ['freidora', 'air fryer'],
  sink: ['fregadero', 'lavamanos', 'lavabo', 'tarja', 'sink'],
  backsplash: ['salpicadero', 'backsplash'],
  countertop: ['encimera', 'mesada', 'meson', 'tope', 'countertop', 'counters', 'counter'],
  cabinet: ['gabinetes', 'gabinete', 'alacena', 'cabinets', 'cabinet'],
  // Bathroom
  toilet: ['inodoro', 'poceta', 'excusado', 'wc', 'toilet'],
  shower: ['ducha', 'regadera', 'shower'],
  bathtub: ['banera', 'tina', 'bathtub', 'tub'],
  'shower door': ['mampara', 'shower door'],
  mirror: ['espejo', 'mirror'],
  // Anywhere
  window: ['ventanas', 'ventana', 'windows', 'window'],
  bed: ['cama', 'bed'],
  sofa: ['sofa', 'mueble', 'couch'],
  baseboard: ['zocalos', 'rodapies', 'baseboards', 'baseboard'],
  'ceiling fan': ['ventilador', 'ceiling fan'],
  'washing machine': ['lavadora', 'washing machine', 'washer'],
  dryer: ['secadora', 'dryer'],
};

/** "fridge" and "refrigerator" are one appliance: the key a timer uses. */
const SAME_AS: Record<string, string> = { fridge: 'refrigerator', couch: 'sofa' };

export function canonicalObject(key: string): string {
  return SAME_AS[key] ?? key;
}

const LABEL_OVERRIDE: Record<string, Record<string, string>> = {
  // The same catalogue object is a different word in a different room.
  sink: { bathroom: 'Lavamanos' },
};

const ACCENTED: Record<string, string> = {
  banera: 'Bañera',
  sofa: 'Sofá',
  zocalos: 'Zócalos',
  vitroceramica: 'Vitrocerámica',
};

/** How the object reads on screen, e.g. "Microondas", "Lavamanos". */
export function objectLabel(key: string, roomType?: string): string | null {
  const canonical = canonicalObject(key);
  const override = roomType ? LABEL_OVERRIDE[canonical]?.[roomType] : undefined;
  if (override) return override;
  const first = OBJECT_WORDS[canonical]?.[0];
  if (!first) return null;
  return ACCENTED[first] ?? first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * The object a sentence names, longest phrase first — "horno tostador" is the
 * toaster oven, not the oven.
 */
export function findObject(text: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const [key, words] of Object.entries(OBJECT_WORDS)) {
    for (const word of words) {
      if (!new RegExp(`(^|\\s)${word}(\\s|$)`).test(text)) continue;
      if (!best || word.length > best.length) best = { key, length: word.length };
    }
  }
  return best?.key ?? null;
}
