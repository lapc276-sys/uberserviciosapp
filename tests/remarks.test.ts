import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceConditions, namedObjects, roomRemark, ISSUES, type ObjectCondition } from '../lib/vision/remarks';
import { OBJECT_TIME_COST } from '../lib/vision/model';
import { ROOM_TYPES } from '../lib/vision/types';
import { coerceScout } from '../lib/vision/scout';
import { COMMANDS, parseYesNo, wantsToContinue } from '../lib/capture/conversation';
import { askedObjects, promptFor } from '../lib/vision/upsell';
import { DAMAGE, repairPrompt } from '../lib/vision/damage';
import { initialLang, phoneLanguage } from '../lib/capture/lang';
import { normalize } from '../lib/vision/voice-commands';

/**
 * The remark the bot makes as a room is left, and the English half of every
 * question.
 *
 * The remark has one job beyond sounding human: it must say what the scores
 * say. A "looks spotless" over a dirty stove is the compliment the customer
 * remembers when the price arrives.
 */

const c = (name: string, dirt: number, issue?: ObjectCondition['issue']): ObjectCondition => ({
  name,
  dirt,
  issue,
  confidence: 0.8,
});

test('a clean room is said to be clean — only on real evidence', () => {
  assert.equal(roomRemark('kitchen', [c('oven', 0), c('sink', 0)], 'es'), 'La cocina se ve impecable.');
  assert.equal(roomRemark('kitchen', [c('oven', 0), c('sink', 0)], 'en'), 'The kitchen looks spotless.');
  // One clean mirror does not make a spotless bathroom.
  assert.equal(roomRemark('bathroom', [c('mirror', 0)], 'es'), 'El baño se ve muy bien.');
});

test('small details are named', () => {
  const remark = roomRemark('kitchen', [c('oven', 0), c('microwave', 1, 'food')], 'es')!;
  assert.match(remark, /se ve muy bien/);
  assert.match(remark, /el microondas/);
});

test('the worst thing is named with its problem, and never called clean', () => {
  const conditions = [c('range hood', 2, 'grease'), c('oven', 2, 'food'), c('sink', 0)];
  const es = roomRemark('kitchen', conditions, 'es')!;
  const en = roomRemark('kitchen', conditions, 'en')!;
  assert.equal(es, 'La cocina está bastante bien. Lo que más trabajo va a dar es la campana, que tiene grasa, y el horno; ahí vamos a poner énfasis.');
  assert.equal(en, 'The kitchen is in decent shape overall. What will take the most work is the range hood, which has some grease, and the oven; we will put the emphasis there.');
  assert.doesNotMatch(es, /impecable|muy bien/);
});

test('a very dirty room is told it needs work', () => {
  const remark = roomRemark('bathroom', [c('shower', 3, 'mold'), c('toilet', 1)], 'es')!;
  assert.match(remark, /^El baño va a necesitar trabajo\. Lo que más va a costar es la ducha, que tiene moho/);
});

test('nothing to say means silence, not a guess', () => {
  assert.equal(roomRemark('kitchen', [], 'es'), null);
  // Not in the noun table, or seen too faintly to judge.
  assert.equal(roomRemark('kitchen', [c('knife block', 2)], 'es'), null);
  assert.equal(roomRemark('kitchen', [{ ...c('oven', 3), confidence: 0.2 }], 'es'), null);
});

test('"fridge" and "refrigerator" are one appliance', () => {
  const remark = roomRemark('kitchen', [c('fridge', 0), c('refrigerator', 2, 'stains')], 'en')!;
  assert.equal((remark.match(/the fridge/g) ?? []).length, 1);
  assert.match(remark, /the fridge, which has some stains/);
});

