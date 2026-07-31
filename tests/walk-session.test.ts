import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOME_SHAPE,
  buildRoomQueue,
  captureInstruction,
  startSession,
  progress,
  completeRoom,
  inferFromObjects,
  adviseOnQuality,
  DARK_FRAME_THRESHOLD,
  type HomeShape,
} from '@/lib/vision/walk-session';
import { buildAnalysis } from '@/lib/vision/estimate';
import { EMPTY_SOIL, type RawRoomObservation } from '@/lib/vision/types';

const shape = (over: Partial<HomeShape> = {}): HomeShape => ({ ...DEFAULT_HOME_SHAPE, ...over });

const analysisWith = (objects: string[]) =>
  buildAnalysis(
    [
      {
        type: 'living_room',
        confidence: 0.9,
        soil: { ...EMPTY_SOIL },
        objects: objects.map((name) => ({ name, count: 1, confidence: 0.9 })),
      } as RawRoomObservation,
    ],
    { serviceSlug: 'house-cleaning', source: 'vision-llm' },
  );

describe('buildRoomQueue', () => {
  it('covers a one-bedroom home', () => {
    const queue = buildRoomQueue(shape());
    expect(queue.map((r) => r.type)).toEqual(['kitchen', 'living_room', 'bedroom', 'bathroom']);
  });

  /**
   * The kitchen carries the most variance and the most follow-up questions, so
   * it is asked while the customer is still fresh rather than eighth.
   */
  it('starts with the kitchen', () => {
    expect(buildRoomQueue(shape({ bedrooms: 3 }))[0].type).toBe('kitchen');
  });

  it('creates one entry per bedroom and bathroom', () => {
    const queue = buildRoomQueue(shape({ bedrooms: 3, bathrooms: 2 }));
    expect(queue.filter((r) => r.type === 'bedroom')).toHaveLength(3);
    expect(queue.filter((r) => r.type === 'bathroom')).toHaveLength(2);
  });

  it('numbers repeated rooms so the customer knows which one', () => {
    const labels = buildRoomQueue(shape({ bathrooms: 2 }))
      .filter((r) => r.type === 'bathroom')
      .map((r) => r.labelEs);
    expect(labels).toEqual(['El baño 1', 'El baño 2']);
  });

  it('does not number a room there is only one of', () => {
    const bedroom = buildRoomQueue(shape({ bedrooms: 1 })).find((r) => r.type === 'bedroom')!;
    expect(bedroom.labelEs).toBe('El cuarto');
  });

  it('adds optional spaces only when they exist', () => {
    const plain = buildRoomQueue(shape()).map((r) => r.type);
    expect(plain).not.toContain('stairs');
    expect(plain).not.toContain('garage');

    const big = buildRoomQueue(shape({ hasStairs: true, hasGarage: true, hasPatio: true })).map((r) => r.type);
    expect(big).toContain('stairs');
    expect(big).toContain('garage');
    expect(big).toContain('patio');
  });

  it('leaves circulation and outdoor space for last', () => {
    const queue = buildRoomQueue(shape({ hasStairs: true, hasPatio: true })).map((r) => r.type);
    expect(queue.indexOf('kitchen')).toBeLessThan(queue.indexOf('stairs'));
    expect(queue.indexOf('stairs')).toBeLessThan(queue.indexOf('patio'));
  });

  it('clamps absurd room counts', () => {
    expect(buildRoomQueue(shape({ bedrooms: 500 })).filter((r) => r.type === 'bedroom').length).toBeLessThanOrEqual(10);
  });

  it('survives a home with nothing in it', () => {
    const empty = buildRoomQueue(shape({ bedrooms: 0, bathrooms: 0, hasKitchen: false, hasLivingRoom: false }));
    expect(empty).toEqual([]);
  });
});

describe('capture instructions', () => {
  /**
   * "Film your kitchen" produces a shot of the floor and a thumb. Naming the
   * surfaces that carry the minutes is what makes the footage usable.
   */
  it('names the surfaces that matter in a kitchen', () => {
    const instruction = captureInstruction('kitchen', 'La cocina', 'Kitchen');
    expect(instruction.bodyEs).toMatch(/mesones|estufa/i);
    expect(instruction.body).toMatch(/counters|stove/i);
  });

  it('tells the customer how to move the phone', () => {
    expect(captureInstruction('living_room', 'La sala', 'Living room').bodyEs).toMatch(/despacio/i);
  });

  /**
   * Without this, the second bedroom is announced exactly like the first and
   * someone halfway through a house cannot tell which room the app is on —
   * which gets two sweeps of one room and none of another.
   */
  it('announces the room by its own numbered label, not the script default', () => {
    const second = captureInstruction('bedroom', 'El cuarto 2', 'Bedroom 2');
    expect(second.titleEs).toBe('El cuarto 2');
    expect(second.title).toBe('Bedroom 2');
    // The filming advice still comes from the bedroom script.
    expect(second.bodyEs).toMatch(/cama/i);
  });

  it('falls back to a generic sweep for rooms with no script', () => {
    const instruction = captureInstruction('garage', 'El garaje', 'Garage');
    expect(instruction.titleEs).toBe('El garaje');
    expect(instruction.bodyEs.length).toBeGreaterThan(0);
    expect(instruction.seconds).toBeGreaterThan(0);
  });
});

