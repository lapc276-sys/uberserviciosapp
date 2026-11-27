import { site } from './site';

/**
 * The software product's identity, which is not the cleaning company's.
 *
 * Two businesses share this codebase. `site` is the cleaning company that
 * works in Brooklyn; this is the quoting engine sold to other cleaning
 * companies — including, eventually, ones competing with that first business
 * three streets away.
 *
 * Keeping them apart is not tidiness. A cleaning company that signs up and
 * gets an email footed "sent by Klaudy" has just been told its new supplier is
 * its competitor, and the sensible reaction is to close the account. Every
 * surface a tenant sees reads from here instead.
 *
 * The name is an env var rather than a constant because it is not decided yet.
 * The fallback is deliberately plain: a placeholder that describes the thing is
 * recoverable, whereas quietly borrowing the cleaning brand is the exact
 * mistake this file exists to prevent.
 */
export const engine = {
  name: process.env.NEXT_PUBLIC_ENGINE_NAME?.trim() || 'Presupuesto AI',
  /** Where the product lives. Same deployment today, its own domain later. */
  url: process.env.NEXT_PUBLIC_ENGINE_URL?.trim() || site.url,
  /** Where a tenant writes when something breaks. Null hides the line. */
  supportEmail: process.env.ENGINE_SUPPORT_EMAIL?.trim() || null,
};
