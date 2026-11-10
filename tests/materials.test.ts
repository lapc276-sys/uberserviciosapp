import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIALS,
  BILL_AT_CONFIDENCE,
  WARN_AT_CONFIDENCE,
  knownMaterials,
  materialMinutes,
  materialNote,
} from '../lib/vision/materials';
import { buildAnalysis } from '../lib/vision/estimate';
import { planSupplies } from '../lib/vision/supplies';
import { coerceObservations } from '../lib/vision/analyzer';
import { EMPTY_SOIL, type RawRoomObservation, type SoilScores } from '../lib/vision/types';

/**
 * Surfaces: what they add to the price, and what they keep out of the van.
 *
 * The price half has to stay explainable — a surcharge with no stated reason
 * is what pricing the surface instead of the neighbourhood was chosen to
 * avoid. The warning half protects against the expensive mistake, which is
 * not a slow clean but an etched countertop.
 */

const soil = (over: Partial<SoilScores> = {}): SoilScores => ({ ...EMPTY_SOIL, ...over });

function room(over: Partial<RawRoomObservation> = {}): RawRoomObservation {
  return { type: 'kitchen', confidence: 0.8, objects: [], soil: soil(), ...over };
}

const analyse = (r: RawRoomObservation, serviceSlug = 'house-cleaning') =>
  buildAnalysis([r], { serviceSlug, source: 'heuristic' });

test('marble makes the kitchen cost more, and the quote says why', () => {
  const plain = analyse(room());
  const marble = analyse(room({ materials: [{ name: 'natural_stone', confidence: 0.9 }] }));

  assert.ok(marble.totalMinutes > plain.totalMinutes, `${plain.totalMinutes} → ${marble.totalMinutes}`);

  // The reason travels with the number. Without this the surcharge is just a
  // higher price in a nicer flat, which is the thing being avoided.
  const note = marble.rooms[0].notes ?? '';
  assert.ok(note.includes('piedra natural'), note);
  assert.ok(note.includes('pH neutro'), note);
  assert.ok(/\+\d+ min/.test(note), `the minutes must be stated: ${note}`);
});

test('a brand or an adjective never reaches the price', () => {
  // A model asked for materials will sometimes volunteer what it thinks is
  // expensive. None of it may become minutes.
  const plain = analyse(room());
  const branded = analyse(
    room({
      materials: [
        { name: 'sub-zero', confidence: 0.99 },
        { name: 'luxury', confidence: 0.99 },
        { name: 'expensive-looking marble', confidence: 0.99 },
      ],
    }),
  );

  assert.equal(branded.totalMinutes, plain.totalMinutes);
  assert.equal(branded.rooms[0].materials, undefined);
  assert.equal(knownMaterials([{ name: 'Viking', confidence: 1 }]).length, 0);
});

test('the model reply is filtered at the door', () => {
  const { rooms } = coerceObservations({
    rooms: [
      {
        type: 'kitchen',
        confidence: 0.9,
        objects: [],
        materials: [
          { name: 'Natural_Stone', confidence: 0.8 },
          { name: 'sub-zero', confidence: 0.9 },
          { confidence: 0.9 },
          'marble',
        ],
        soil: {},
      },
    ],
  });

  assert.deepEqual(rooms[0].materials, [{ name: 'natural_stone', confidence: 0.8 }]);
});

test('a weak sighting warns the crew but does not bill the customer', () => {
  // The two mistakes cost different things: a needless warning is free, a
  // missing one is a countertop, and a wrongly billed minute is a dispute.
  const between = (WARN_AT_CONFIDENCE + BILL_AT_CONFIDENCE) / 2;
  const weak = [{ name: 'natural_stone', confidence: between }];

  assert.equal(materialMinutes(weak), 0, 'not firm enough to charge for');
  assert.equal(materialNote(weak), undefined);

  const plan = planSupplies({
    soil: soil(),
    objects: [{ name: 'toilet', count: 1, confidence: 0.9 }],
    materials: weak,
    roomTypes: ['bathroom'],
    serviceSlug: 'house-cleaning',
    totalMinutes: 90,
  });
  assert.ok(
    plan.safetyWarnings.some((w) => w.includes('natural stone')),
    'the crew must still be told',
  );
});

test('a sighting too weak to trust does nothing at all', () => {
  const faint = [{ name: 'natural_stone', confidence: WARN_AT_CONFIDENCE - 0.1 }];
  const plan = planSupplies({
    soil: soil(),
    objects: [],
    materials: faint,
    roomTypes: ['bathroom'],
    serviceSlug: 'house-cleaning',
    totalMinutes: 90,
  });
  assert.equal(plan.safetyWarnings.filter((w) => w.includes('natural stone')).length, 0);
  assert.ok(!plan.lines.some((l) => l.id === 'stone_cleaner'));
});

