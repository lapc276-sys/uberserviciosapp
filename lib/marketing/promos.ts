/**
 * Promo codes.
 *
 * Config-driven like the rest of the platform: adding an offer is a data
 * change. Validation happens server-side on every quote and booking — a code
 * typed into the form is never trusted for the discount it claims.
 */

export interface Promo {
  code: string;
  label: string;
  /** Percentage off (0.15 = 15%). Mutually exclusive with `amountOff`. */
  percentOff?: number;
  /** Flat dollars off. */
  amountOff?: number;
  /** Minimum pre-discount subtotal in USD. */
  minSubtotal?: number;
  /** Restrict to specific services; empty means all. */
  services?: string[];
  /** Restrict to specific city slugs; empty means all. */
  cities?: string[];
  /** Only for first-time customers. */
  firstTimeOnly?: boolean;
  /** ISO date after which the code stops working. */
  expiresAt?: string;
  active: boolean;
}

export const promos: Promo[] = [
  {
    code: 'WELCOME20',
    label: '20% off your first cleaning',
    percentOff: 0.2,
    firstTimeOnly: true,
    active: true,
  },
  {
    code: 'COMEBACK15',
    label: '15% off — we miss you',
    percentOff: 0.15,
    active: true,
  },
  {
    code: 'NYC25',
    label: '$25 off in New York',
    amountOff: 25,
    minSubtotal: 150,
    cities: ['manhattan-ny', 'brooklyn-ny', 'queens-ny', 'bronx-ny'],
    active: true,
  },
  {
    code: 'MOVEOUT30',
    label: '$30 off move-out cleaning',
    amountOff: 30,
    services: ['move-out-cleaning', 'move-in-cleaning'],
    minSubtotal: 180,
    active: true,
  },
];

export function findPromo(code: string): Promo | null {
  const key = code.trim().toUpperCase();
  return promos.find((p) => p.code === key) ?? null;
}

export type PromoRejection =
  | 'unknown'
  | 'inactive'
  | 'expired'
  | 'min_subtotal'
  | 'wrong_service'
  | 'wrong_city'
  | 'first_time_only';

export interface PromoEvaluation {
  ok: boolean;
  promo?: Promo;
  discount: number; // USD off the subtotal
  reason?: PromoRejection;
  message?: string;
}

const REJECTION_MESSAGES: Record<PromoRejection, string> = {
  unknown: 'That code isn’t valid.',
  inactive: 'That code is no longer available.',
  expired: 'That code has expired.',
  min_subtotal: 'That code needs a larger order to apply.',
  wrong_service: 'That code doesn’t apply to this service.',
  wrong_city: 'That code isn’t available in your area.',
  first_time_only: 'That code is for first-time customers only.',
};

export function evaluatePromo(
  code: string,
  context: { subtotal: number; serviceSlug: string; citySlug?: string; isFirstTime?: boolean },
): PromoEvaluation {
  const promo = findPromo(code);
  const reject = (reason: PromoRejection): PromoEvaluation => ({
    ok: false,
    discount: 0,
    reason,
    message: REJECTION_MESSAGES[reason],
  });

  if (!promo) return reject('unknown');
  if (!promo.active) return reject('inactive');
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return reject('expired');
  if (promo.minSubtotal && context.subtotal < promo.minSubtotal) return reject('min_subtotal');
  if (promo.services?.length && !promo.services.includes(context.serviceSlug)) return reject('wrong_service');
  if (promo.cities?.length && (!context.citySlug || !promo.cities.includes(context.citySlug))) {
    return reject('wrong_city');
  }
  if (promo.firstTimeOnly && context.isFirstTime === false) return reject('first_time_only');

  const discount = promo.percentOff
    ? Math.round(context.subtotal * promo.percentOff)
    : Math.min(promo.amountOff ?? 0, context.subtotal);

  return { ok: true, promo, discount, message: promo.label };
}
