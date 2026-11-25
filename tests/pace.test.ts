import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session, Segment, QualityRecord, WorkerRecord } from '../lib/activity/store';
import {
  blend,
  companyPace,
  confidenceFor,
  countsAsData,
  durationFor,
  globalPace,
  observationsFrom,
  paceTable,
  teamObservations,
  workerPace,
  DEFAULT_OVERHEAD_SHARE,
  type RoomObservation,
} from '../lib/workers/pace';
import { jobRooms } from '../lib/workers/job';
import type { RoomAnalysis } from '../lib/vision/types';

/**
 * The per-person pace model.
 *
 * What can go wrong here does not throw. A ratio built from a room that was
 * still running, a test job that leaks into the averages, a team of one that
 * looks faster than itself — each produces a plausible number on the admin
 * screen, and a plausible wrong number about a person is the worst kind.
 */

interface RoomSpec {
  key: string;
  type: string;
  predicted: number;
  minutes: number;
  extra?: { taskKey: string; predicted: number; minutes: number };
  excluded?: boolean;
  together?: boolean;
  open?: boolean;
}

let seq = 0;
const at = (iso: string, plusMinutes: number) => new Date(new Date(iso).getTime() + plusMinutes * 60000).toISOString();

function job(o: {
  worker: string;
  start?: string;
  rooms: RoomSpec[];
  source?: Session['source'];
  quality?: Partial<QualityRecord>[];
  analysisId?: string;
  region?: string;
}): Session {
  const start = o.start ?? '2026-11-02T14:00:00.000Z';
  let t = 5;
  const segments: Segment[] = [];
  for (const r of o.rooms) {
    const seg = (minutes: number, predicted: number, taskKey?: string): Segment => {
      const s: Segment = {
        id: `sg_${++seq}`,
        roomType: r.type,
        roomKey: r.key,
        taskKey,
        depth: taskKey ? 'deep' : undefined,
        predictedMinutes: predicted,
        together: r.together,
        excluded: r.excluded,
        startedAt: at(start, t),
        endedAt: r.open ? undefined : at(start, t + minutes),
        minutes: Math.round(minutes),
      };
      t += minutes;
      return s;
    };
    segments.push(seg(r.minutes, r.predicted));
    if (r.extra) segments.push(seg(r.extra.minutes, r.extra.predicted, r.extra.taskKey));
  }
  return {
    id: `as_${++seq}`,
    loggedBy: `${o.worker}@example.com`,
    workerId: o.worker,
    analysisId: o.analysisId,
    source: o.source ?? 'field',
    region: o.region,
    crewSize: 1,
    startedAt: start,
    endedAt: at(start, t + 10),
    segments,
    quality: (o.quality ?? []).map((q, i) => ({ id: `qc_${i}`, result: 'ok', by: 'customer', createdAt: start, ...q })) as QualityRecord[],
  };
}

const worker = (id: string, tenantId?: string): WorkerRecord => ({
  id,
  tenantId,
  name: id.toUpperCase(),
  active: true,
  createdAt: '2026-11-01T00:00:00.000Z',
});

test('the ratio already contains how dirty the room was', () => {
  // A greasy kitchen took twice as long as a clean one, and both say the same
  // thing about the person: 15% over what the engine expected.
  const { rooms } = observationsFrom([
    job({ worker: 'luis', rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 40, minutes: 46 }] }),
    job({ worker: 'luis', rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 22, minutes: 25.3 }] }),
  ]);
  assert.deepEqual(
    rooms.map((r) => r.ratio),
    [1.15, 1.15],
  );
});

