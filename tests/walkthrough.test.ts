import { describe, it, expect } from 'vitest';
import { buildWalkthrough, propertyPrompts, filmPrompts, offerPrompts, describeRoom } from '@/lib/vision/walkthrough';
import { planRoomTasks, petAwareSoil, FLOOR_EFFORT, TASK_BY_ID, TASK_CATALOG } from '@/lib/vision/tasks';
import { buildAnalysis } from '@/lib/vision/estimate';
import { priceFromAnalysis } from '@/lib/vision/pricing';
import { DEFAULT_TIME_MODEL } from '@/lib/vision/model';
import { EMPTY_SOIL, type RawRoomObservation, type SoilScores } from '@/lib/vision/types';

const soil = (p: Partial<SoilScores> = {}): SoilScores => ({ ...EMPTY_SOIL, ...p });
const TASK_CATALOG_IDS = TASK_CATALOG.map((t) => t.id);

const kitchen = (objects: string[] = ['oven', 'refrigerator']): RawRoomObservation => ({
  type: 'kitchen',
  confidence: 0.9,
  soil: soil({ grease: 50 }),
  objects: objects.map((name) => ({ name, count: 1, confidence: 0.9 })),
});

const analyze = (obs: RawRoomObservation[], serviceSlug = 'house-cleaning', extra = {}) =>
  buildAnalysis(obs, { serviceSlug, source: 'vision-llm', ...extra });

describe('customer preferences change the plan', () => {
  const plan = (preferences?: Parameters<typeof planRoomTasks>[0]['preferences']) =>
    planRoomTasks({
      roomType: 'kitchen',
      soil: soil({ grease: 50 }),
      objects: [{ name: 'oven', count: 1, confidence: 0.9 }],
      serviceSlug: 'house-cleaning',
      preferences,
    });

  it('leaves deep-only work off a standard visit by default', () => {
    expect(plan().lines.map((l) => l.id)).not.toContain('oven_interior');
  });

  /** The point of asking: saying yes has to actually add the work and the time. */
  it('adds work the customer explicitly asked for', () => {
    const requested = plan({ requested: ['oven_interior'] });
    expect(requested.lines.map((l) => l.id)).toContain('oven_interior');
    expect(requested.totalMinutes).toBeGreaterThan(plan().totalMinutes);
  });

  it('removes work the customer declined', () => {
    const declined = plan({ declined: ['mop'] });
    expect(declined.lines.map((l) => l.id)).not.toContain('mop');
    expect(declined.totalMinutes).toBeLessThan(plan().totalMinutes);
  });

  /**
   * If both answers arrive the customer changed their mind, and the safe
   * reading of an ambiguous answer is the one that does not bill for work
   * somebody may not want.
   */
  it('lets declining win over requesting', () => {
    const both = plan({ requested: ['oven_interior'], declined: ['oven_interior'] });
    expect(both.lines.map((l) => l.id)).not.toContain('oven_interior');
  });

  it('will not put a request in a room where it makes no sense', () => {
    const bathroom = planRoomTasks({
      roomType: 'bathroom',
      soil: soil(),
      objects: [],
      serviceSlug: 'house-cleaning',
      preferences: { requested: ['oven_interior'] },
    });
    expect(bathroom.lines.map((l) => l.id)).not.toContain('oven_interior');
  });

  it('honours a request even with no object detected, since the customer knows their home', () => {
    const noOvenSeen = planRoomTasks({
      roomType: 'kitchen',
      soil: soil(),
      objects: [],
      serviceSlug: 'house-cleaning',
      preferences: { requested: ['oven_interior'] },
    });
    expect(noOvenSeen.lines.map((l) => l.id)).toContain('oven_interior');
  });

  it('carries preferences all the way through to the price', () => {
    const taskModel = { ...DEFAULT_TIME_MODEL, estimator: 'task' as const };
    const base = analyze([kitchen()], 'house-cleaning', { model: taskModel });
    const withOven = analyze([kitchen()], 'house-cleaning', {
      model: taskModel,
      preferences: { requested: ['oven_interior'] },
    });

    const basePrice = priceFromAnalysis(base, { serviceSlug: 'house-cleaning' });
    const ovenPrice = priceFromAnalysis(withOven, { serviceSlug: 'house-cleaning' });
    expect(ovenPrice.low).toBeGreaterThan(basePrice.low);
  });
});

