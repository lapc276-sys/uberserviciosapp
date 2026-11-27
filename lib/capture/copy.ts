import type { Lang } from './lang';

/**
 * Every word the walkthrough shows on screen, in both languages.
 *
 * One object per language with the same keys, so TypeScript refuses a string
 * that exists in one and not the other. A half-translated screen — English
 * buttons around a Spanish instruction — tells the customer nobody checked,
 * which is the last thing a page asking them to trust a price should say.
 *
 * What the bot SAYS lives next to the logic that decides to say it
 * (guide.ts, quality.ts, conversation.ts, upsell.ts, damage.ts), because the
 * tests that keep it from triggering itself read it from there.
 */

export interface CaptureCopy {
  // Language
  langQuestion: string;
  phoneLanguageNote: (language: string) => string;
  // Planning
  planTitle: string;
  planIntro: string;
  remove: (space: string) => string;
  add: (space: string) => string;
  planSummary: (steps: number, photos: number, minutes: number) => string;
  start: string;
  startShort: string;
  opening: string;
  pickOne: string;
  replayTitle: string;
  replayIntro: (steps: number) => string;
  // Camera
  denied: string;
  unsupported: string;
  retryCamera: string;
  reopenFailed: string;
  cameraNotReady: string;
  stepCounter: (space: string, n: number, total: number) => string;
  sweeping: string;
  settling: string;
  moving: string;
  waiting: string;
  sayReady: string;
  darkTorchNotice: string;
  darkNotice: string;
  takeNow: string;
  retakeThis: string;
  dontHave: string;
  skip: string;
  back: (title: string) => string;
  noSpeech: string;
  // Questions
  oneQuestion: string;
  someQuestions: string;
  answerAloud: string;
  heard: (text: string) => string;
  addsMinutes: (minutes: number) => string;
  yes: string;
  no: string;
  carryOn: string;
  unansweredStandard: string;
  // The room in the frames is not the room asked for (lib/capture/roomcheck.ts)
  /** `saw` is "una oficina" / "an office", or null for "not a home at all". */
  mismatchTitle: (saw: string | null) => string;
  mismatchBody: (space: string) => string;
  redoSpace: (label: string) => string;
  dropSpace: (label: string) => string;
  keepAnyway: string;
  lateMismatch: (saw: string | null) => string;
  redoPan: string;
  // Pointing at something missed
  missedButton: string;
  missedWhere: string;
  otherSpot: string;
  pointLooking: string;
  pointFound: (things: string) => string;
  pointUnknown: string;
  pointSaved: string;
  // Review
  reviewTitle: string;
  reviewIntro: string;
  skipped: (n: number) => string;
  noPhotos: string;
  continue: string;
  startOver: string;
  // Closing chat
  chatTitle: string;
  chatIntro: string;
  listening: string;
  whenQuestion: string;
  productsQuestion: string;
  toolsQuestion: string;
  dayLabel: string;
  unansweredLater: string;
  // Depth
  focusQuestion: string;
  focusHint: string;
  depthQuestion: string;
  depthIntro: string;
  depthVoiceHint: string;
  depth: Record<'house-cleaning' | 'deep-cleaning' | 'move-out-cleaning', { label: string; detail: string }>;
}