test('marble on the counter and the backsplash is charged once', () => {
  const once = materialMinutes([{ name: 'natural_stone', confidence: 0.9 }]);
  const twice = materialMinutes([
    { name: 'natural_stone', confidence: 0.9 },
    { name: 'natural_stone', confidence: 0.7 },
  ]);
  // One neutral product and one buffing pass, however many slabs.
  assert.equal(twice, once);
});

test('care is not scaled by how deep the clean is', () => {
  // The dry buff on marble is the same pass on a maintenance visit as on a
  // deep one. Scaling it by the service would charge the depth twice — the
  // same mistake the object minutes were separated out to stop.
  const stone = [{ name: 'natural_stone', confidence: 1 }];
  const standard =
    analyse(room({ materials: stone })).totalMinutes - analyse(room()).totalMinutes;
  const deep =
    analyse(room({ materials: stone }), 'deep-cleaning').totalMinutes -
    analyse(room(), 'deep-cleaning').totalMinutes;

  assert.equal(standard, deep);
  assert.equal(standard, MATERIALS.natural_stone.extraMinutes);
});

test('stone in a bathroom puts the neutral cleaner in the van and names the acid', () => {
  const plan = planSupplies({
    soil: soil({ stains: 50 }),
    objects: [{ name: 'toilet', count: 1, confidence: 0.9 }],
    materials: [{ name: 'natural_stone', confidence: 0.9 }],
    roomTypes: ['bathroom'],
    serviceSlug: 'house-cleaning',
    totalMinutes: 120,
  });

  assert.ok(plan.lines.some((l) => l.id === 'stone_cleaner'), 'the right product must be packed');

  // The warning that matters names the bottle actually going into the room:
  // the limescale remover brought for the shower will etch the vanity.
  const warning = plan.safetyWarnings.find((w) => w.includes('natural stone'));
  assert.ok(warning, 'stone next to an acid must be flagged');
  assert.ok(warning.includes('limescale'), warning);
  assert.ok(warning.includes('toilet bowl cleaner'), warning);
});

test('stainless is warned about bleach only when bleach is coming', () => {
  const steel = [{ name: 'stainless_steel', confidence: 0.9 }];
  const base = { objects: [], materials: steel, roomTypes: ['kitchen' as const], serviceSlug: 'house-cleaning', totalMinutes: 90 };

  const clean = planSupplies({ ...base, soil: soil() });
  assert.equal(clean.safetyWarnings.filter((w) => w.includes('stainless')).length, 0);

  // Mold brings the bleach-based remover, and now the two are in one room.
  const moldy = planSupplies({ ...base, soil: soil({ mold: 40 }) });
  assert.ok(moldy.safetyWarnings.some((w) => w.includes('stainless') && w.includes('mold')));
});

test('a wood floor adds no time but keeps the steamer off it', () => {
  const wood = [{ name: 'hardwood', confidence: 0.9 }];
  assert.equal(materialMinutes(wood), 0, 'a damp mop is not slower than a wet one');

  // Heavy grease puts a steam cleaner in the kit — on a wood floor that is
  // the tool that does the damage.
  const plan = planSupplies({
    soil: soil({ grease: 70 }),
    objects: [],
    materials: wood,
    roomTypes: ['kitchen'],
    serviceSlug: 'house-cleaning',
    totalMinutes: 120,
  });
  assert.ok(plan.lines.some((l) => l.id === 'steam_cleaner'));
  assert.ok(plan.safetyWarnings.some((w) => w.includes('hardwood') && w.includes('steam')));
});

test('a home with no materials reported is planned exactly as before', () => {
  const ctx = {
    soil: soil({ grease: 40, mold: 30 }),
    objects: [{ name: 'oven', count: 1, confidence: 0.8 }],
    roomTypes: ['kitchen' as const, 'bathroom' as const],
    serviceSlug: 'house-cleaning',
    totalMinutes: 150,
  };
  assert.deepEqual(planSupplies({ ...ctx, materials: [] }), planSupplies(ctx));
  assert.equal(analyse(room({ materials: [] })).totalMinutes, analyse(room()).totalMinutes);
});

test('the whole table cannot add more than a few minutes to a room', () => {
  // Every figure is an unmeasured hypothesis, so the ceiling is kept low
  // enough that being wrong about all of them at once is still a rounding
  // error on a two-hour job.
  const everything = Object.keys(MATERIALS).map((name) => ({ name, confidence: 1 }));
  assert.ok(materialMinutes(everything) <= 10, `${materialMinutes(everything)} min`);
});