describe('property context', () => {
  const planWith = (property?: Parameters<typeof planRoomTasks>[0]['property']) =>
    planRoomTasks({
      roomType: 'living_room',
      soil: soil({ dust: 40 }),
      objects: [],
      serviceSlug: 'house-cleaning',
      property,
    });

  it('costs more time on carpet than on vinyl', () => {
    const vinyl = planWith({ floorTypes: ['vinyl'] });
    const carpet = planWith({ floorTypes: ['carpet'] });
    const vacuumVinyl = vinyl.lines.find((l) => l.id === 'vacuum')!.minutes;
    const vacuumCarpet = carpet.lines.find((l) => l.id === 'vacuum')!.minutes;
    expect(vacuumCarpet / vacuumVinyl).toBeCloseTo(FLOOR_EFFORT.carpet, 1);
  });

  /**
   * The crew still has to vacuum the carpeted half, so averaging would quote a
   * mixed home as if all of it were the faster surface.
   */
  it('lets the slowest surface govern a mixed home', () => {
    const mixed = planWith({ floorTypes: ['vinyl', 'carpet'] });
    const carpetOnly = planWith({ floorTypes: ['carpet'] });
    expect(mixed.totalMinutes).toBe(carpetOnly.totalMinutes);
  });

  it('does not scale non-floor work by the floor type', () => {
    const dustVinyl = planWith({ floorTypes: ['vinyl'] }).lines.find((l) => l.id === 'dust_surfaces')!.minutes;
    const dustCarpet = planWith({ floorTypes: ['carpet'] }).lines.find((l) => l.id === 'dust_surfaces')!.minutes;
    expect(dustCarpet).toBe(dustVinyl);
  });

  it('leaves the estimate alone when nothing was declared', () => {
    expect(planWith().totalMinutes).toBe(planWith({}).totalMinutes);
  });

  describe('pets', () => {
    /**
     * A declared pet beats the footage. The animal is usually not in shot and
     * hair is nearly invisible in a dim phone frame, so a low hair score in a
     * home with a dog is more likely a missed read than a clean floor.
     */
    it('raises the hair floor when a pet is declared', () => {
      const clean = soil({ hair: 0 });
      expect(petAwareSoil(clean, { pets: ['dog'] }).hair).toBeGreaterThan(0);
    });

    it('never lowers an observed hair score', () => {
      const seen = soil({ hair: 80 });
      expect(petAwareSoil(seen, { pets: ['cat'] }).hair).toBe(80);
    });

    it('changes nothing when there are no pets', () => {
      const s = soil({ hair: 10 });
      expect(petAwareSoil(s, { pets: [] })).toEqual(s);
      expect(petAwareSoil(s, undefined)).toEqual(s);
    });

    it('makes a home with a dog cost more than the same home without', () => {
      const without = analyze([{ type: 'living_room', confidence: 0.9, soil: soil({ hair: 5 }), objects: [] }]);
      const withDog = analyze([{ type: 'living_room', confidence: 0.9, soil: soil({ hair: 5 }), objects: [] }], 'house-cleaning', {
        property: { pets: ['dog'] },
      });
      expect(withDog.estimatorMinutes.task).toBeGreaterThan(without.estimatorMinutes.task);
    });
  });
});

