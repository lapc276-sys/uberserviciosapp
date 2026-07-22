import { listEmployees, employeeLoadOn, assignEmployee, type EmployeeRecord } from './data';
import { sendSms } from './sms';
import { site } from './config/site';
import { getService } from './config/services';

/**
 * Pro-matching / dispatch engine (Phase 4).
 * Picks the best available pro for a booking and notifies them.
 *
 * Scoring: active pros only, ranked by rating, tie-broken by the lightest
 * workload on that date (load-balancing). Pluggable — geo/skills/availability
 * windows can be layered in later without changing callers.
 */
export interface DispatchInput {
  ref: string;
  serviceSlug: string;
  date: string;
  time: string;
  city: string;
  address: string;
}

export async function assignAndNotify(input: DispatchInput): Promise<EmployeeRecord | null> {
  const employees = (await listEmployees()).filter((e) => e.active);
  if (employees.length === 0) return null;

  const load = await employeeLoadOn(input.date);
  const best = [...employees].sort((a, b) => {
    const la = load[a.id] ?? 0;
    const lb = load[b.id] ?? 0;
    if (la !== lb) return la - lb; // lighter workload first
    return b.rating - a.rating; // then higher rating
  })[0];

  await assignEmployee(input.ref, best.id, best.name);

  const service = getService(input.serviceSlug);
  if (best.phone) {
    await sendSms(
      best.phone,
      `${site.name}: New job assigned — ${service?.shortName ?? 'Cleaning'} on ${input.date} at ${input.time}, ${input.address}, ${input.city}. Ref ${input.ref}.`,
    );
  }

  return best;
}
