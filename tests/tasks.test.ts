import { describe, it, expect } from 'vitest';
import {
  TASK_CATALOG,
  TASK_BY_ID,
  SOIL_LEVELS,
  planRoomTasks,
  taskMinutesAt,
  taskMinutesByLevel,
  tasksForRoom,
  catalogCoversEveryRoom,
} from '@/lib/vision/tasks';
import { buildAnalysis } from '@/lib/vision/estimate';
import { DEFAULT_TIME_MODEL } from '@/lib/vision/model';
import { EMPTY_SOIL, ROOM_TYPES, type SoilScores, type RawRoomObservation } from '@/lib/vision/types';

const soil = (partial: Partial<SoilScores> = {}): SoilScores => ({ ...EMPTY_SOIL, ...partial });

const plan = (roomType: RawRoomObservation['type'], s: Partial<SoilScores> = {}, opts: Partial<Parameters<typeof planRoomTasks>[0]> = {}) =>
  planRoomTasks({ roomType, soil: soil(s), objects: [], serviceSlug: 'house-cleaning', ...opts });

describe('task catalog integrity', () => {
  it('gives every room type at least one task', () => {
    expect(catalogCoversEveryRoom()).toBe(true);
    for (const room of ROOM_TYPES) {
      expect(tasksForRoom(room).length, `${room} has no tasks`).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = TASK_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keys the lookup to the task id', () => {
    for (const [id, task] of Object.entries(TASK_BY_ID)) expect(task.id).toBe(id);
  });

  it('labels every task in both languages, since the field is bilingual', () => {
    for (const task of TASK_CATALOG) {
      expect(task.label.trim().length, `${task.id} missing English label`).toBeGreaterThan(0);
      expect(task.labelEs.trim().length, `${task.id} missing Spanish label`).toBeGreaterThan(0);
      expect(task.labelEs, `${task.id} Spanish label is a copy of the English`).not.toBe(task.label);
    }
  });

  it('gives every task positive base minutes', () => {
    for (const task of TASK_CATALOG) expect(task.baseMinutes, task.id).toBeGreaterThan(0);
  });

  it('pairs a soil driver with soil minutes, so a declared driver actually does something', () => {
    for (const task of TASK_CATALOG) {
      if (task.driver) expect(task.soilMinutes, `${task.id} declares a driver but no soil minutes`).toBeGreaterThan(0);
      if (task.soilMinutes) expect(task.driver, `${task.id} has soil minutes but no driver`).toBeTruthy();
    }
  });

  it('references only real room types', () => {
    for (const task of TASK_CATALOG) {
      for (const room of task.rooms) expect(ROOM_TYPES, `${task.id}`).toContain(room);
    }
  });
});

describe('taskMinutesAt', () => {
  const stovetop = TASK_BY_ID.stovetop;

  it('returns the base at pristine', () => {
    expect(taskMinutesAt(stovetop, 0)).toBe(stovetop.baseMinutes);
  });

  it('returns base plus the full soil cost at 100', () => {
    expect(taskMinutesAt(stovetop, 100)).toBeCloseTo(stovetop.baseMinutes + stovetop.soilMinutes!, 1);
  });

  it('scales linearly in between', () => {
    expect(taskMinutesAt(stovetop, 50)).toBeCloseTo(stovetop.baseMinutes + stovetop.soilMinutes! / 2, 1);
  });

  it('clamps out-of-range scores', () => {
    expect(taskMinutesAt(stovetop, -50)).toBe(taskMinutesAt(stovetop, 0));
    expect(taskMinutesAt(stovetop, 999)).toBe(taskMinutesAt(stovetop, 100));
  });

  it('ignores soil for tasks that have no driver', () => {
    const restock = TASK_BY_ID.bath_restock;
    expect(taskMinutesAt(restock, 100)).toBe(restock.baseMinutes);
  });

  it('publishes a minutes-per-level table for every reference level', () => {
    const table = taskMinutesByLevel(stovetop);
    expect(Object.keys(table)).toEqual(SOIL_LEVELS.map((l) => l.key));
    expect(table.severe).toBeGreaterThan(table.pristine);
    expect(table.moderate).toBeGreaterThan(table.light);
  });
});

describe('planRoomTasks', () => {
  it('plans the obvious chores for a plain bedroom', () => {
    const ids = plan('bedroom').lines.map((l) => l.id);
    expect(ids).toContain('vacuum');
    expect(ids).toContain('dust_surfaces');
    expect(ids).toContain('mop');
  });

  it('does not plan kitchen work in a bathroom', () => {
    const ids = plan('bathroom').lines.map((l) => l.id);
    expect(ids).not.toContain('stovetop');
    expect(ids).not.toContain('dishes');
  });

  it('costs more as soil rises', () => {
    expect(plan('kitchen', { grease: 90 }).totalMinutes).toBeGreaterThan(plan('kitchen').totalMinutes);
  });

  describe('threshold-gated tasks', () => {
    it('skips mildew treatment in a dry bathroom and adds it in a mouldy one', () => {
      expect(plan('bathroom').lines.map((l) => l.id)).not.toContain('grout_mold');
      expect(plan('bathroom', { mold: 60 }).lines.map((l) => l.id)).toContain('grout_mold');
    });

    it('skips pet-hair work unless there is pet hair', () => {
      expect(plan('living_room').lines.map((l) => l.id)).not.toContain('pet_hair');
      expect(plan('living_room', { hair: 70 }).lines.map((l) => l.id)).toContain('pet_hair');
    });
  });

  describe('object-gated tasks', () => {
    /**
     * The rule that keeps quotes honest: work is only priced when the footage
     * showed the thing. Assuming every bathroom has a tub bills for scrubbing
     * that may not exist.
     */
    it('does not price an oven that was never seen', () => {
      expect(plan('kitchen', { grease: 80 }).lines.map((l) => l.id)).not.toContain('stovetop');
    });

    it('prices it once it is detected', () => {
      const withOven = plan('kitchen', { grease: 80 }, { objects: [{ name: 'oven', count: 1, confidence: 0.9 }] });
      expect(withOven.lines.map((l) => l.id)).toContain('stovetop');
    });

    it('matches object names case-insensitively and with padding', () => {
      const messy = plan('bathroom', {}, { objects: [{ name: '  ToILet ', count: 1, confidence: 1 }] });
      expect(messy.lines.map((l) => l.id)).toContain('toilet');
    });
  });

  describe('service scope', () => {
    it('leaves deep-only work off a standard visit', () => {
      const ids = plan('kitchen', { grease: 90 }, { objects: [{ name: 'oven', count: 1, confidence: 1 }] }).lines.map(
        (l) => l.id,
      );
      expect(ids).not.toContain('oven_interior');
      expect(ids).not.toContain('baseboards');
    });

    it('includes it on a deep clean', () => {
      const ids = plan(
        'kitchen',
        { grease: 90 },
        { serviceSlug: 'deep-cleaning', objects: [{ name: 'oven', count: 1, confidence: 1 }] },
      ).lines.map((l) => l.id);
      expect(ids).toContain('oven_interior');
      expect(ids).toContain('baseboards');
    });

    it('restricts construction dust to post-construction work', () => {
      expect(plan('living_room', { dust: 90 }).lines.map((l) => l.id)).not.toContain('construction_dust');
      expect(
        plan('living_room', { dust: 90 }, { serviceSlug: 'post-construction-cleaning' }).lines.map((l) => l.id),
      ).toContain('construction_dust');
    });
  });

  it('reports the driving dimension and its score, so the field can sanity-check the number', () => {
    const line = plan('kitchen', { grease: 70 }).lines.find((l) => l.id === 'counters')!;
    expect(line.driver).toBe('grease');
    expect(line.driverScore).toBe(70);
  });

  it('totals to the sum of its lines', () => {
    const p = plan('kitchen', { grease: 60, clutter: 40 });
    expect(p.totalMinutes).toBeCloseTo(
      p.lines.reduce((s, l) => s + l.minutes, 0),
      1,
    );
  });

  it('orders tasks the way the work is done — clearing before dusting before floors', () => {
    const ids = plan('living_room', { clutter: 50, dust: 50 }).lines.map((l) => l.id);
    expect(ids.indexOf('declutter')).toBeLessThan(ids.indexOf('dust_surfaces'));
    expect(ids.indexOf('dust_surfaces')).toBeLessThan(ids.indexOf('mop'));
  });
});

describe('the estimator seam', () => {
  const rooms: RawRoomObservation[] = [
    { type: 'kitchen', confidence: 0.9, soil: soil({ grease: 60 }), objects: [{ name: 'oven', count: 1, confidence: 1 }] },
    { type: 'bathroom', confidence: 0.9, soil: soil({ mold: 40 }), objects: [{ name: 'toilet', count: 1, confidence: 1 }] },
  ];

  it('attaches a task checklist to every room', () => {
    const analysis = buildAnalysis(rooms, { serviceSlug: 'house-cleaning', source: 'vision-llm' });
    for (const room of analysis.rooms) expect(room.tasks.length).toBeGreaterThan(0);
  });

  it('reports both estimators regardless of which one is active', () => {
    const analysis = buildAnalysis(rooms, { serviceSlug: 'house-cleaning', source: 'vision-llm' });
    expect(analysis.estimatorMinutes.room).toBeGreaterThan(0);
    expect(analysis.estimatorMinutes.task).toBeGreaterThan(0);
  });

  it('defaults to the room model, which is the one that has quoted real work', () => {
    const analysis = buildAnalysis(rooms, { serviceSlug: 'house-cleaning', source: 'vision-llm' });
    expect(analysis.estimator).toBe('room');
    expect(analysis.totalMinutes).toBe(analysis.estimatorMinutes.room);
  });

  it('prices from the task model when a market opts in', () => {
    const analysis = buildAnalysis(rooms, {
      serviceSlug: 'house-cleaning',
      source: 'vision-llm',
      model: { ...DEFAULT_TIME_MODEL, estimator: 'task' },
    });
    expect(analysis.estimator).toBe('task');
    expect(analysis.totalMinutes).toBe(analysis.estimatorMinutes.task);
  });

  /**
   * Not a correctness requirement — a smoke alarm, and one that has already
   * gone off once. The first version of the catalog charged every generic chore
   * at full price in every room, which made a hallway cost as much to dust as a
   * living room and put the task estimate at nearly 3× the room estimate.
   *
   * Deliberately checked across shapes of job rather than on one example: a
   * single scenario passed that broken version by luck.
   */
  it.each([
    ['clean small apartment', ['kitchen', 'bathroom', 'bedroom', 'living_room'], 'house-cleaning'],
    ['dirty family house', ['kitchen', 'bathroom', 'bathroom', 'bedroom', 'bedroom', 'living_room', 'hallway'], 'house-cleaning'],
    ['deep move-out', ['kitchen', 'bathroom', 'bedroom', 'living_room', 'stairs'], 'move-out-cleaning'],
    ['circulation only', ['hallway', 'stairs'], 'house-cleaning'],
  ] as const)('keeps both estimators within a factor of two — %s', (_name, roomTypes, serviceSlug) => {
    const observations: RawRoomObservation[] = roomTypes.map((type) => ({
      type,
      confidence: 0.9,
      soil: soil({ dust: 40, clutter: 30, grease: 30, stains: 30 }),
      objects: [],
    }));

    const analysis = buildAnalysis(observations, { serviceSlug, source: 'vision-llm' });
    const ratio = analysis.estimatorMinutes.task / analysis.estimatorMinutes.room;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it('scales generic chores by room size but leaves room-specific work alone', () => {
    const dustIn = (type: RawRoomObservation['type']) =>
      planRoomTasks({ roomType: type, soil: soil({ dust: 50 }), objects: [], serviceSlug: 'house-cleaning' }).lines.find(
        (l) => l.id === 'dust_surfaces',
      )!.minutes;

    expect(dustIn('hallway')).toBeLessThan(dustIn('living_room'));

    // A toilet takes what it takes, however large the bathroom.
    const toilet = planRoomTasks({
      roomType: 'bathroom',
      soil: soil(),
      objects: [{ name: 'toilet', count: 1, confidence: 1 }],
      serviceSlug: 'house-cleaning',
    }).lines.find((l) => l.id === 'toilet')!;
    expect(toilet.minutes).toBe(TASK_BY_ID.toilet.baseMinutes);
  });
});
