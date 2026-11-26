import { NextResponse } from 'next/server';
import { z } from 'zod';
import { whoIsLogging, type Who } from '@/lib/activity/who';
import { openSession, resolveWorker, type Session } from '@/lib/activity/store';
import {
  addEvents,
  captureConfig,
  CONSENT_TEXT,
  CONSENT_VERSION,
  hasCustomerConsent,
  hasWorkerConsent,
  ownRecording,
  pieceContentType,
  pieceUploadUrl,
  recordConsent,
  recordPiece,
  RECORDING_TYPES,
  startRecording,
  stopRecording,
} from '@/lib/activity/recordings';
import { isStorageConfigured } from '@/lib/storage/s3';
import { EVENT_KIND, MAX_EVENT_DATA, MAX_META_JSON, recordingStart } from '@/lib/recording/format';

/**
 * Hands-free recording of a job. The video and sensor bytes never pass
 * through here — the phone PUTs them to the bucket with a URL signed below.
 * What passes through is everything needed to trust those bytes later: who
 * agreed, what the camera delivered, where t0 sits on the server clock, the
 * checksum of every piece, and every interruption.
 *
 *   GET  ?clock=1        the server's time, for the phone's clock fix
 *   GET                  settings, and whether this person has consented
 *   POST start           consent + clock + capture settings → a recording
 *   POST piece-url       a signed PUT for one video segment or sensor chunk
 *   POST uploaded        "it landed", with its checksum and time window
 *   POST events          interruptions and telemetry, idempotent by seq
 *   POST stop            closes it and queues validation
 *
 * A recording belongs to the person whose job it is (the cookie), and only
 * they can add to it — also after the job closed, for pieces a dead page
 * left on the phone.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

async function workerIdOf(who: Who, session: Session | null): Promise<string> {
  if (session?.workerId) return session.workerId;
  const worker = await resolveWorker({ proId: who.proId, email: who.email, name: who.name });
  return worker.id;
}

export async function GET(req: Request) {
  // The clock answer does nothing else, so the server's half of the round
  // trip stays as short as it can be: the fix is only as good as that.
  if (new URL(req.url).searchParams.get('clock')) {
    return NextResponse.json({ serverNow: Date.now() }, { headers: NO_STORE });
  }
  const who = await whoIsLogging();
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const session = await openSession(who.loggedBy);
  const workerId = await workerIdOf(who, session);
  return NextResponse.json(
    {
      config: captureConfig(),
      uploads: isStorageConfigured(),
      consent: {
        version: CONSENT_VERSION,
        worker: CONSENT_TEXT.worker,
        customer: CONSENT_TEXT.customer,
        given: await hasWorkerConsent(workerId),
      },
    },
    { headers: NO_STORE },
  );
}

const small = (max: number) =>
  z.record(z.unknown()).refine((v) => JSON.stringify(v).length <= max, { message: 'too large' });

const id = z.string().min(1).max(64);
const kind = z.enum(['video', 'sensors']);
const index = z.number().int().min(1).max(99_999);
const mono = z.number().min(-60_000).max(7 * 24 * 3_600_000);

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    mimeType: z.string().max(80),
    consent: z.object({ worker: z.string().max(40).optional(), customer: z.boolean() }),
    clock: z.object({
      t0EpochMs: z.number(),
      offsetMs: z.number().optional(),
      rttMs: z.number().min(0).optional(),
    }),
    capture: small(MAX_META_JSON).optional(),
    device: small(MAX_META_JSON).optional(),
  }),
  z.object({ action: z.literal('piece-url'), recordingId: id, kind, index }),
  z.object({
    action: z.literal('uploaded'),
    recordingId: id,
    kind,
    index,
    bytes: z.number().int().min(1).max(500_000_000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    monoStartMs: mono,
    monoEndMs: mono,
    samples: z.number().int().min(0).max(10_000_000).optional(),
    streams: z.array(z.string().regex(EVENT_KIND)).max(8).optional(),
  }),
  z.object({
    action: z.literal('events'),
    recordingId: id,
    events: z
      .array(
        z.object({
          seq: z.number().int().min(1).max(10_000_000),
          kind: z.string().regex(EVENT_KIND),
          monoMs: mono.optional(),
          clientUtcMs: z.number().optional(),
          data: small(MAX_EVENT_DATA).optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
  z.object({ action: z.literal('stop'), recordingId: id, endMonoMs: mono.optional() }),
]);

export async function POST(req: Request) {
  const who = await whoIsLogging();
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
  const body = parsed.data;

  if (body.action === 'start') {
    const session = await openSession(who.loggedBy);
    if (!session) return NextResponse.json({ error: 'no_open_job' }, { status: 409 });
    const base = body.mimeType.split(';')[0].trim();
    if (!(RECORDING_TYPES as readonly string[]).includes(base)) {
      return NextResponse.json({ error: 'unsupported_type' }, { status: 422 });
    }

    // Both halves of the consent, before a single frame is kept. The
    // worker's is standing, per version of the wording; the customer's is
    // per job, attested by the worker at the door.
    const workerId = await workerIdOf(who, session);
    if (!(await hasWorkerConsent(workerId))) {
      if (body.consent.worker !== CONSENT_VERSION) {
        return NextResponse.json(
          { error: 'consent_required', version: CONSENT_VERSION, statement: CONSENT_TEXT.worker },
          { status: 409 },
        );
      }
      await recordConsent('worker', workerId, who.loggedBy);
    }
    if (!body.consent.customer) return NextResponse.json({ error: 'customer_consent_required' }, { status: 409 });
    if (!(await hasCustomerConsent(session.id))) await recordConsent('customer', workerId, who.loggedBy, session.id);

    const config = captureConfig();
    const t0 = recordingStart(body.clock.t0EpochMs, body.clock, Date.now());
    const record = await startRecording(session.id, {
      mimeType: base,
      chunkSeconds: config.segmentSeconds,
      startedAt: new Date(t0.at),
      clockOffsetMs: t0.trusted ? body.clock.offsetMs : undefined,
      clockRttMs: t0.trusted ? body.clock.rttMs : undefined,
      capture: { ...(body.capture ?? {}), requestedMimeType: body.mimeType, config },
      device: body.device,
    });
    if (!t0.trusted) {
      // Said once, in the raw log, instead of being quietly papered over.
      await addEvents(record.id, [
        { kind: 'clock_untrusted', data: { t0EpochMs: body.clock.t0EpochMs, offsetMs: body.clock.offsetMs, rttMs: body.clock.rttMs } },
      ]);
    }
    return NextResponse.json({
      recordingId: record.id,
      sessionId: session.id,
      startedAt: record.startedAt,
      uploads: Boolean(record.storagePrefix),
      clockTrusted: t0.trusted,
      config,
    });
  }

  const record = await ownRecording(who.loggedBy, body.recordingId);
  if (!record) return NextResponse.json({ error: 'unknown_recording' }, { status: 404 });

  switch (body.action) {
    case 'piece-url': {
      const url = pieceUploadUrl(record, body.kind, body.index);
      if (!url) return NextResponse.json({ error: 'uploads_off' }, { status: 409 });
      return NextResponse.json({ url, contentType: pieceContentType(record, body.kind) });
    }
    case 'uploaded': {
      if (body.monoEndMs < body.monoStartMs) return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
      const result = await recordPiece(record, body.kind, body);
      return NextResponse.json({ ok: true, result });
    }
    case 'events':
      await addEvents(record.id, body.events);
      return NextResponse.json({ ok: true });
    case 'stop':
      await stopRecording(record, body.endMonoMs);
      return NextResponse.json({ ok: true });
  }
}
