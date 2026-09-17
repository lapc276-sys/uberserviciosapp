/**
 * Two languages, no framework.
 *
 * Brooklyn is why this exists: a large Spanish-speaking customer base and a
 * large English-speaking one, often in the same building. Serving only one
 * leaves money on the table, and machine-translating the other reads as a
 * business that is not really local.
 *
 * Deliberately a plain object rather than next-intl or similar. The whole
 * surface is one landing page and a handful of labels, and the failure mode of
 * a real i18n library is the one that matters here: a missing key falls back
 * silently to the default locale, so an untranslated string ships and nobody
 * notices. `Copy` is a type, so a missing Spanish string is a build error.
 */

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * English first.
 *
 * The customer base in this market is roughly nine in ten English speakers, so
 * the default is the one most visitors never have to change. Spanish stays a
 * single tap away rather than behind a separate URL — a customer who needs it
 * needs it immediately, and a page that opens in the wrong language has
 * already lost most of them before any switch is found.
 */
export const DEFAULT_LOCALE: Locale = 'en';

export interface Copy {
  navServices: string;
  navHow: string;
  navQuote: string;
  navContact: string;

  heroBadge: string;
  heroTitle: string;
  heroSub: string;
  heroCtaQuote: string;
  heroCtaWhatsapp: string;
  heroNote: string;

  servicesTitle: string;
  servicesSub: string;
  from: string;

  howTitle: string;
  howSub: string;
  how1Title: string;
  how1Body: string;
  how2Title: string;
  how2Body: string;
  how3Title: string;
  how3Body: string;

  calcTitle: string;
  calcSub: string;
  calcHouse: string;
  calcApartment: string;
  calcBedrooms: string;
  calcBathrooms: string;
  calcService: string;
  calcResult: string;
  calcTax: string;
  calcBook: string;
  calcDisclaimer: string;

  quoteTitle: string;
  quoteSub: string;
  quoteNote: string;
  quoteToggle: string;
  quoteWhy: string;

  contactTitle: string;
  contactSub: string;
  contactWhatsapp: string;
  contactCall: string;
  contactFormName: string;
  contactFormPhone: string;
  contactFormMessage: string;
  contactFormSend: string;
  contactFormSent: string;
  contactFormError: string;

  areaTitle: string;
  areaBody: string;

  langSwitch: string;
}