export const COPY: Record<Lang, CaptureCopy> = {
  es: {
    langQuestion: '¿En qué idioma prefieres que hablemos?',
    phoneLanguageNote: (language) => `Tu teléfono está en ${language}. Por ahora hablo español e inglés.`,
    planTitle: '¿Qué espacios vamos a ver?',
    planIntro: 'Te voy guiando uno por uno. Yo te digo a dónde apuntar y tomo la foto — tú solo caminas.',
    remove: (space) => `Quitar ${space}`,
    add: (space) => `Añadir ${space}`,
    planSummary: (steps, photos, minutes) =>
      `${steps} pasos · ${photos} fotos · unos ${minutes} min caminando. No tienes que pulsar nada: la cámara dispara sola.`,
    start: 'Empezar el recorrido',
    startShort: 'Empezar',
    opening: 'Abriendo la cámara…',
    pickOne: 'Elige al menos un espacio.',
    replayTitle: 'Repite el mismo recorrido',
    replayIntro: (steps) =>
      `Los mismos ${steps} pasos, en el mismo orden. Te voy guiando igual que antes — así cada foto del después se compara con la misma foto del antes.`,
    denied: 'No diste permiso a la cámara. Pulsa otra vez y acepta, o sube un vídeo que ya tengas.',
    unsupported: 'No pude abrir la cámara en este navegador.',
    retryCamera: 'Reintentar la cámara',
    reopenFailed: 'No pude volver a abrir la cámara.',
    cameraNotReady: 'La cámara todavía no está lista. Espera un segundo.',
    stepCounter: (space, n, total) => `${space} · ${n} de ${total}`,
    sweeping: 'Grabando el paneo…',
    settling: 'Quieto… tomando la foto',
    moving: 'Te veo, sujeta el teléfono quieto',
    waiting: 'Esperando a que apuntes',
    sayReady: 'di “listo”',
    darkTorchNotice: 'Está oscuro: encendí la linterna',
    darkNotice: 'Está muy oscuro: enciende la luz',
    takeNow: 'Tomar ya',
    retakeThis: 'Repetir esta foto',
    dontHave: 'No tengo',
    skip: 'Saltar',
    back: (title) => `Atrás — repetir “${title}”`,
    noSpeech: 'Este navegador no habla en voz alta — lee la instrucción de arriba.',
    oneQuestion: 'Antes de seguir, una pregunta sobre este espacio',
    someQuestions: 'Antes de seguir, unas preguntas sobre este espacio',
    answerAloud: 'Contesta en voz alta: “sí” o “no”',
    heard: (text) => `Te oí: “${text}”`,
    addsMinutes: (minutes) => `Añade unos ${minutes} min al trabajo`,
    yes: 'Sí',
    no: 'No',
    carryOn: 'Seguir',
    unansweredStandard: 'Lo que no contestes se queda como en una limpieza normal',
    mismatchTitle: (saw) => (saw ? `Esto parece ${saw}` : 'Esto parece estar fuera de una casa'),
    mismatchBody: (space) =>
      `Buscaba ${space}. Si te equivocaste de sitio, repítelo. Si aquí no hay, quítalo: lo que no veo, no lo cobro.`,
    redoSpace: (label) => `Repetir ${label.toLowerCase()}`,
    dropSpace: (label) => `Quitar ${label.toLowerCase()}`,
    keepAnyway: 'Dejarlo así',
    lateMismatch: (saw) => (saw ? `Esto no parece lo que pedí: parece ${saw}.` : 'Esto parece estar fuera de una casa.'),
    redoPan: 'Repetir la vista general',
    missedButton: '¿Me salté algo? Enséñamelo',
    missedWhere: '¿En qué espacio está?',
    otherSpot: 'Otro sitio',
    pointLooking: 'Mirando qué es…',
    pointFound: (things) => `Señalado: ${things}`,
    pointUnknown: 'No lo reconocí: escríbelo en la nota del final.',
    pointSaved: 'Guardado: se mira en el análisis.',
    reviewTitle: '¿Está todo?',
    reviewIntro: 'Esto es lo que tengo. Toca cualquier foto para repetirla, o añade un espacio que falte.',
    skipped: (n) => `Te saltaste ${n}:`,
    noPhotos: 'No se tomó ninguna foto. Repite el recorrido y pulsa “Tomar ya” en cada paso.',
    continue: 'Continuar',
    startOver: 'Falta un espacio entero — empezar de nuevo',
    chatTitle: 'Ya casi está',
    chatIntro: 'Tres preguntas rápidas para quien vaya a limpiar. Contesta en voz alta o tocando.',
    listening: 'Te escucho',
    whenQuestion: '¿Qué día te vendría bien?',
    productsQuestion: '¿Con qué productos limpiamos?',
    toolsQuestion: '¿Tienes aspiradora y trapeador que podamos usar?',
    dayLabel: 'Día de la limpieza',
    unansweredLater: 'Lo que no contestes lo hablas luego con la empresa.',
    focusQuestion: '¿Hay algo en lo que quieras que nos enfoquemos?',
    focusHint: 'Opcional. Por ejemplo: “las juntas de la ducha”, “la cocina sobre todo”, “tengo un perro y suelta mucho pelo”.',
    depthQuestion: '¿Qué tan a fondo lo quieres?',
    depthIntro: 'Lo mismo de sucio da precios distintos según hasta dónde quieras llegar.',
    depthVoiceHint: 'Puedes decir “por encima”, “a fondo” o “mudanza”',
    depth: {
      'house-cleaning': { label: 'Por encima', detail: 'Mantenimiento: polvo, suelos, baños y cocina por fuera.' },
      'deep-cleaning': {
        label: 'A fondo',
        detail: 'Todo lo anterior más hornos, dentro de electrodomésticos, juntas y rodapiés.',
      },
      'move-out-cleaning': {
        label: 'Mudanza / entrega',
        detail: 'Casa vacía, todo dentro y fuera de armarios, para entregar las llaves.',
      },
    },
  },
  en: {
    langQuestion: 'Which language would you like me to speak?',
    phoneLanguageNote: (language) => `Your phone is set to ${language}. For now I speak English and Spanish.`,
    planTitle: 'Which spaces are we looking at?',
    planIntro: 'I will guide you one at a time. I tell you where to point and I take the picture — you just walk.',
    remove: (space) => `Remove ${space}`,
    add: (space) => `Add ${space}`,
    planSummary: (steps, photos, minutes) =>
      `${steps} steps · ${photos} pictures · about ${minutes} min of walking. You don't have to press anything: the camera takes them by itself.`,
    start: 'Start the walkthrough',
    startShort: 'Start',
    opening: 'Opening the camera…',
    pickOne: 'Pick at least one space.',
    replayTitle: 'Repeat the same walkthrough',
    replayIntro: (steps) =>
      `The same ${steps} steps, in the same order. I will guide you just like before — so every "after" picture is compared with the same "before" picture.`,
    denied: 'You did not allow the camera. Tap again and accept, or upload a video you already have.',
    unsupported: 'I could not open the camera in this browser.',
    retryCamera: 'Try the camera again',
    reopenFailed: 'I could not reopen the camera.',
    cameraNotReady: 'The camera is not ready yet. Give it a second.',
    stepCounter: (space, n, total) => `${space} · ${n} of ${total}`,
    sweeping: 'Recording the sweep…',
    settling: 'Hold still… taking it',
    moving: 'I can see you — hold the phone still',
    waiting: 'Waiting for you to aim',
    sayReady: 'say “ready”',
    darkTorchNotice: 'It is dark: I turned on the flashlight',
    darkNotice: 'It is very dark: turn on the light',
    takeNow: 'Take it now',
    retakeThis: 'Retake this one',
    dontHave: 'I don’t have one',
    skip: 'Skip',
    back: (title) => `Back — redo “${title}”`,
    noSpeech: 'This browser cannot speak out loud — read the instruction above.',
    oneQuestion: 'Before we move on, one question about this space',
    someQuestions: 'Before we move on, a few questions about this space',
    answerAloud: 'Answer out loud: “yes” or “no”',
    heard: (text) => `I heard: “${text}”`,
    addsMinutes: (minutes) => `Adds about ${minutes} min to the job`,
    yes: 'Yes',
    no: 'No',
    carryOn: 'Continue',
    unansweredStandard: 'Anything you leave unanswered stays as in a standard clean',
    mismatchTitle: (saw) => (saw ? `This looks like ${saw}` : 'This looks like it is outside a home'),
    mismatchBody: (space) =>
      `I was looking for ${space}. If you were in the wrong spot, film it again. If there isn't one here, remove it: I don't charge for what I can't see.`,
    redoSpace: (label) => `Film the ${label.toLowerCase()} again`,
    dropSpace: (label) => `Remove the ${label.toLowerCase()}`,
    keepAnyway: 'Keep it anyway',
    lateMismatch: (saw) => (saw ? `This doesn't look like what I asked for: it looks like ${saw}.` : 'This looks like it is outside a home.'),
    redoPan: 'Film the overview again',
    missedButton: 'Did I miss something? Show me',
    missedWhere: 'Which space is it in?',
    otherSpot: 'Another spot',
    pointLooking: 'Looking at what it is…',
    pointFound: (things) => `Pointed out: ${things}`,
    pointUnknown: "I didn't recognise it: write it in the note at the end.",
    pointSaved: 'Saved: it is looked at in the analysis.',
    reviewTitle: 'Is that everything?',
    reviewIntro: 'This is what I have. Tap any picture to retake it, or add a space that is missing.',
    skipped: (n) => `You skipped ${n}:`,
    noPhotos: 'No pictures were taken. Redo the walkthrough and press “Take it now” at each step.',
    continue: 'Continue',
    startOver: 'A whole space is missing — start over',
    chatTitle: 'Almost done',
    chatIntro: 'Three quick questions for whoever comes to clean. Answer out loud or by tapping.',
    listening: 'I am listening',
    whenQuestion: 'What day works for you?',
    productsQuestion: 'What products should we use?',
    toolsQuestion: 'Do you have a vacuum and a mop we can use?',
    dayLabel: 'Cleaning day',
    unansweredLater: 'Anything you skip, you can sort out with the company later.',
    focusQuestion: 'Is there anything you want us to focus on?',
    focusHint: 'Optional. For example: “the shower grout”, “mostly the kitchen”, “I have a dog that sheds a lot”.',
    depthQuestion: 'How thorough do you want it?',
    depthIntro: 'The same mess costs different amounts depending on how far you want to go.',
    depthVoiceHint: 'You can say “standard”, “deep” or “move-out”',
    depth: {
      'house-cleaning': { label: 'Standard', detail: 'Upkeep: dust, floors, bathrooms and the outside of the kitchen.' },
      'deep-cleaning': {
        label: 'Deep',
        detail: 'Everything above plus ovens, inside the appliances, grout and baseboards.',
      },
      'move-out-cleaning': {
        label: 'Move-out',
        detail: 'Empty home, inside and outside every cabinet, ready to hand back the keys.',
      },
    },
  },
};
