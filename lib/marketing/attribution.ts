/**
 * Marketing attribution.
 *
 * Without this, ad spend is blind: you can see that bookings happened but not
 * which channel produced them, so you can't tell a campaign that pays for
 * itself from one that quietly burns budget. This is the highest-leverage
 * marketing feature in the platform.
 *
 * First-touch attribution: the source that *found* the customer gets credit,
 * captured on landing and carried through to the booking.
 */

export const ATTRIBUTION_COOKIE = 'homigo_attr';
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface Attribution {
  source: string; // google | facebook | instagram | direct | referral…
  medium?: string; // cpc | organic | email | social
  campaign?: string;
  term?: string;
  content?: string;
  landing?: string;
  at: number;
}

const KNOWN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** Infers a channel from the referrer when no UTM tags are present. */
function inferFromReferrer(referrer: string | null): { source: string; medium: string } | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (/google\./.test(host)) return { source: 'google', medium: 'organic' };
  if (/bing\./.test(host)) return { source: 'bing', medium: 'organic' };
  if (/(facebook|fb)\./.test(host)) return { source: 'facebook', medium: 'social' };
  if (/instagram\./.test(host)) return { source: 'instagram', medium: 'social' };
  if (/yelp\./.test(host)) return { source: 'yelp', medium: 'referral' };
  if (/nextdoor\./.test(host)) return { source: 'nextdoor', medium: 'referral' };
  return { source: host, medium: 'referral' };
}

/** Builds an attribution record from a request, or null if there's nothing new. */
export function readAttribution(url: URL, referrer: string | null, sameHost: boolean): Attribution | null {
  const params = url.searchParams;
  const hasUtm = KNOWN_PARAMS.some((p) => params.get(p));

  // Google Ads / Meta click identifiers imply paid traffic even without UTMs.
  const gclid = params.get('gclid');
  const fbclid = params.get('fbclid');

  if (hasUtm) {
    return {
      source: (params.get('utm_source') ?? 'unknown').toLowerCase().slice(0, 60),
      medium: params.get('utm_medium')?.toLowerCase().slice(0, 60) ?? undefined,
      campaign: params.get('utm_campaign')?.slice(0, 120) ?? undefined,
      term: params.get('utm_term')?.slice(0, 120) ?? undefined,
      content: params.get('utm_content')?.slice(0, 120) ?? undefined,
      landing: url.pathname.slice(0, 200),
      at: Date.now(),
    };
  }

  if (gclid) return { source: 'google', medium: 'cpc', landing: url.pathname, at: Date.now() };
  if (fbclid) return { source: 'facebook', medium: 'cpc', landing: url.pathname, at: Date.now() };

  // Internal navigation shouldn't overwrite the original source.
  if (sameHost) return null;

  const inferred = inferFromReferrer(referrer);
  if (inferred) return { ...inferred, landing: url.pathname, at: Date.now() };

  return { source: 'direct', medium: 'none', landing: url.pathname, at: Date.now() };
}

export function encodeAttribution(a: Attribution): string {
  return Buffer.from(JSON.stringify(a)).toString('base64url');
}

export function decodeAttribution(value: string | undefined): Attribution | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
    if (typeof parsed?.source !== 'string') return null;
    return parsed as Attribution;
  } catch {
    return null;
  }
}

/** Human label for reporting. */
export function channelLabel(a: { source: string; medium?: string | null }): string {
  const source = a.source || 'direct';
  const medium = a.medium ?? '';
  if (medium === 'cpc' || medium === 'paid') return `${source} (paid)`;
  if (medium === 'organic') return `${source} (organic)`;
  if (medium === 'email') return 'email';
  if (source === 'direct') return 'direct';
  return medium ? `${source} (${medium})` : source;
}