test('a room is learned from only when all of it is trustworthy', () => {
  const s = job({
    worker: 'ana',
    rooms: [
      { key: 'kitchen-1', type: 'kitchen', predicted: 40, minutes: 30, extra: { taskKey: 'oven', predicted: 14, minutes: 12 } },
      { key: 'bathroom-1', type: 'bathroom', predicted: 20, minutes: 90, excluded: true },
      { key: 'bedroom-1', type: 'bedroom', predicted: 15, minutes: 14 },
      { key: 'bedroom-2', type: 'bedroom', predicted: 15, minutes: 10, open: true },
      { key: 'living_room-1', type: 'living_room', predicted: 20, minutes: 9 },
    ],
    quality: [{ roomKey: 'living_room-1', result: 'redo' }],
  });
  const { rooms, tasks } = observationsFrom([s]);

  // The oven counts on its own, and inside its kitchen: the kitchen's
  // prediction included it.
  assert.deepEqual(tasks.map((t) => [t.taskKey, t.ratio]), [['oven', 0.857]]);
  const kitchen = rooms.find((r) => r.roomKey === 'kitchen-1')!;
  assert.equal(kitchen.actualMinutes, 42);

  // Lunch on the clock, a room still running, and a fast room that was redone
  // are all left out rather than guessed at.
  assert.deepEqual(rooms.map((r) => r.roomKey).sort(), ['bedroom-1', 'kitchen-1']);
});

test('a job redone as a whole teaches nothing about speed', () => {
  const s = job({
    worker: 'ana',
    rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 40, minutes: 20 }],
    quality: [{ result: 'redo', by: 'customer' }],
  });
  assert.equal(observationsFrom([s]).rooms.length, 0);
});

test('test data never reaches a number', () => {
  const real = job({ worker: 'ana', rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 40, minutes: 40 }] });
  const fake = job({ worker: 'ana', source: 'test', rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 40, minutes: 4 }] });
  assert.equal(countsAsData(fake), false);
  assert.equal(countsAsData({ source: 'practice' }), true);
  const { rooms } = observationsFrom([real, fake]);
  assert.deepEqual(rooms.map((r) => r.ratio), [1]);
  assert.equal(paceTable([real, fake], [])[0].jobs, 1);
});

test('the prior gives way to the data at the documented rate', () => {
  assert.equal(blend([], 1), 1);
  assert.equal(blend(Array(8).fill(0.5), 1), 0.75);
  assert.ok(Math.abs(blend(Array(40).fill(0.5), 1) - (40 * 0.5 + 8) / 48) < 1e-9);
  assert.equal(confidenceFor(0, null), 'provisional');
  assert.equal(confidenceFor(7, 0.1), 'low');
  assert.equal(confidenceFor(29, 0.1), 'medium');
  assert.equal(confidenceFor(30, 0.4), 'medium');
  assert.equal(confidenceFor(30, 0.1), 'high');
});

