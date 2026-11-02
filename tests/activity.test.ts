import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overheadSummary,
  personalFactor,
  roomTimings,
  sessionSpan,
  type Session,
} from '../lib/activity/store';

/**
 * The arithmetic behind the one constant the time model is missing.
 *
 * CLAUDE.md says ROOM_BASE_MINUTES must not be recalibrated down to stopwatch
 * figures, because a per-task stopwatch never counts travel, setup, moving
 * furniture or packing up — 20–40% of a cleaning day, all of it billed. These
 * tests cover the sums that turn a logged job into that number, because an
 * off-by-one here would not look wrong on screen: it would quietly produce a
 * plausible percentage and get written into the pricing constants.
 */

const T = (minutesFromNoon: number) =>
  new Date(Date.UTC(2026, 0, 2, 12, minutesFromNoon)).toISOString();

function job(over: Partial<Session> = {}): Session {
  return {
    id: 'as_1',
    loggedBy: 'ana@example.com',
    startedAt: T(0),
    endedAt: T(120),
    segments: [
      { id: 'sg_1', roomType: 'kitchen', startedAt: T(15), endedAt: T(60), minutes: 45 },
      { id: 'sg_2', roomType: 'bathroom', startedAt: T(65), endedAt: T(95), minutes: 30 },
    ],
    ...over,
  };
}

test('the gap between arriving and the rooms is what gets measured', () => {
  const span = sessionSpan(job());

  assert.equal(span.taskMinutes, 75, 'hands-on is the sum of the closed segments');
  assert.equal(span.doorToDoorMinutes, 120, 'door-to-door is arrival to departure');
  // 15 min before the kitchen, 5 between rooms, 25 after the bathroom: the
  // carrying, the setup and the packing up that a task stopwatch never sees.
  assert.equal(span.overheadMinutes, 45);
  assert.equal(span.overheadShare, 45 / 120);
});

test('a job still running reports no overhead yet', () => {
  // Reporting a share mid-job would read as a measurement and would fall as
  // the day went on, which is an artefact of when you looked.
  const span = sessionSpan(job({ endedAt: undefined }));
  assert.equal(span.taskMinutes, 75);
  assert.equal(span.doorToDoorMinutes, null);
  assert.equal(span.overheadMinutes, null);
  assert.equal(span.overheadShare, null);
});

test('rounding can never produce negative overhead', () => {
  // Each side is rounded independently, so the parts can land a minute above
  // the whole. A negative would poison every average built on it.
  const span = sessionSpan(
    job({
      startedAt: T(0),
      endedAt: T(40),
      segments: [{ id: 'sg_1', roomType: 'kitchen', startedAt: T(0), endedAt: T(41), minutes: 41 }],
    }),
  );
  assert.equal(span.overheadMinutes, 0);
});

test('overhead is the median across jobs, not the mean', () => {
  // One job where somebody left the clock running through lunch would drag a
  // mean badly, and there will not be enough jobs for that to wash out for a
  // long time.
  const normal = (id: string, over: number) =>
    job({
      id,
      startedAt: T(0),
      endedAt: T(100 + over),
      segments: [{ id: `${id}s`, roomType: 'kitchen', startedAt: T(0), endedAt: T(100), minutes: 100 }],
    });

  const summary = overheadSummary([
    normal('a', 10),
    normal('b', 20),
    normal('c', 900), // forgot to tap "me voy" until the next morning
  ]);

  assert.equal(summary.samples, 3);
  // Median of 10/110, 20/120, 900/1000 → the middle one, not the average.
  assert.ok(summary.medianShare !== null);
  assert.ok(
    Math.abs(summary.medianShare - 20 / 120) < 1e-9,
    `expected the middle job to win, got ${summary.medianShare}`,
  );
});

test('an unfinished job contributes nothing to the summary', () => {
  const summary = overheadSummary([job({ endedAt: undefined })]);
  assert.equal(summary.samples, 0);
  assert.equal(summary.medianShare, null);
});

test('room timings lead with the median', () => {
  const timings = roomTimings([
    job({
      id: 'x',
      segments: [
        { id: 'a', roomType: 'kitchen', startedAt: T(0), endedAt: T(20), minutes: 20 },
        { id: 'b', roomType: 'kitchen', startedAt: T(20), endedAt: T(50), minutes: 30 },
        { id: 'c', roomType: 'kitchen', startedAt: T(50), endedAt: T(230), minutes: 180 },
      ],
    }),
  ]);

  const kitchen = timings.find((t) => t.roomType === 'kitchen')!;
  assert.equal(kitchen.samples, 3);
  assert.equal(kitchen.medianMinutes, 30, 'the 180-minute outlier must not move the headline');
  assert.equal(kitchen.maxMinutes, 180);
});

test('a personal factor needs enough rooms before it says anything', () => {
  // With three segments this number is noise with a decimal point on it, and
  // a time factor that confident is how a quote ends up 30% wrong for one
  // person for months.
  const few = [job({ loggedBy: 'ana@example.com' })];
  assert.equal(personalFactor(few, 'ana@example.com'), null);
});

test('a personal factor compares like rooms, not totals', () => {
  // Ana does kitchens in 20 where the dataset's median is 40. Someone who is
  // simply sent to smaller rooms is not thereby faster, so the comparison is
  // room type by room type.
  const sessions: Session[] = [];
  for (let i = 0; i < 8; i++) {
    sessions.push(
      job({
        id: `slow${i}`,
        loggedBy: 'bruno@example.com',
        segments: [
          { id: `s${i}`, roomType: 'kitchen', startedAt: T(0), endedAt: T(40), minutes: 40 },
        ],
      }),
    );
  }
  for (let i = 0; i < 8; i++) {
    sessions.push(
      job({
        id: `fast${i}`,
        loggedBy: 'ana@example.com',
        segments: [
          { id: `f${i}`, roomType: 'kitchen', startedAt: T(0), endedAt: T(20), minutes: 20 },
        ],
      }),
    );
  }

  const ana = personalFactor(sessions, 'ana@example.com');
  assert.ok(ana, 'eight rooms should be enough to say something');
  assert.equal(ana.samples, 8);
  // Median across everybody is 20 and 40 equally weighted → 30. Ana: 20/30.
  assert.ok(ana.factor < 1, `Ana works faster than the pool, got ${ana.factor}`);

  const bruno = personalFactor(sessions, 'bruno@example.com');
  assert.ok(bruno && bruno.factor > 1, 'Bruno should come out slower than the pool');
});
