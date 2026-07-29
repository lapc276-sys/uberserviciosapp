import { describe, it, expect } from 'vitest';
import { parseVoiceCommand, parseNumber, normalize } from '@/lib/vision/voice-commands';

/**
 * Hands-free correction in the field.
 *
 * This parser is the only interface between a cleaner wearing wet gloves and
 * the training data. If it silently misreads "grasa ochenta" as something else,
 * the sample is not just lost — it is *wrong*, and a wrong label is worse than
 * no label. Hence the emphasis below on refusing to guess.
 */

describe('normalize', () => {
  it('strips accents so "baño" and "bano" are the same word', () => {
    expect(normalize('Baño')).toBe(normalize('bano'));
  });

  it('strips inverted punctuation that Spanish speech recognition emits', () => {
    expect(normalize('¿Cocina, grasa?')).toBe('cocina grasa');
  });

  it('collapses repeated whitespace', () => {
    expect(normalize('  grasa    ochenta  ')).toBe('grasa ochenta');
  });
});

describe('parseNumber', () => {
  it('reads digits', () => {
    expect(parseNumber('grasa 80')).toBe(80);
  });

  it('reads Spanish number words', () => {
    expect(parseNumber('ochenta')).toBe(80);
    expect(parseNumber('quince')).toBe(15);
    expect(parseNumber('cien')).toBe(100);
  });

  it('reads English number words', () => {
    expect(parseNumber('eighty')).toBe(80);
    expect(parseNumber('fifteen')).toBe(15);
  });

  it('reads compound numbers in both languages', () => {
    expect(parseNumber('ochenta y cinco')).toBe(85);
    expect(parseNumber('eighty five')).toBe(85);
  });

  it('reads the contracted twenties speech recognition returns as one word', () => {
    expect(parseNumber('veinticinco')).toBe(25);
  });

  it('returns null when there is no number, rather than defaulting to zero', () => {
    expect(parseNumber('grasa')).toBeNull();
  });
});

describe('parseVoiceCommand', () => {
  it('sets a dimension from Spanish', () => {
    expect(parseVoiceCommand('grasa ochenta')).toEqual({ kind: 'set', dimension: 'grease', value: 80, roomType: undefined });
  });

  it('sets a dimension from English', () => {
    expect(parseVoiceCommand('grease eighty')).toMatchObject({ kind: 'set', dimension: 'grease', value: 80 });
  });

  it('accepts a mixed-language phrase, which is how people actually speak on the job', () => {
    expect(parseVoiceCommand('kitchen grasa 80')).toMatchObject({
      kind: 'set',
      dimension: 'grease',
      value: 80,
      roomType: 'kitchen',
    });
  });

  it('targets a named room', () => {
    expect(parseVoiceCommand('cocina moho 30')).toMatchObject({
      kind: 'set',
      dimension: 'mold',
      value: 30,
      roomType: 'kitchen',
    });
  });

  it('understands an accented room name', () => {
    expect(parseVoiceCommand('baño moho cuarenta')).toMatchObject({
      kind: 'set',
      dimension: 'mold',
      value: 40,
      roomType: 'bathroom',
    });
  });

  /**
   * An out-of-range number is far more likely to be a speech-recognition slip
   * than a real intent — "500" when the person said "cincuenta". Clamping it to
   * 100 would silently record maximum filth; rejecting it makes them repeat
   * themselves, which costs three seconds and keeps the label true.
   */
  it('rejects an out-of-range value instead of clamping it to a plausible-looking one', () => {
    expect(parseVoiceCommand('polvo 500').kind).toBe('unknown');
  });

  it('accepts the full valid range at both ends', () => {
    expect(parseVoiceCommand('polvo 0')).toMatchObject({ kind: 'set', dimension: 'dust', value: 0 });
    expect(parseVoiceCommand('polvo 100')).toMatchObject({ kind: 'set', dimension: 'dust', value: 100 });
  });

  it('handles navigation', () => {
    expect(parseVoiceCommand('siguiente').kind).toBe('next');
    expect(parseVoiceCommand('next').kind).toBe('next');
    expect(parseVoiceCommand('anterior').kind).toBe('prev');
    expect(parseVoiceCommand('listo').kind).toBe('done');
    expect(parseVoiceCommand('borrar').kind).toBe('remove');
  });

  it('clears a whole room', () => {
    expect(parseVoiceCommand('todo limpio').kind).toBe('clearRoom');
    expect(parseVoiceCommand('cocina impecable')).toMatchObject({ kind: 'clearRoom', roomType: 'kitchen' });
  });

  /**
   * "manchas limpio" names a dimension, so it must not be read as "wipe the
   * entire room clean" — that would silently discard every other score the
   * person already recorded.
   */
  it('does not clear the room when a specific dimension was named', () => {
    expect(parseVoiceCommand('manchas limpio').kind).not.toBe('clearRoom');
  });

  it('refuses to guess a value when a dimension is named without a number', () => {
    expect(parseVoiceCommand('grasa').kind).toBe('unknown');
  });

  it('returns what it heard on nonsense, so the UI can show it back', () => {
    const result = parseVoiceCommand('the weather is nice today');
    expect(result).toMatchObject({ kind: 'unknown', heard: 'the weather is nice today' });
  });

  it('handles empty input', () => {
    expect(parseVoiceCommand('').kind).toBe('unknown');
    expect(parseVoiceCommand('   ').kind).toBe('unknown');
  });
});