describe('session progress', () => {
  it('starts on the first room', () => {
    const p = progress(startSession(shape()));
    expect(p.stage).toBe('capture');
    expect(p.room?.type).toBe('kitchen');
    expect(p.percent).toBe(0);
  });

  it('says what is coming next, so the walk feels finite', () => {
    const p = progress(startSession(shape()));
    expect(p.nextUpEs).toMatch(/sala/i);
  });

  it('tells the customer when they are on the last room', () => {
    let session = startSession(shape({ bedrooms: 0, bathrooms: 0, hasLivingRoom: false }));
    expect(progress(session).nextUpEs).toMatch(/último/i);
  });

  it('advances as rooms are captured', () => {
    let session = startSession(shape());
    const total = session.queue.length;

    session = completeRoom(session, { type: 'kitchen', label: 'Kitchen', labelEs: 'La cocina', frameCount: 8 });
    const p = progress(session);
    expect(p.done).toBe(1);
    expect(p.percent).toBe(Math.round((1 / total) * 100));
    expect(p.room?.type).toBe('living_room');
  });

  it('reaches review once every room is done', () => {
    let session = startSession(shape());
    for (const room of session.queue) {
      session = completeRoom(session, { ...room, frameCount: 8 });
    }
    const p = progress(session);
    expect(p.stage).toBe('review');
    expect(p.percent).toBe(100);
  });

  it('asks for the shape first when there is nothing to walk', () => {
    const empty = startSession(shape({ bedrooms: 0, bathrooms: 0, hasKitchen: false, hasLivingRoom: false }));
    expect(progress(empty).stage).toBe('shape');
  });
});

describe('inferring from what was seen', () => {
  /**
   * A litter box is worth more than its own cleaning time: it means cat hair on
   * every soft surface in the home, whether or not a cat was in frame.
   */
  it('infers a cat from a litter box', () => {
    const result = inferFromObjects([{ name: 'litter box', count: 1, confidence: 0.9 }]);
    expect(result.pets).toContain('cat');
  });

  it('infers a dog from a leash or a bowl', () => {
    expect(inferFromObjects([{ name: 'leash', count: 1, confidence: 0.8 }]).pets).toContain('dog');
    expect(inferFromObjects([{ name: 'dog bowl', count: 1, confidence: 0.8 }]).pets).toContain('dog');
  });

  it('infers children from their things', () => {
    expect(inferFromObjects([{ name: 'high chair', count: 1, confidence: 0.8 }]).children).toBe(true);
  });

  /** Inferring is fair; inferring silently is not. */
  it('always carries the evidence that produced the inference', () => {
    const result = inferFromObjects([{ name: 'litter box', count: 1, confidence: 0.9 }]);
    expect(result.reasonsEs.join(' ')).toMatch(/litter box/);
    expect(result.reasons.length).toBe(result.reasonsEs.length);
  });

  it('infers nothing from an ordinary room', () => {
    const result = inferFromObjects([{ name: 'sofa', count: 1, confidence: 0.9 }]);
    expect(result.pets).toEqual([]);
    expect(result.children).toBe(false);
    expect(result.reasonsEs).toEqual([]);
  });

  it('matches names case-insensitively and with padding', () => {
    expect(inferFromObjects([{ name: '  Litter Box ', count: 1, confidence: 1 }]).pets).toContain('cat');
  });

  it('carries a pet found in one room across the whole session', () => {
    let session = startSession(shape());
    session = completeRoom(session, {
      type: 'kitchen',
      label: 'Kitchen',
      labelEs: 'La cocina',
      frameCount: 8,
      analysis: analysisWith(['litter box']),
    });
    expect(session.pets).toContain('cat');
  });
});

describe('frame quality advice', () => {
  /**
   * The failure this catches: a dim frame flattens grease and mildew into
   * shadow, the model reports a suspiciously clean room, and the customer gets
   * a confident low quote. Nothing looks wrong until the crew arrives.
   */
  it('offers the torch when the room is too dark', () => {
    const advice = adviseOnQuality({ meanBrightness: 30, tooDark: true, darkShare: 0.8 })!;
    expect(advice.suggestTorch).toBe(true);
    expect(advice.messageEs).toMatch(/oscuro/i);
    expect(advice.messageEs).toMatch(/luz|linterna/i);
  });

  it('stays quiet on a well-lit room', () => {
    expect(adviseOnQuality({ meanBrightness: 140, tooDark: false, darkShare: 0 })).toBeNull();
  });

  it('sets the darkness threshold somewhere a phone can actually reach', () => {
    expect(DARK_FRAME_THRESHOLD).toBeGreaterThan(0);
    expect(DARK_FRAME_THRESHOLD).toBeLessThan(128);
  });
});
