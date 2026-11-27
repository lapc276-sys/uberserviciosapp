import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_REPAIR_AT,
  DAMAGE,
  NOTE_DAMAGE_AT,
  askableDamage,
  damageCaution,
  knownDamage,
  repairPrompt,
} from '../lib/vision/damage';
import { questionsForRoom, depthChoicesFrom, repairNote, repairsFrom, REPAIR } from '../lib/vision/upsell';
import { coerceObservations } from '../lib/vision/analyzer';
import { coerceScout } from '../lib/vision/scout';
import { buildAnalysis } from '../lib/vision/estimate';
import { parseYesNo } from '../lib/capture/conversation';
import { EMPTY_SOIL, type RawRoomObservation } from '../lib/vision/types';

/**
 * Broken things: asked about, noted for the crew, and never priced.
 */

test('only kinds from the table get in', () => {
  // A model asked for damage will sometimes volunteer an opinion. None of it
  // may reach a sentence a customer hears.
  const got = knownDamage([
    { kind: 'cabinet', confidence: 0.8 },
    { kind: 'cabinet', confidence: 0.5 },
    { kind: 'the owners seem careless', confidence: 0.9 },
    { kind: 'WALL', confidence: 2 },
    'nonsense',
  ]);
  assert.deepEqual(got, [
    { kind: 'cabinet', confidence: 0.8 },
    { kind: 'wall', confidence: 1 },
  ]);
  assert.deepEqual(knownDamage(undefined), []);
});

test('the customer is asked only on a firm sighting, the crew told on a weaker one', () => {
  const shaky = [{ kind: 'wall', confidence: (ASK_REPAIR_AT + NOTE_DAMAGE_AT) / 2 }];
  // "Veo un hueco en tu pared" when there is none is an insult about their home.
  assert.deepEqual(askableDamage(shaky), []);
  // Telling the crew to look costs nothing.
  assert.ok(damageCaution(shaky));
  assert.equal(damageCaution([{ kind: 'wall', confidence: NOTE_DAMAGE_AT - 0.1 }]), undefined);
});

test('one repair question per room, naming everything broken in it', () => {
  const questions = questionsForRoom('bathroom', [], { ...EMPTY_SOIL }, {
    damage: [
      { kind: 'tile', confidence: 0.9 },
      { kind: 'fixture', confidence: 0.7 },
    ],
  });
  const repairs = questions.filter((q) => q.kind === 'repair');
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].extraMinutes, 0, 'a repair question must not move the price');
  assert.ok(repairs[0].prompt.includes(DAMAGE.tile.seen));
  assert.ok(repairs[0].prompt.includes(DAMAGE.fixture.seen));
  // Asked first: it is the one question the person may not expect.
  assert.equal(questions[0].kind, 'repair');
});

test('a yes to a repair is a lead, never minutes', () => {
  const [q] = questionsForRoom('kitchen', [], { ...EMPTY_SOIL }, { damage: [{ kind: 'cabinet', confidence: 0.9 }] });
  const asked = [{ ...q, id: `kitchen-1:${REPAIR}`, place: 'Cocina' }];
  const answers = { [asked[0].id]: true };

  assert.deepEqual(depthChoicesFrom(asked, answers), {}, 'nothing reaches the estimator');
  assert.deepEqual(repairsFrom(asked, answers), [{ place: 'Cocina', items: [DAMAGE.cabinet.label] }]);
  assert.equal(repairNote(repairsFrom(asked, answers)), `Quiere que le contacten para arreglar: ${DAMAGE.cabinet.label} (Cocina).`);

  // A no is not a lead.
  assert.deepEqual(repairsFrom(asked, { [asked[0].id]: false }), []);
  assert.equal(repairNote([]), undefined);
});

test('the bot cannot answer its own repair question', () => {
  for (const kind of Object.keys(DAMAGE)) {
    const prompt = repairPrompt([kind])!;
    assert.equal(parseYesNo(prompt), null, prompt);
  }
  assert.equal(repairPrompt(['not a kind']), null);
});

test('both model replies are gated the same way', () => {
  const scout = coerceScout({ objects: [], damage: [{ kind: 'door', confidence: 0.7 }, { kind: 'vibes', confidence: 1 }] });
  assert.deepEqual(scout.damage, [{ kind: 'door', confidence: 0.7 }]);

  const { rooms } = coerceObservations({
    rooms: [{ type: 'kitchen', soil: {}, objects: [], damage: [{ kind: 'cabinet', confidence: 0.8 }, { kind: 'mess' }] }],
  });
  assert.deepEqual(rooms[0].damage, [{ kind: 'cabinet', confidence: 0.8 }]);
});

test('damage reaches the crew and not the price', () => {
  const room = (damage?: RawRoomObservation['damage']): RawRoomObservation => ({
    type: 'kitchen',
    confidence: 0.8,
    objects: [{ name: 'oven', count: 1, confidence: 0.9 }],
    soil: { ...EMPTY_SOIL, grease: 40, dust: 30 },
    damage,
  });
  const clean = buildAnalysis([room()], { serviceSlug: 'house-cleaning', source: 'heuristic' });
  const broken = buildAnalysis([room([{ kind: 'cabinet', confidence: 0.9 }])], {
    serviceSlug: 'house-cleaning',
    source: 'heuristic',
  });

  assert.equal(broken.totalMinutes, clean.totalMinutes, 'a broken cabinet must not change the minutes');

  const cautions = broken.crewPlan!.steps.flatMap((s) => s.cautions);
  const told = cautions.filter((c) => c.includes(DAMAGE.cabinet.label));
  // Said once, the first time the crew walks into the room — not on every step.
  assert.equal(told.length, 1, cautions.join(' | '));
});
