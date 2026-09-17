import { site } from '@/lib/config/site';

/**
 * The three ways a customer can reach a one-person cleaning business.
 *
 * Ordered by how fast they actually produce a job, which is not the order a
 * website usually puts them in. A form is the slowest: it converts a customer
 * who was ready to book into an email you answer hours later, by which point
 * they have called somebody else. WhatsApp is the fastest, and in a market
 * like Brooklyn it is where most Spanish-speaking customers already are.
 *
 * All three are env-gated. A tel: link to a number that does not exist, or a
 * wa.me link to nobody, is worse than no button at all — it reads as broken to
 * exactly the person who was about to pay you.
 */

/**
 * WhatsApp's link format is unforgiving and fails quietly.
 *
 * wa.me wants digits only: a plus sign, a space or a dash gives a page that
 * loads and says the number is invalid, which looks like the business is gone
 * rather than like a formatting mistake. The number is stripped to digits when
 * it is read from the environment, so this only has to build the URL.
 */
export function whatsappLink(message?: string): string | null {
  if (!site.whatsapp) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${site.whatsapp}${text}`;
}

export function telLink(): string | null {
  if (!site.phone) return null;
  // tel: tolerates formatting far better than wa.me, but stripping is still
  // the safe move for older Android dialers.
  return `tel:${site.phone.replace(/[^\d+]/g, '')}`;
}

export function smsLink(message?: string): string | null {
  if (!site.phone) return null;
  const body = message ? `?&body=${encodeURIComponent(message)}` : '';
  return `sms:${site.phone.replace(/[^\d+]/g, '')}${body}`;
}

/**
 * The opening line a customer sends, pre-filled.
 *
 * Pre-filling matters more than it looks. The hardest part of messaging a
 * stranger about your dirty apartment is writing the first sentence; handing
 * someone that sentence is the difference between a tap and a closed tab.
 */
export const OPENERS = {
  es: 'Hola, vi tu página y quiero limpieza en Brooklyn. ¿Tienes disponibilidad?',
  en: 'Hi, I found your page and I need cleaning in Brooklyn. Do you have availability?',
} as const;

/** True when at least one direct channel is configured. */
export function hasDirectContact(): boolean {
  return Boolean(site.whatsapp || site.phone);
}
