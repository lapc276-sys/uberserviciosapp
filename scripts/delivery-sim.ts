/* eslint-disable no-console */
/**
 * Delivery engine simulator — `npm run delivery:sim`
 *
 * Runs the engine against a hand-built market so its decisions can be read,
 * argued with and corrected without a database, an API key or a real courier.
 * Every number printed here comes from lib/delivery/*; nothing is faked for the
 * demo, which is precisely why it is worth reading: where the output looks
 * wrong, the model is wrong, and that is the point.
 */
import type {
  AccessObservation,
  BuildingProfile,
  CourierState,
  DeliveryJob,
  MerchantProfile,
  PrepObservation,
} from '../lib/delivery/types';
import { estimateJob, timeline, type JobContext } from '../lib/delivery/time-model';
import { appraise } from '../lib/delivery/complexity';
import { courierPayFor } from '../lib/delivery/pricing';
import { evaluateBatch } from '../lib/delivery/batching';
import { planDispatch } from '../lib/delivery/dispatch';
import { buildingAccessScore, estimateAccess, inferElevator } from '../lib/delivery/buildings';
import { estimateLaundry, finalLaundryPrice, splitOrder } from '../lib/delivery/pricing';
import { suggestStaging, type DemandSample } from '../lib/delivery/staging';
import { overrunsEstimate } from '../lib/delivery/payments';

const NOW = new Date('2026-08-07T19:30:00-04:00'); // a Friday evening, on purpose

// ── The market ───────────────────────────────────────────────────────────────

const sudz: MerchantProfile = {
  id: 'm_sudz',
  name: 'Sudz Laundromat',
  vertical: 'laundry',
  location: { lat: 25.7651, lng: -80.2201 },
  parking: 'moderate',
  quotedPrepMinutes: 20,
  quotedCounterMinutes: 2.2,
};

const slowMerchant: MerchantProfile = {
  ...sudz,
  id: 'm_slow',
  name: 'Brickell Wash & Fold (slow)',
  location: { lat: 25.7607, lng: -80.1935 },
  quotedPrepMinutes: 22,
  parking: 'hard',
};

// 0.8 mi east of the laundromat.
const easyBuilding: BuildingProfile = {
  id: 'b_easy',
  label: '183 W Flagler St',
  location: { lat: 25.766, lng: -80.21 },
  floors: 6,
  elevator: 'yes',
  entry: 'locked_lobby',
  parking: 'moderate',
};

// 0.6 mi east, same direction, but six floors of stairs.
const walkUp: BuildingProfile = {
  id: 'b_walkup',
  label: '241 SW 8th St',
  location: { lat: 25.7648, lng: -80.2125 },
  floors: 6,
  elevator: 'no',
  entry: 'buzzer',
  parking: 'hard',
};

// A block from `easyBuilding` — the batch that should be taken.
const nearEasy: BuildingProfile = {
  ...easyBuilding,
  id: 'b_near_easy',
  label: '250 SW 8th St',
  location: { lat: 25.7668, lng: -80.2085 },
  floors: 4,
};

const oppositeDirection: BuildingProfile = {
  ...easyBuilding,
  id: 'b_opposite',
  label: '900 NW 27th Ave',
  location: { lat: 25.7842, lng: -80.2412 },
};

const luis: CourierState = {
  id: 'c_luis',
  name: 'Luis',
  mode: 'scooter',
  location: { lat: 25.7689, lng: -80.2185 },
  freeInMinutes: 0,
  paceFactor: 0.92,
  activeJobs: 0,
};

function ctx(merchant: MerchantProfile, building: BuildingProfile, prep: PrepObservation[] = []): JobContext {
  return { merchant, building, prepObservations: prep, counterObservations: [], accessObservations: [] };
}

function job(overrides: Partial<DeliveryJob> & { ref: string; merchantId: string; building: BuildingProfile; floor: number }): DeliveryJob {
  return {
    ref: overrides.ref,
    merchantId: overrides.merchantId,
    dropoff: {
      location: overrides.building.location,
      buildingId: overrides.building.id,
      floor: overrides.floor,
      handoff: 'hand_to_customer',
    },
    payout: overrides.payout ?? 6,
    placedAt: overrides.placedAt ?? new Date(NOW.getTime() - 4 * 60000).toISOString(),
    promisedReadyAt: overrides.promisedReadyAt ?? null,
    items: overrides.items ?? 2,
  };
}

function heading(title: string) {
  console.log(`\n${'─'.repeat(74)}\n${title}\n${'─'.repeat(74)}`);
}

// ── 1. Two jobs that look identical to a distance-based system ───────────────

heading('1. The same distance is not the same job');

const jobA = job({
  ref: 'A',
  merchantId: sudz.id,
  building: easyBuilding,
  floor: 3,
  payout: 6,
  // Ready now.
  placedAt: new Date(NOW.getTime() - 25 * 60000).toISOString(),
});

