import { prosForCity, proLoadOn, createJobOffers, assignPro, type ProRecord } from './data';
import { sendSms } from './sms';
import { site } from './config/site';
import { getService } from './config/services';
import { getCityByName } from './config/cities';

/**
 * Marketplace dispatch.
 *
 * Unlike an employer model that assigns work, this offers the job to a ranked
 * shortlist of approved pros who serve that city; the first to accept claims
 * it. Pros keep the right to decline — a core marketplace mechanic, and one of
 * the factors that distinguishes contractors from employees.
 *
 * Ranking: pros covering the city, lightest committed load that date first,
 * then highest rating. Geo-precision (travel time, real availability windows)
 * layers in later without changing callers.
 */
export interface DispatchInput {
  ref: string;
  serviceSlug: string;
  date: string;
  time: string;
  city: string;
  address: string;
}

/** How many pros see a new job. Small enough to feel exclusive, big enough to fill. */
const SHORTLIST_SIZE = 3;

export interface DispatchResult {
  offered: ProRecord[];
  reason?: 'no_coverage';
}

export async function offerJob(input: DispatchInput): Promise<DispatchResult> {
  const citySlug = getCityByName(input.city)?.slug;
  const candidates = citySlug ? await prosForCity(citySlug) : [];
  if (candidates.length === 0) return { offered: [], reason: 'no_coverage' };

  const load = await proLoadOn(input.date);
  const shortlist = [...candidates]
    .sort((a, b) => {
      const la = load[a.id] ?? 0;
      const lb = load[b.id] ?? 0;
      if (la !== lb) return la - lb;
      return b.rating - a.rating;
    })
    .slice(0, SHORTLIST_SIZE);

  await createJobOffers(input.ref, shortlist.map((p) => p.id));

  const service = getService(input.serviceSlug);
  const claimUrl = `${site.url}/pros/jobs/${input.ref}`;
  await Promise.allSettled(
    shortlist
      .filter((p) => p.phone)
      .map((p) =>
        sendSms(
          p.phone!,
          `${site.name}: New job available — ${service?.shortName ?? 'Cleaning'} on ${input.date} at ${input.time}, ${input.city}. First to accept gets it: ${claimUrl}`,
        ),
      ),
  );

  return { offered: shortlist };
}

/**
 * Admin fallback when an offer round goes unclaimed: hard-assign the
 * best-ranked available pro so the customer is never left without service.
 */
export async function forceAssign(input: DispatchInput): Promise<ProRecord | null> {
  const citySlug = getCityByName(input.city)?.slug;
  const candidates = citySlug ? await prosForCity(citySlug) : [];
  if (candidates.length === 0) return null;

  const load = await proLoadOn(input.date);
  const best = [...candidates].sort((a, b) => {
    const la = load[a.id] ?? 0;
    const lb = load[b.id] ?? 0;
    if (la !== lb) return la - lb;
    return b.rating - a.rating;
  })[0];

  await assignPro(input.ref, best.id, best.name);
  const service = getService(input.serviceSlug);
  if (best.phone) {
    await sendSms(
      best.phone,
      `${site.name}: Job assigned — ${service?.shortName ?? 'Cleaning'} on ${input.date} at ${input.time}, ${input.address}, ${input.city}. Ref ${input.ref}.`,
    );
  }
  return best;
}
