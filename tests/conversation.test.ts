import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAY_CHAT,
  parseDepth,
  parseProducts,
  parseTools,
  parseWhen,
  parseYesNo,
  spokenQuestion,
  visitNote,
  wantsToContinue,
} from '../lib/capture/conversation';
import { promptFor } from '../lib/vision/upsell';
import { OBJECT_TIME_COST } from '../lib/vision/model';
import { ROOM_TYPES } from '../lib/vision/types';
import { normalize } from '../lib/vision/voice-commands';

/**
 * Answering the room questions out loud.
 *
 * The rule the parser is held to: a misheard yes adds minutes to somebody's
 * bill, so anything that is not plainly a yes or a no stays unanswered.
 */

test('plain answers are understood', () => {
  for (const yes of ['Sí', 'si', 'Sí, por favor', 'claro', 'Dale', 'vale', 'claro que sí', 'de acuerdo']) {
    assert.equal(parseYesNo(yes), true, yes);
  }
  for (const no of ['No', 'no, gracias', 'mejor no', 'claro que no', 'para nada', 'tampoco']) {
    assert.equal(parseYesNo(no), false, no);
  }
});

test('anything unclear stays unanswered', () => {
  for (const unclear of ['no sé', 'No estoy segura', 'mmm', '', 'sí, pero no el horno', 'el horno']) {
    assert.equal(parseYesNo(unclear), null, unclear);
  }
});

test('moving on is not an answer', () => {
  assert.equal(wantsToContinue('sigue'), true);
  assert.equal(wantsToContinue('Listo'), true);
  assert.equal(wantsToContinue('siguiente'), true);
  assert.equal(wantsToContinue('sí'), false);
});

test('a question said aloud carries its minutes', () => {
  // On screen the minutes are small print; spoken, they must be in the
  // sentence or a hands-free yes is a yes to a number nobody heard.
  assert.equal(
    spokenQuestion({ prompt: '¿Quieres que limpiemos el horno por dentro?', extraMinutes: 14 }),
    '¿Quieres que limpiemos el horno por dentro? Serían unos 14 minutos más.',
  );
  assert.equal(spokenQuestion({ prompt: '¿Algo?', extraMinutes: 0 }), '¿Algo?');
});

test('the bot never answers its own question', () => {
  // The speaker reaches the microphone. A question containing "sí" or "no"
  // could be heard as its own answer if the speaking guard ever slipped.
  const offenders: string[] = [];
  for (const name of Object.keys(OBJECT_TIME_COST)) {
    for (const room of ROOM_TYPES) {
      const prompt = promptFor(name, room);
      if (prompt && parseYesNo(prompt) !== null) offenders.push(prompt);
    }
  }
  for (const line of Object.values(SAY_CHAT)) {
    if (parseYesNo(line) !== null || wantsToContinue(line)) offenders.push(line);
  }
  assert.deepEqual([...new Set(offenders)], []);
  // Sanity: the check above is looking at real sentences.
  assert.ok(normalize(promptFor('oven', 'kitchen') ?? '').includes('horno'));
});

// ── The closing chat ────────────────────────────────────────────────────────

test('when: either part, both, or neither', () => {
  assert.deepEqual(parseWhen('esta semana por la mañana'), { when: 'this_week', timeOfDay: 'morning' });
  assert.deepEqual(parseWhen('La semana que viene'), { when: 'next_week' });
  assert.deepEqual(parseWhen('lo antes posible, por la tarde'), { when: 'asap', timeOfDay: 'afternoon' });
  assert.deepEqual(parseWhen('me da igual'), { timeOfDay: 'any' });
  assert.deepEqual(parseWhen('el horno'), {});
});

test('products, tools and depth are understood', () => {
  assert.equal(parseProducts('ecológicos'), 'eco');
  assert.equal(parseProducts('sin olor, por favor'), 'unscented');
  assert.equal(parseProducts('uso los míos'), 'own');
  assert.equal(parseProducts('los normales'), 'standard');
  assert.equal(parseProducts('el martes'), null);

  assert.equal(parseTools('sí, tengo'), 'customer');
  assert.equal(parseTools('No tengo'), 'bring');
  assert.equal(parseTools('tráiganlos'), 'bring');
  assert.equal(parseTools('no'), 'bring');
  assert.equal(parseTools('mmm'), null);

  assert.equal(parseDepth('a fondo'), 'deep-cleaning');
  assert.equal(parseDepth('por encima nomás'), 'house-cleaning');
  assert.equal(parseDepth('es de mudanza'), 'move-out-cleaning');
  assert.equal(parseDepth('no sé'), null);
});

test('nothing the bot says can be heard back as an answer', () => {
  // The speaking guard is a timer, and a result arriving a second after the
  // phone stops talking gets past it. "¿Por encima, a fondo o de mudanza?"
  // heard back would have booked a move-out clean.
  for (const line of Object.values(SAY_CHAT)) {
    assert.equal(parseYesNo(line), null, `yes/no: ${line}`);
    assert.equal(wantsToContinue(line), false, `continue: ${line}`);
    assert.deepEqual(parseWhen(line), {}, `when: ${line}`);
    assert.equal(parseProducts(line), null, `products: ${line}`);
    assert.equal(parseTools(line), null, `tools: ${line}`);
    assert.equal(parseDepth(line), null, `depth: ${line}`);
  }
});

test('the company gets one readable paragraph, or nothing', () => {
  assert.equal(visitNote({}), undefined);
  assert.equal(
    visitNote({ when: 'this_week', timeOfDay: 'morning', products: 'eco', tools: 'customer' }),
    'Día: esta semana, por la mañana. Productos: ecológicos. Aspiradora y trapeador: los tiene el cliente.',
  );
  assert.equal(visitNote({ when: 'date', date: '2026-12-03' }), 'Día: el jueves 3 de diciembre.');
  // Chose "Elegir día" and never picked one: say nothing rather than "el undefined".
  assert.equal(visitNote({ when: 'date' }), undefined);
  assert.equal(visitNote({ products: 'own', tools: 'bring' }), 'Productos: usa los del cliente. Aspiradora y trapeador: hay que llevarlos.');
});
