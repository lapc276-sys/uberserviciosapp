import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { presign, storageConfig, uploadUrl } from '../lib/storage/s3';
import { bestOffset, motionLine, orientationLine, pieceName, recordingStart, MAX_CLOCK_RTT_MS } from '../lib/recording/format';
import { crc32, splitForZip, zipParts } from '../lib/recording/zip';
import {
  addEvents,
  captureConfig,
  hasCustomerConsent,
  hasWorkerConsent,
  memoryRecording,
  ownRecording,
  pieceKey,
  recordConsent,
  recordPiece,
  startRecording,
  stopRecording,
  videoOffsetMs,
} from '../lib/activity/recordings';
import { startSession } from '../lib/activity/store';

/**
 * The raw layer of the dataset. None of this fails loudly where it breaks:
 * a wrong signature is an upload that never lands, a wrong clock is every
 * label sliding off its frames, a receipt that can be overwritten is ground
 * truth that quietly changed. So each is pinned here.
 */

// ── Uploads ─────────────────────────────────────────────────────────────────

test("matches AWS's published presigned-URL example", () => {
  // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expiresSeconds: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(
    new URL(url).searchParams.get('X-Amz-Signature'),
    'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
});

test('off without its variables, and only over https', () => {
  assert.equal(storageConfig({}), null);
  const base = {
    STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
    STORAGE_S3_BUCKET: 'jobs',
    STORAGE_S3_ACCESS_KEY_ID: 'id',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
  };
  assert.equal(storageConfig({ ...base, STORAGE_S3_ENDPOINT: 'http://insecure.example' }), null);
  const config = storageConfig(base)!;
  assert.equal(config.region, 'auto');
  assert.equal(config.endpoint, 'https://acct.r2.cloudflarestorage.com');

  const url = new URL(uploadUrl('recordings/as_1/rec_1/video/00001.webm', config, 900, new Date('2026-11-25T12:00:00Z')));
  assert.equal(url.host, 'acct.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/jobs/recordings/as_1/rec_1/video/00001.webm');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.match(url.searchParams.get('X-Amz-Credential')!, /^id\/20261125\/auto\/s3\/aws4_request$/);
});

test('every piece has one name, the same in the bucket and in an export', () => {
  assert.equal(pieceName('video', 1, 'video/webm'), 'video/00001.webm');
  assert.equal(pieceName('video', 360, 'video/mp4'), 'video/00360.mp4');
  assert.equal(pieceName('sensors', 12, 'video/webm'), 'sensors/00012.jsonl.gz');
  const record = { storagePrefix: 'recordings/as_1/rec_1', mimeType: 'video/webm' };
  assert.equal(pieceKey(record, 'video', 7), 'recordings/as_1/rec_1/video/00007.webm');
  assert.equal(pieceKey({ ...record, storagePrefix: undefined }, 'video', 7), null);
});

test('capture settings come from the environment, inside sane bounds', () => {
  assert.deepEqual(captureConfig({}), { segmentSeconds: 30, videoBitsPerSecond: 800_000, maxHeight: 480, frameRate: 15 });
  const c = captureConfig({ RECORDING_SEGMENT_SECONDS: '60', RECORDING_FPS: '24', RECORDING_MAX_HEIGHT: '99999', RECORDING_VIDEO_BITRATE: 'lots' });
  assert.equal(c.segmentSeconds, 60);
  assert.equal(c.frameRate, 24);
  assert.equal(c.maxHeight, 480, 'out of range falls back');
  assert.equal(c.videoBitsPerSecond, 800_000, 'not a number falls back');
});

// ── Clock ───────────────────────────────────────────────────────────────────

test('the clock fix trusts the fastest round trip', () => {
  // Server is 5000 ms ahead. The slow trip's answer sits off-centre; the
  // fast one cannot be off by more than 10 ms.
  const fix = bestOffset([
    { sentMs: 1000, receivedMs: 1900, serverMs: 6100 }, // 900 ms trip
    { sentMs: 2000, receivedMs: 2020, serverMs: 7012 }, // 20 ms trip
    { sentMs: 3000, receivedMs: 2990, serverMs: 8000 }, // negative: discarded
    { sentMs: 4000, receivedMs: 4000 + MAX_CLOCK_RTT_MS + 1, serverMs: 9000 }, // too slow: discarded
  ]);
  assert.deepEqual(fix, { offsetMs: 5002, rttMs: 20 });
  assert.equal(bestOffset([]), null);
});