const jobB = job({
  ref: 'B',
  merchantId: slowMerchant.id,
  building: walkUp,
  floor: 6,
  payout: 7,
  placedAt: new Date(NOW.getTime() - 3 * 60000).toISOString(), // ~19 min of prep left
});

for (const [label, j, c] of [
  ['Order A — $6.00, easy building, order ready', jobA, ctx(sudz, easyBuilding)],
  ['Order B — $7.00, 6th floor walk-up, slow merchant', jobB, ctx(slowMerchant, walkUp)],
] as const) {
  const first = estimateJob({ ...j, payout: 0 }, luis, c, { now: NOW });
  const pay = courierPayFor(first);
  const estimate = estimateJob({ ...j, payout: j.payout }, luis, c, { now: NOW });
  const appraisal = appraise(estimate, j.payout);

  console.log(`\n${label}`);
  console.log(`  total ${estimate.totalMinutes} min  (working ${estimate.workingMinutes} min)`);
  console.log(`  complexity ${appraisal.complexity.score}/100 — ${appraisal.complexity.headline}`);
  console.log(`  $${estimate.dollarsPerMinute}/min → $${appraisal.dollarsPerHour}/hr · verdict: ${appraisal.verdict}`);
  console.log(`  pay derived from its real minutes: $${pay.toFixed(2)} (offered: $${j.payout.toFixed(2)})`);
  console.log('  where the time goes:');
  for (const step of timeline(estimate)) {
    console.log(`    ${step.label.padEnd(26)} ${String(step.minutes).padStart(5)} min`);
  }
}

// ── 2. Batching: the same rule, two answers ──────────────────────────────────

heading('2. Batching is arithmetic, not policy');

const readySoon = new Date(NOW.getTime() - 18 * 60000).toISOString();
const partnerGood = job({ ref: 'B-good', merchantId: sudz.id, building: nearEasy, floor: 2, payout: 6, placedAt: readySoon });
const partnerBad = job({ ref: 'B-bad', merchantId: sudz.id, building: oppositeDirection, floor: 2, payout: 6, placedAt: readySoon });
const jobAready = { ...jobA, merchantId: sudz.id, placedAt: readySoon };

for (const [label, partner, building] of [
  ['Same merchant, drops a block apart, both ready', partnerGood, nearEasy],
  ['Same merchant, drops in opposite directions', partnerBad, oppositeDirection],
] as const) {
  const decision = evaluateBatch(
    { job: jobAready, ctx: ctx(sudz, easyBuilding) },
    { job: partner, ctx: ctx(sudz, building) },
    luis,
    { now: NOW },
  );

  console.log(`\n${label}`);
  console.log(`  decision: ${decision.batch ? 'BATCH' : 'DO NOT BATCH'}`);
  console.log(`  sequential ${decision.sequentialMinutes} min → batched ${decision.route?.totalMinutes} min (saves ${decision.minutesSaved} min)`);
  console.log(`  $/min: ${decision.soloDollarsPerMinute} solo → ${decision.route?.dollarsPerMinute} batched (${decision.efficiencyRatio}×)`);
  for (const check of decision.checks) {
    console.log(`    ${check.passed ? '✓' : '✗'} ${check.label.padEnd(30)} ${check.detail}`);
  }
}

// ── 3. Assignment: closest is not best ───────────────────────────────────────

heading('3. Closest courier vs. best courier');

const fleet: CourierState[] = [
  // Right next to the laundromat, but free now — will stand there waiting.
  { ...luis, id: 'c_ana', name: 'Ana (closest, free now)', location: { lat: 25.7655, lng: -80.2205 }, freeInMinutes: 0, paceFactor: 1 },
  // Further out, but finishes exactly when the order comes off the counter.
  { ...luis, id: 'c_luis', name: 'Luis (finishing in 9 min)', location: { lat: 25.7723, lng: -80.2032 }, freeAt: { lat: 25.7723, lng: -80.2032 }, freeInMinutes: 9 },
  { ...luis, id: 'c_dee', name: 'Dee (far, free now)', mode: 'ebike', location: { lat: 25.7861, lng: -80.1901 }, freeInMinutes: 0, paceFactor: 1.05 },
];

const pendingOrder = job({
  ref: 'C',
  merchantId: sudz.id,
  building: easyBuilding,
  floor: 4,
  payout: 7.5,
  placedAt: new Date(NOW.getTime() - 6 * 60000).toISOString(), // ~14 min of prep left
});

