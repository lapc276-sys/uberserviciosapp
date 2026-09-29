import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The walkthrough listens and speaks at the same time, on a device whose
 * speaker reaches its own microphone. That combination shipped: six
 * instructions opened with "Ahora", every confirmation said "Listo, ya puedes
 * cerrarlo", and all three of those words meant "take the shot". The step
 * fired while reading its own instruction, at whatever the camera happened to
 * face, and the bad frame became a price.
 *
 * Checked against the source text rather than by running the component,
 * because what broke was a collision between two files that were each fine on
 * their own — the command list and the spoken script. A test that renders the
 * UI would never compare them.
 */

const GUIDE = readFileSync(new URL('../lib/capture/guide.ts', import.meta.url), 'utf8');
const CAPTURE = readFileSync(new URL('../components/capture/GuidedCapture.tsx', import.meta.url), 'utf8');
const SPEECH = readFileSync(new URL('../lib/speech.ts', import.meta.url), 'utf8');

/** The command list, read out of the component so the test cannot drift. */
function captureWords(): string[] {
  const line = CAPTURE.match(/const SAY_CAPTURE = \[([^\]]*)\]/s);
  assert.ok(line, 'SAY_CAPTURE not found');
  return [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Every line the phone says out loud, from both `spoken` and `after`. */
function spokenLines(): string[] {
  return [...GUIDE.matchAll(/(?:spoken|after):\s*'((?:[^'\\]|\\.)*)'/g)].map((m) =>
    m[1].replace(/\\'/g, "'"),
  );
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('nothing the phone says can trigger the shutter', () => {
  const words = captureWords();
  const offenders: string[] = [];

  for (const line of spokenLines()) {
    const spoken = normalize(line).split(' ');
    for (const w of words) {
      if (spoken.includes(w)) offenders.push(`"${line}" contains the command "${w}"`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `The app would hear itself and fire:\n  ${offenders.join('\n  ')}`,
  );
});

test('commands are not words said by accident', () => {
  // Somebody walking a homeowner through their kitchen says these constantly
  // without addressing the app. Muting the microphone while the phone talks
  // does not help here — the person is the one saying them.
  const filler = ['ya', 'ok', 'okay', 'ahora', 'si', 'bueno', 'claro'];
  for (const w of captureWords()) {
    assert.ok(!filler.includes(w), `"${w}" is conversational filler, not a command`);
  }
});

test('the recogniser ignores itself while the phone is speaking', () => {
  assert.ok(SPEECH.includes('export function isSpeaking'), 'speech.ts must expose a speaking guard');
  assert.ok(
    /if \(isSpeaking\(\)\) return;/.test(CAPTURE),
    'the voice handler must drop results heard while the phone talks',
  );
});

test('the speaking guard expires on its own', () => {
  // `onend` does not fire reliably everywhere, and a stuck flag would kill
  // voice control for the rest of the walkthrough — a worse failure than the
  // one being fixed, and a silent one.
  assert.ok(
    SPEECH.includes('speakingUntil = Date.now() +'),
    'the guard must be a deadline, not a boolean that can stick',
  );
  assert.ok(SPEECH.includes('utterance.onerror'), 'a failed utterance must clear the guard');
});

test('voice honours the same lead-in as the shutter', () => {
  // Without this a command arriving mid-instruction shoots while somebody is
  // still walking to the next counter.
  assert.ok(
    /stepStartedAt\.current < LEAD_IN_MS/.test(CAPTURE),
    'the voice handler must respect LEAD_IN_MS',
  );
});

test('voice control still exists', () => {
  // The obvious overcorrection is muting the microphone and never unmuting.
  const words = captureWords();
  assert.ok(words.length >= 3, 'too few commands left to drive the walkthrough');
  assert.ok(words.includes('listo'), '"listo" is the documented command and must survive');
});