test("the recording's t0 lands on the server clock, or the fix is called untrusted", () => {
  const now = 1_800_000_000_000;
  // Taken 150 ms ago on a phone 2 s behind.
  assert.deepEqual(recordingStart(now - 2000 - 150, { offsetMs: 2000, rttMs: 40 }, now), { at: now - 150, trusted: true });
  // No fix at all: the server's own now, and said so.
  assert.deepEqual(recordingStart(now - 150, undefined, now), { at: now, trusted: false });
  // A fix that puts t0 in the future, or ten minutes ago, is wrong.
  assert.equal(recordingStart(now + 60_000, { offsetMs: 0, rttMs: 40 }, now).trusted, false);
  assert.equal(recordingStart(now - 600_000, { offsetMs: 0, rttMs: 40 }, now).trusted, false);
  assert.equal(recordingStart(now, { offsetMs: 0, rttMs: MAX_CLOCK_RTT_MS + 1 }, now).trusted, false);
});

// ── Sensors ─────────────────────────────────────────────────────────────────

test('a sensor line says what the phone measured, and null for what it did not', () => {
  const motion = JSON.parse(
    motionLine(1234.567, {
      acceleration: { x: 0.123456, y: null, z: -9.81 },
      accelerationIncludingGravity: null,
      rotationRate: { alpha: 1.5, beta: 2, gamma: Number.NaN },
      interval: 16.6667,
    }),
  );
  assert.deepEqual(motion, { t: 1234.6, s: 'motion', a: [0.1235, null, -9.81], g: null, r: [1.5, 2, null], i: 16.6667 });

  const orientation = JSON.parse(orientationLine(10, { alpha: 359.99999, beta: -45, gamma: 0, absolute: true }));
  assert.deepEqual(orientation, { t: 10, s: 'orientation', o: [360, -45, 0], abs: true });
});

// ── ZIP export ──────────────────────────────────────────────────────────────

test('CRC-32 matches zlib, including continued from a previous value', () => {
  const bytes = new TextEncoder().encode('Klaudy cleans Brooklyn. '.repeat(1000));
  assert.equal(crc32(bytes), zlibCrc32(bytes));
  assert.equal(crc32(bytes.subarray(500), crc32(bytes.subarray(0, 500))), zlibCrc32(bytes));
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('an export is a ZIP that standard tools open, byte for byte', () => {
  const enc = new TextEncoder();
  const video = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
  const files = [
    { name: 'manifest.json', data: enc.encode('{"format":"klaudy-recording/1"}') },
    { name: 'video/00001.webm', data: video },
    { name: 'sensors/00001.jsonl.gz', data: enc.encode('not really gzip, and that is fine for a stored entry') },
  ];
  const { parts, size } = zipParts(
    files.map((f) => ({ name: f.name, size: f.data.length, crc32: crc32(f.data), data: f.data, modified: new Date('2026-11-26T10:30:00Z') })),
  );
  const zip = Buffer.concat(parts.map((p) => Buffer.from(p as Uint8Array)));
  assert.equal(zip.length, size);

  // Read back the central directory the way any unzip does.
  const view = new DataView(zip.buffer, zip.byteOffset, zip.length);
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 3);
  let at = view.getUint32(eocd + 16, true);
  for (const f of files) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    assert.equal(zip.subarray(at + 46, at + 46 + nameLength).toString(), f.name);
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true);
    assert.ok(zip.subarray(start, start + f.data.length).equals(Buffer.from(f.data)));
    at += 46 + nameLength;
  }

  // And an independent reader, when this machine has one.
  const python = spawnSync('python3', ['--version']);
  if (python.status === 0) {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const path = join(dir, 'export.zip');
    writeFileSync(path, zip);
    const check = spawnSync('python3', [
      '-I',
      '-c',
      'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(z.namelist()))',
      path,
    ]);
    assert.equal(check.status, 0, check.stderr.toString());
    assert.equal(check.stdout.toString().trim(), files.map((f) => f.name).join(','));
  }
});