test('model replies are gated: dirt clamped, issues from the list, no score means no remark', () => {
  const got = coerceConditions([
    { name: 'Oven', dirt: 7, issue: 'grease' },
    { name: 'sink', dirt: 1, issue: 'the owners are messy' },
    { name: 'stove' },
    'nonsense',
  ]);
  assert.deepEqual(
    got.map(({ name, dirt, issue }) => ({ name, dirt, issue })),
    [
      { name: 'oven', dirt: 3, issue: 'grease' },
      { name: 'sink', dirt: 1, issue: undefined },
    ],
  );
  // And the scout keeps catalogue objects only.
  const scout = coerceScout({ objects: [{ name: 'oven', dirt: 2 }, { name: 'gold toilet', dirt: 3 }] });
  assert.deepEqual(scout.conditions?.map((x) => x.name), ['oven']);
});

test('every named object is in the catalogue', () => {
  for (const name of namedObjects()) assert.ok(OBJECT_TIME_COST[name], `"${name}" is not a catalogue object`);
});

/** Every remark the templates can produce, in both languages. */
function allRemarks(): string[] {
  const out: string[] = [];
  for (const lang of ['es', 'en'] as const) {
    for (const room of ROOM_TYPES) {
      for (const dirt of [0, 1, 2, 3]) {
        for (const issue of [undefined, ...ISSUES]) {
          const r = roomRemark(room, [c('oven', dirt, issue), c('sink', Math.max(0, dirt - 1))], lang);
          if (r) out.push(r);
        }
      }
    }
  }
  return [...new Set(out)];
}

test('nothing the bot says about a room can be heard back as an answer or a command', () => {
  // A remark opens the room's first question, and the next instruction. The
  // phone hears itself; a remark that contained "sí", "siguiente" or "listo"
  // would answer, skip or shoot by itself.
  const lines = [
    ...allRemarks(),
    ...Object.keys(DAMAGE).flatMap((k) => [repairPrompt([k], 'es')!, repairPrompt([k], 'en')!]),
  ];
  const commands = [...COMMANDS.es.capture, ...COMMANDS.en.capture];
  const offenders: string[] = [];
  for (const line of lines) {
    const words = normalize(line).split(' ');
    if (parseYesNo(line) !== null) offenders.push(`yes/no: ${line}`);
    if (wantsToContinue(line)) offenders.push(`continue: ${line}`);
    for (const w of commands) if (words.includes(w)) offenders.push(`"${w}": ${line}`);
  }
  assert.deepEqual(offenders, []);
  assert.ok(lines.length > 50, 'the check should be looking at real sentences');
});

test('every object asked about in Spanish is asked about in English', () => {
  assert.deepEqual(askedObjects('en').sort(), askedObjects('es').sort());
  assert.equal(promptFor('oven', 'kitchen', 'en'), 'Would you like us to clean the inside of the oven?');
  assert.equal(promptFor('sink', 'bathroom', 'en'), 'Would you like us to deep clean the bathroom sink?');
});

test('repairs are offered in English too', () => {
  assert.equal(
    repairPrompt(['cabinet', 'wall'], 'en'),
    'I can see a broken cabinet or drawer and a dent or a hole in the wall. Would you like us to contact you about fixing that as well?',
  );
});

test('the phone picks the default language, and only the default', () => {
  assert.deepEqual(phoneLanguage(['en-US', 'es-US']), { lang: 'en', primary: 'en' });
  assert.deepEqual(phoneLanguage(['es-419']), { lang: 'es', primary: 'es' });
  // A Russian phone with English as a second language: speak English, and
  // know the person's first language is Russian so the screen can say so.
  assert.deepEqual(phoneLanguage(['ru-RU', 'en-US']), { lang: 'en', primary: 'ru' });
  assert.deepEqual(phoneLanguage(['ru-RU']), { lang: null, primary: 'ru' });
  // The page's own language wins; with neither, Spanish.
  assert.equal(initialLang('en', ['es-US']), 'en');
  assert.equal(initialLang(undefined, ['en-GB']), 'en');
  assert.equal(initialLang(undefined, ['ru-RU']), 'es');
});