describe('the guided script', () => {
  it('asks about floors and pets, which the camera reads badly', () => {
    const ids = propertyPrompts().map((p) => p.id);
    expect(ids).toContain('floors');
    expect(ids).toContain('pets');
  });

  it('asks everything in Spanish first', () => {
    for (const prompt of propertyPrompts()) {
      expect(prompt.questionEs.length).toBeGreaterThan(0);
      expect(prompt.questionEs).not.toBe(prompt.question);
    }
  });

  it('asks for a second look inside things it saw', () => {
    const prompts = filmPrompts(analyze([kitchen(['oven'])]));
    expect(prompts.map((p) => p.taskId)).toContain('oven_interior');
    expect(prompts[0].kind).toBe('film');
  });

  it('does not ask to open an oven it never saw', () => {
    const prompts = filmPrompts(analyze([kitchen([])]));
    expect(prompts.map((p) => p.taskId)).not.toContain('oven_interior');
  });

  /** A walkthrough that stops the customer eight times does not get finished. */
  it('caps how many times it interrupts', () => {
    expect(filmPrompts(analyze([kitchen(['oven', 'microwave', 'refrigerator', 'shower'])])).length).toBeLessThanOrEqual(3);
  });

  it('offers optional work for things it detected', () => {
    const offers = offerPrompts(analyze([kitchen(['oven'])]), 'house-cleaning').map((o) => o.taskId);
    expect(offers).toContain('oven_interior');
  });

  /**
   * Offering work the service already covers implies an extra charge for
   * something the customer is already paying for.
   */
  it('does not offer what a deep clean already includes', () => {
    const offers = offerPrompts(analyze([kitchen(['oven'])], 'deep-cleaning'), 'deep-cleaning').map((o) => o.taskId);
    expect(offers).not.toContain('baseboards');
  });

  it('quotes the added minutes so a yes is an informed one', () => {
    for (const offer of offerPrompts(analyze([kitchen(['oven'])]), 'house-cleaning')) {
      expect(offer.helpEs).toMatch(/\d+/);
      expect(TASK_BY_ID[offer.taskId!]).toBeTruthy();
    }
  });

  it('stops asking about the home once it has been told', () => {
    const plan = buildWalkthrough(analyze([kitchen()]), 'house-cleaning', { askProperty: false });
    expect(plan.property).toHaveLength(0);
  });
});

describe('describeRoom', () => {
  it('names the two worst problems in plain words', () => {
    const analysis = analyze([{ type: 'kitchen', confidence: 0.9, soil: soil({ grease: 80, clutter: 60 }), objects: [] }]);
    const said = describeRoom(analysis.rooms[0]);
    expect(said.es).toMatch(/grasa/);
    expect(said.en).toMatch(/grease/);
  });

  it('says a clean room is clean', () => {
    const analysis = analyze([{ type: 'bedroom', confidence: 0.9, soil: soil(), objects: [] }]);
    expect(describeRoom(analysis.rooms[0]).es).toMatch(/buen estado/);
  });

  /**
   * A number spoken mid-walk that disagrees with the final quote is exactly the
   * surprise the product exists to avoid, so the read-back never states one.
   */
  it('never states a time or a price', () => {
    const analysis = analyze([{ type: 'kitchen', confidence: 0.9, soil: soil({ grease: 90 }), objects: [] }]);
    const said = describeRoom(analysis.rooms[0]);
    expect(said.es).not.toMatch(/\$|\bmin\b|minuto/);
    expect(said.en).not.toMatch(/\$|\bmin\b|minute/);
  });
});

/**
 * The regression this guards: all of the walkthrough's inputs live in the task
 * catalog, so under the default room estimator a customer could answer
 * "carpet, a dog, and please clean the oven" and be quoted exactly the same
 * price as someone who answered nothing. A question whose answer changes
 * nothing is worse than not asking it.
 */
describe('answers move the price under the default estimator', () => {
  const room = (): RawRoomObservation => ({
    type: 'kitchen',
    confidence: 0.9,
    soil: soil({ grease: 40, dust: 30 }),
    objects: [{ name: 'oven', count: 1, confidence: 0.9 }],
  });

  const minutes = (extra = {}) => analyze([room()], 'house-cleaning', extra).totalMinutes;

  it('uses the room estimator by default', () => {
    expect(analyze([room()]).estimator).toBe('room');
  });

  it('costs more on carpet', () => {
    expect(minutes({ property: { floorTypes: ['carpet'] } })).toBeGreaterThan(minutes());
  });

  it('costs more with a pet', () => {
    expect(minutes({ property: { pets: ['dog'] } })).toBeGreaterThan(minutes());
  });

  it('costs more when the oven interior is requested', () => {
    expect(minutes({ preferences: { requested: ['oven_interior'] } })).toBeGreaterThan(minutes());
  });

  it('costs less when work is declined', () => {
    expect(minutes({ preferences: { declined: ['mop'] } })).toBeLessThan(minutes());
  });

  it('never falls to zero or below, however much is declined', () => {
    const stripped = minutes({
      preferences: { declined: TASK_CATALOG_IDS },
    });
    expect(stripped).toBeGreaterThan(0);
  });
});