test('a long recording is split into archives that each stay under the limit, in order', () => {
  const items = [5, 5, 5, 5, 5].map((size, i) => ({ id: i, size }));
  const groups = splitForZip(items, 12 + 2 * 128);
  assert.deepEqual(groups.map((g) => g.map((x) => x.id)), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(splitForZip([]), []);
});

// ── Receipts, events, consent: the memory store ─────────────────────────────

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

async function newRecording(loggedBy: string) {
  const session = await startSession(loggedBy, 'test');
  const startedAt = new Date(Date.now() - 60_000);
  const record = await startRecording(session.id, { mimeType: 'video/webm', chunkSeconds: 30, startedAt, clockOffsetMs: 12, clockRttMs: 30 });
  return { session, record };
}

test('a recording belongs to whoever logged its job, also after the job closed', async () => {
  const { record } = await newRecording('maria@example.com');
  assert.equal((await ownRecording('maria@example.com', record.id))?.id, record.id);
  assert.equal(await ownRecording('somebody@example.com', record.id), null);
  assert.equal(await ownRecording('maria@example.com', 'rec_nope'), null);
});

test('a receipt is written once; a repeat that disagrees is logged, not applied', async () => {
  const { record } = await newRecording('rosa@example.com');
  // Without a bucket there is no key, so give the memory record one.
  const target = memoryRecording(record.id)!;
  target.storagePrefix = `recordings/${record.sessionId}/${record.id}`;
  const receipt = { index: 1, bytes: 3_000_000, sha256: SHA_A, monoStartMs: 0, monoEndMs: 30_300 };

  assert.equal(await recordPiece(target, 'video', receipt), 'recorded');
  assert.equal(await recordPiece(target, 'video', receipt), 'repeat');
  assert.equal(await recordPiece(target, 'video', { ...receipt, sha256: SHA_B }), 'conflict');
  assert.equal(target.receipts.length, 1);
  assert.equal(target.receipts[0].sha256, SHA_A, 'the first receipt stands');
  assert.deepEqual(target.events.at(-1), { kind: 'piece_conflict', data: { kind: 'video', index: 1, first: SHA_A, second: SHA_B } });

  // Sensors are their own sequence: index 1 again is a different piece.
  assert.equal(await recordPiece(target, 'sensors', { ...receipt, samples: 1800, streams: ['motion'] }), 'recorded');
  assert.deepEqual(target.pieces, { video: [1], sensors: [1] });
});

test('the same event sent twice — retry, beacon, recovery — is kept once', async () => {
  const { record } = await newRecording('lucia@example.com');
  const pause = { seq: 1, kind: 'privacy_pause', monoMs: 1000 };
  await addEvents(record.id, [pause, { seq: 2, kind: 'privacy_resume', monoMs: 9000 }]);
  await addEvents(record.id, [pause]);
  await addEvents(record.id, [{ kind: 'clock_untrusted' }, { kind: 'clock_untrusted' }]);
  const events = memoryRecording(record.id)!.events;
  assert.deepEqual(
    events.map((e) => e.kind),
    ['privacy_pause', 'privacy_resume', 'clock_untrusted', 'clock_untrusted'],
    'server events have no seq and are never merged',
  );
});

test('a recovered recording ends where its last piece ended, never in the future', async () => {
  const { record } = await newRecording('carmen@example.com');
  await stopRecording(record, 45_000);
  const ended = memoryRecording(record.id)!.endedAt!;
  assert.equal(new Date(ended).getTime() - new Date(record.startedAt).getTime(), 45_000);

  const later = await newRecording('carmen2@example.com');
  await stopRecording(later.record, 10 * 3_600_000);
  assert.ok(new Date(memoryRecording(later.record.id)!.endedAt!).getTime() <= Date.now());
});

test('the video offset of a moment is measured from t0', () => {
  const record = { startedAt: '2026-11-26T10:00:00.000Z' };
  assert.equal(videoOffsetMs(record, '2026-11-26T10:14:03.500Z'), 843_500);
  assert.equal(videoOffsetMs(record, '2026-11-26T09:59:00.000Z'), null);
});

test('the event log keeps sending after a flush that had nothing to send', async () => {
  // The bug this pins: an empty flush finished before it was stored as "the
  // flush in progress", so every later flush returned it and sent nothing.
  const bodies: { events: { kind: string }[] }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  try {
    const { EventLog } = await import('../components/pilot/capture');
    const log = new EventLog('rec_events', performance.now());
    assert.equal(await log.flush(), true, 'nothing to send is a success');
    log.add('privacy_pause');
    assert.equal(await log.flush(), true);
    log.add('privacy_resume');
    await log.flush();
    assert.deepEqual(bodies.map((b) => b.events.map((e) => e.kind)), [['privacy_pause'], ['privacy_resume']]);
    assert.equal(log.pending, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('consent: the worker once per wording, the customer once per job', async () => {
  assert.equal(await hasWorkerConsent('wk_test'), false);
  await recordConsent('worker', 'wk_test', 'ana@example.com');
  assert.equal(await hasWorkerConsent('wk_test'), true);
  assert.equal(await hasWorkerConsent('wk_other'), false);

  assert.equal(await hasCustomerConsent('as_job1'), false);
  await recordConsent('customer', 'wk_test', 'ana@example.com', 'as_job1');
  assert.equal(await hasCustomerConsent('as_job1'), true);
  assert.equal(await hasCustomerConsent('as_job2'), false, 'yesterday’s customer did not agree to today’s home');
});