const plan = planDispatch(pendingOrder, fleet, ctx(sudz, easyBuilding), { now: NOW });
for (const c of plan.candidates) {
  console.log(
    `  ${String(c.score).padStart(5)}  ${c.courier.name.padEnd(28)} ${c.rationale}` +
      `\n         idle gap ${c.idleGapMinutes} min (${c.repositionMinutes} riding + ${c.waitMinutes} standing)`,
  );
}
console.log(`\n  hold the offer? ${plan.hold.hold ? `YES for ~${plan.hold.holdForMinutes} min` : 'no'} — ${plan.hold.reason}`);
if (plan.payWarning) console.log(`  ⚠ ${plan.payWarning}`);

// Same order, but the only courier free is the one parked next to the counter.
// Sending it now buys nothing except standing time.
const onlyAna = planDispatch(pendingOrder, [fleet[0]], ctx(sudz, easyBuilding), { now: NOW });
console.log(
  `\n  if only Ana were available: ${onlyAna.hold.hold ? `HOLD ~${onlyAna.hold.holdForMinutes} min` : 'offer now'} — ${onlyAna.hold.reason}`,
);

// ── 3b. Strategic points ─────────────────────────────────────────────────────

heading('3b. Where to wait, when you are about to be free');

const demand: DemandSample[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ merchantId: sudz.id, weekday: 5, hour: 19, orders: 5 + (i % 3) })),
  ...Array.from({ length: 6 }, (_, i) => ({ merchantId: slowMerchant.id, weekday: 5, hour: 19, orders: 1 + (i % 2) })),
];

const finishingSoon: CourierState = { ...luis, freeInMinutes: 3, location: { lat: 25.7705, lng: -80.2049 }, freeAt: { lat: 25.7705, lng: -80.2049 } };
for (const s of suggestStaging(finishingSoon, [sudz, slowMerchant], demand, { now: NOW })) {
  console.log(`  ${s.label.padEnd(30)} score ${String(s.score).padStart(6)} — ${s.reason}`);
}

// ── 4. The building learns ───────────────────────────────────────────────────

heading('4. A building teaches the engine what nobody told it');

const mystery: BuildingProfile = {
  id: 'b_mystery',
  label: '2900 Coral Way',
  location: { lat: 25.75, lng: -80.2385 },
  floors: 8,
  elevator: 'unknown',
  entry: 'unknown',
  parking: 'easy',
};

const before = estimateAccess({ building: mystery, floor: 6, handoff: 'hand_to_customer', items: 2 }, []);
console.log(`  before any delivery: ${before.minutes.toFixed(2)} min to floor 6 · access score ${buildingAccessScore(mystery)} · basis ${before.basis}`);
console.log(`  unknowns: ${before.unknowns.join(', ')}`);

// Twelve real drops, all much slower than the elevator model would predict —
// this building's "elevator" is a staircase.
const observations: AccessObservation[] = Array.from({ length: 12 }, (_, i) => ({
  buildingId: mystery.id,
  floor: [3, 4, 5, 6, 7, 8][i % 6],
  seconds: 190 + [3, 4, 5, 6, 7, 8][i % 6] * 34 + ((i % 3) - 1) * 12,
  usedElevator: null,
  at: NOW.toISOString(),
}));

const after = estimateAccess({ building: mystery, floor: 6, handoff: 'hand_to_customer', items: 2 }, observations);
const inference = inferElevator(mystery, observations);
console.log(`  after 12 drops:     ${after.minutes.toFixed(2)} min to floor 6 · access score ${buildingAccessScore(mystery, observations)} · basis ${after.basis}`);
console.log(`  learned factor ${after.factor.toFixed(2)}× · p50 ${after.p50?.toFixed(2)} min · p90 ${after.p90?.toFixed(2)} min`);
console.log(`  elevator inference: ${inference.elevator} (confidence ${inference.confidence.toFixed(2)}) — ${inference.reason}`);

// ── 5. Money: the price that does not exist yet ──────────────────────────────

heading('5. Paying for an order whose price is unknown at intake');

const quote = estimateLaundry(3);
console.log(`  intake:    ${quote.summary}`);
console.log(`  card on file saved at intake — $0.00 charged`);

for (const pounds of [34, 61]) {
  const total = finalLaundryPrice(pounds);
  const overruns = overrunsEstimate(quote.high, total);
  const split = splitOrder({ total, serviceSubtotal: total - quote.deliveryFee, courierPay: 7.4 });
  console.log(`\n  weighed ${pounds} lb → $${total.toFixed(2)} (estimate topped out at $${quote.high.toFixed(2)})`);
  console.log(`    ${overruns ? 'ASK the customer to approve — not charged silently' : 'charge the saved card off-session'}`);
  console.log(`    split: laundromat $${split.merchant.toFixed(2)} · courier $${split.courier.toFixed(2)} · platform $${split.platform.toFixed(2)}`);
}

console.log('\nEvery constant above is a hypothesis until deliveries report back.\n');