function many(workerId: string, type: string, ratios: number[], extra: Partial<Parameters<typeof job>[0]> = {}): Session[] {
  return ratios.map((ratio, i) =>
    job({
      worker: workerId,
      start: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T14:00:00.000Z`,
      rooms: [{ key: `${type}-1`, type, predicted: 20, minutes: 20 * ratio }],
      ...extra,
    }),
  );
}

test('a team of one is exactly as fast as itself', () => {
  const { rooms } = observationsFrom(many('ana', 'kitchen', [0.4, 0.5, 0.45, 0.5, 0.42, 0.48, 0.5, 0.44, 0.46, 0.5]));
  const pace = workerPace(rooms, 'ana');
  assert.equal(pace.factor, 1);
  assert.equal(pace.basis, 'worker');
});

test('people are compared with the team on the same kind of room', () => {
  const sessions = [
    ...many('ana', 'kitchen', Array(10).fill(0.8)),
    ...many('ana', 'bathroom', Array(10).fill(1.0)),
    ...many('luis', 'kitchen', Array(10).fill(1.2)),
    ...many('luis', 'bathroom', Array(10).fill(0.9)),
  ];
  const workers = [worker('ana'), worker('luis')];
  const { rooms } = observationsFrom(sessions, workers);

  const anaKitchen = workerPace(rooms, 'ana', { roomType: 'kitchen' });
  const luisKitchen = workerPace(rooms, 'luis', { roomType: 'kitchen' });
  assert.ok(anaKitchen.factor < 1 && luisKitchen.factor > 1, `${anaKitchen.factor} / ${luisKitchen.factor}`);

  // Luis is slower than Ana in kitchens and faster in bathrooms: his strength
  // is read against his own average, not against hers.
  const table = paceTable(sessions, workers);
  const luis = table.find((r) => r.workerId === 'luis')!;
  assert.equal(luis.strongest, 'bathroom');
  assert.equal(luis.weakest, 'kitchen');
  assert.equal(luis.name, 'LUIS');
  assert.equal(luis.rooms, 20);
});

test('two people in one room count once, for the team, and for neither person', () => {
  const shared = (w: string) =>
    job({ worker: w, analysisId: 'vis_1', rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 40, minutes: 25, together: true }] });
  const { rooms } = observationsFrom([shared('ana'), shared('luis')]);
  const team = teamObservations(rooms);
  assert.equal(team.length, 1);
  assert.equal(team[0].actualMinutes, 50);
  assert.equal(team[0].ratio, 1.25);
  assert.equal(workerPace(rooms, 'ana').samples, 0);
});

function obs(tenant: string, region: string, roomType: string, ratio: number, n: number): RoomObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `${tenant}-${roomType}-${i}`,
    analysisId: null,
    workerId: `${tenant}-w`,
    tenant,
    region,
    serviceSlug: null,
    roomKey: `${roomType}-1`,
    roomType,
    actualMinutes: 20 * ratio,
    predictedMinutes: 20,
    ratio,
    together: false,
    startedAt: '2026-11-01T14:00:00.000Z',
    crewSize: 1,
    jobOfDay: 1,
    hoursBefore: 0,
    jobsBefore: i,
  }));
}

test('a global average needs several companies, not just many rooms', () => {
  // One company with a hundred kitchens is that company's numbers.
  const alone = obs('acme', 'brooklyn-ny', 'kitchen', 0.6, 100);
  assert.equal(globalPace(alone, { region: 'brooklyn-ny', roomType: 'kitchen' }).basis, 'reference');

  const pooled = [
    ...obs('acme', 'brooklyn-ny', 'kitchen', 0.6, 10),
    ...obs('beta', 'brooklyn-ny', 'kitchen', 0.7, 10),
    ...obs('gamma', 'brooklyn-ny', 'kitchen', 0.8, 10),
    ...obs('acme', 'queens-ny', 'bathroom', 1.0, 30),
  ];
  const brooklyn = globalPace(pooled, { region: 'brooklyn-ny', roomType: 'kitchen' });
  assert.equal(brooklyn.basis, 'global');
  assert.equal(brooklyn.factor, 0.7);
  // No full cell for Queens kitchens: fall back to kitchens anywhere.
  assert.equal(globalPace(pooled, { region: 'queens-ny', roomType: 'kitchen' }).factor, 0.7);
});

test('a company leans on its own rooms before leaning on the world', () => {
  const pooled = [
    ...obs('klaudy', 'brooklyn-ny', 'kitchen', 0.5, 40),
    ...obs('klaudy', 'brooklyn-ny', 'bathroom', 0.5, 2),
  ];
  const bath = companyPace(pooled, 'klaudy', { roomType: 'bathroom' });
  // Two bathrooms against forty other rooms at 0.5: the answer stays with the
  // company (which itself leans a little towards the reference, 8 rooms' worth)
  // instead of being dragged to the reference's 1.0.
  const overall = companyPace(pooled, 'klaudy');
  assert.ok(Math.abs(bath.factor - overall.factor) < 0.03, `${bath.factor} vs ${overall.factor}`);
  assert.ok(bath.factor < 0.6, String(bath.factor));
  assert.equal(bath.confidence, 'low');
});

test('the duration says which layer it came from, and never pretends', () => {
  const rooms = jobRooms(
    {
      rooms: [
        room('kitchen', 40, [{ name: 'oven', count: 1, confidence: 0.9 }]),
        room('bathroom', 20),
      ],
    },
    'standard-cleaning',
  );

  // No data anywhere: the engine's own total, labelled as such.
  const none = durationFor(rooms, []);
  assert.deepEqual([none.minutes, none.basis, none.confidence], [60, 'reference', 'provisional']);

  // Company data, overhead not measured: hands-on scaled by the default share.
  const { rooms: seen } = observationsFrom(many('ana', 'kitchen', Array(10).fill(0.5)).concat(many('ana', 'bathroom', Array(10).fill(0.5))));
  const team = durationFor(rooms, seen, { overhead: { samples: 2, medianShare: 0.1 } });
  assert.equal(team.basis, 'company');
  assert.equal(team.overheadMeasured, false);
  assert.equal(team.overheadShare, DEFAULT_OVERHEAD_SHARE);
  assert.ok(team.handsOnMinutes < 60 && team.minutes > team.handsOnMinutes);

  // Measured overhead replaces the default once there are enough jobs.
  const measured = durationFor(rooms, seen, { overhead: { samples: 6, medianShare: 0.2 } });
  assert.equal(measured.overheadMeasured, true);
  assert.ok(Math.abs(measured.minutes - measured.handsOnMinutes / 0.8) <= 1);

  // And for a person, it says so.
  assert.equal(durationFor(rooms, seen, { workerId: 'ana' }).basis, 'worker');
  // Somebody new gets the team's estimate at the team's confidence.
  const newcomer = durationFor(rooms, seen, { workerId: 'nobody-yet' });
  assert.equal(newcomer.basis, 'company');
  assert.equal(newcomer.confidence, team.confidence);
  assert.equal(newcomer.minutes, team.minutes);
});

function room(type: RoomAnalysis['type'], minutes: number, objects: RoomAnalysis['objects'] = []): RoomAnalysis {
  return {
    type,
    label: type,
    confidence: 0.8,
    objects,
    soil: { dust: 0, grease: 0, stains: 0, clutter: 0, hair: 0, trash: 0, mold: 0 },
    condition: 'fair',
    estimatedMinutes: minutes,
  } as RoomAnalysis;
}

test("the timer's rooms are the walkthrough's rooms, and the extras are what was sold", () => {
  const analysis = {
    rooms: [
      room('kitchen', 41.27, [
        { name: 'Oven', count: 1, confidence: 0.9 },
        { name: 'fridge', count: 1, confidence: 0.9 },
        { name: 'refrigerator', count: 1, confidence: 0.9 },
        { name: 'toaster', count: 1, confidence: 0.9 },
      ]),
      room('bathroom', 22),
      room('bathroom', 18),
    ],
    depthChoices: { 'kitchen:oven': 'deep' as const },
  };

  // A standard clean where the customer said yes to the oven only.
  const standard = jobRooms(analysis, 'standard-cleaning');
  assert.deepEqual(
    standard.map((r) => [r.key, r.label, r.predictedMinutes]),
    [
      ['kitchen-1', 'Cocina', 41.3],
      ['bathroom-1', 'Baño 1', 22],
      ['bathroom-2', 'Baño 2', 18],
    ],
  );
  assert.deepEqual(standard[0].extras.map((e) => [e.taskKey, e.label, e.predictedMinutes]), [
    ['oven', 'Limpia el horno por dentro', 14],
  ]);

  // A deep clean opens everything up by default — one button per appliance,
  // and the toaster, which nobody is asked about, is never one.
  const deep = jobRooms({ rooms: analysis.rooms }, 'deep-cleaning');
  assert.deepEqual(deep[0].extras.map((e) => e.taskKey), ['oven', 'refrigerator']);
  // Hands-free can time the rest by name; the standard clean's fridge is a wipe.
  assert.deepEqual(
    standard[0].tasks.map((t) => [t.taskKey, t.depth, t.label]),
    [
      ['oven', 'deep', 'Limpia el horno por dentro'],
      ['refrigerator', 'surface', 'Nevera'],
    ],
  );
});

test('the context that explains variance is computed, not asked', () => {
  const day = '2026-11-03T13:00:00.000Z';
  const first = job({ worker: 'ana', start: day, rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 30, minutes: 60 }] });
  const second = job({ worker: 'ana', start: at(day, 120), rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 30, minutes: 30 }] });
  const nextDay = job({ worker: 'ana', start: at(day, 24 * 60), rooms: [{ key: 'kitchen-1', type: 'kitchen', predicted: 30, minutes: 30 }] });
  const { rooms } = observationsFrom([nextDay, second, first]);
  const byStart = [...rooms].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  assert.deepEqual(
    byStart.map((r) => [r.jobOfDay, r.jobsBefore]),
    [
      [1, 0],
      [2, 1],
      [1, 2],
    ],
  );
  // The first job ran 5 + 60 + 10 minutes door to door.
  assert.equal(byStart[1].hoursBefore, 1.3);
});