export const COPY: Record<Locale, Copy> = {
  es: {
    navServices: 'Servicios',
    navHow: 'Cómo funciona',
    navQuote: 'Precio al instante',
    navContact: 'Contacto',

    heroBadge: 'Brooklyn, NY',
    heroTitle: 'Limpieza en Brooklyn, con precio al instante',
    heroSub:
      'Graba tu casa con el móvil siguiendo las instrucciones y recibes el precio al momento. Sin visita previa, sin esperar presupuesto, sin descargar nada.',
    heroCtaQuote: 'Calcular mi precio',
    heroCtaWhatsapp: 'Escríbeme por WhatsApp',
    heroNote: 'Se habla español y English',

    servicesTitle: 'Qué hacemos',
    servicesSub: 'Casas, apartamentos y locales en Brooklyn.',
    from: 'Desde',

    howTitle: 'Cómo funciona',
    howSub: 'Tres pasos. El primero dura dos minutos.',
    how1Title: 'Graba el recorrido',
    how1Body:
      'La app te va diciendo a dónde apuntar —encimeras, baño, dentro del microondas— y toma las fotos sola. Tú solo caminas.',
    how2Title: 'Recibe el precio',
    how2Body:
      'Verás cuánto cuesta, cuánto tiempo lleva y cuántas personas hacen falta. Al momento, no en dos días.',
    how3Title: 'Agenda y listo',
    how3Body:
      'Si te cuadra, elegimos día y hora. Llego con todo lo necesario y te dejo fotos del antes y el después.',

    calcTitle: 'Calcula tu precio',
    calcSub: 'Dime el tamaño y te doy el precio ahora mismo.',
    calcHouse: 'Casa',
    calcApartment: 'Apartamento',
    calcBedrooms: 'Habitaciones',
    calcBathrooms: 'Baños',
    calcService: 'Tipo de limpieza',
    calcResult: 'Tu precio',
    calcTax: 'impuesto incluido',
    calcBook: 'Agendar por WhatsApp',
    calcDisclaimer: 'Precio estimado. Se confirma al ver el sitio o con el recorrido en vídeo.',

    quoteTitle: 'Pruébalo ahora mismo',
    quoteSub:
      'Esto es lo mismo que usan mis clientes. Funciona en el navegador, no hay que instalar nada.',
    quoteNote:
      'Las fotos salen de tu cámara directo al cálculo. No se sube ningún vídeo ni se guarda nada en tu galería.',
    quoteToggle: '¿Quieres un precio más exacto? Usa la cámara',
    quoteWhy:
      'El recorrido en vídeo ve la suciedad real, no solo el tamaño. Suele dar un precio más justo — para los dos.',

    contactTitle: 'Hablemos',
    contactSub: 'Respondo rápido. Si estoy trabajando, te contesto al terminar.',
    contactWhatsapp: 'WhatsApp',
    contactCall: 'Llamar',
    contactFormName: 'Tu nombre',
    contactFormPhone: 'Teléfono o email',
    contactFormMessage: 'Cuéntame qué necesitas',
    contactFormSend: 'Enviar',
    contactFormSent: 'Recibido. Te contacto muy pronto.',
    contactFormError: 'No se pudo enviar. Prueba por WhatsApp.',

    areaTitle: 'Zona de servicio',
    areaBody:
      'Brooklyn. Si estás justo al lado, pregúntame igual — a veces se puede.',

    langSwitch: 'English',
  },

  en: {
    navServices: 'Services',
    navHow: 'How it works',
    navQuote: 'Instant price',
    navContact: 'Contact',

    heroBadge: 'Brooklyn, NY',
    heroTitle: 'Cleaning in Brooklyn, priced on the spot',
    heroSub:
      'Walk through your place with your phone while the app tells you where to point. You get the price immediately — no site visit, no waiting on a quote, nothing to install.',
    heroCtaQuote: 'Get my price',
    heroCtaWhatsapp: 'Message me on WhatsApp',
    heroNote: 'English and Spanish spoken',

    servicesTitle: 'What I do',
    servicesSub: 'Homes, apartments and small commercial spaces in Brooklyn.',
    from: 'From',

    howTitle: 'How it works',
    howSub: 'Three steps. The first one takes two minutes.',
    how1Title: 'Record the walkthrough',
    how1Body:
      'The app tells you what to point at — counters, bathroom, inside the microwave — and takes each photo itself. You just walk.',
    how2Title: 'Get the price',
    how2Body:
      'You see the cost, how long it takes and how many people it needs. Right away, not in two days.',
    how3Title: 'Book it',
    how3Body:
      'If it works for you, we pick a day and time. I arrive with everything needed and leave you before-and-after photos.',

    calcTitle: 'Get your price',
    calcSub: 'Tell me the size and I will price it right now.',
    calcHouse: 'House',
    calcApartment: 'Apartment',
    calcBedrooms: 'Bedrooms',
    calcBathrooms: 'Bathrooms',
    calcService: 'Type of clean',
    calcResult: 'Your price',
    calcTax: 'tax included',
    calcBook: 'Book on WhatsApp',
    calcDisclaimer: 'Estimate. Confirmed once I see the place, or with the video walkthrough.',

    quoteTitle: 'Try it right now',
    quoteSub: 'This is the same tool my customers use. It runs in your browser — nothing to install.',
    quoteNote:
      'Photos go straight from your camera into the estimate. No video is uploaded and nothing is saved to your gallery.',
    quoteToggle: 'Want a more exact price? Use your camera',
    quoteWhy:
      'The video walkthrough sees how dirty it actually is, not just how big. It usually lands on a fairer price — for both of us.',

    contactTitle: 'Get in touch',
    contactSub: 'I answer fast. If I am on a job, I get back to you as soon as I finish.',
    contactWhatsapp: 'WhatsApp',
    contactCall: 'Call',
    contactFormName: 'Your name',
    contactFormPhone: 'Phone or email',
    contactFormMessage: 'Tell me what you need',
    contactFormSend: 'Send',
    contactFormSent: 'Got it. I will be in touch shortly.',
    contactFormError: 'That did not send. Try WhatsApp instead.',

    areaTitle: 'Service area',
    areaBody: 'Brooklyn. If you are right on the edge, ask anyway — sometimes it works out.',

    langSwitch: 'Español',
  },
};

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}
