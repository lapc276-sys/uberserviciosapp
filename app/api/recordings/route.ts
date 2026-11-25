import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { PRO_SESSION_COOKIE, verifyProSession } from '@/lib/pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { openSession } from '@/lib/activity/store';
import {
  chunkUploadUrl,
  getRecording,
  markChunkUploaded,
  startRecording,
  stopRecording,
  RECORDING_TYPES,
  type RecordingRecord,
} from '@/lib/activity/recordings';

/**
 * Hands-free video of a job: start, one signed URL per 30-second piece, a
 * confirmation when each lands, stop.
 *
 * A recording belongs to the open job of whoever is signed in, and only they
 * can add to it — the identity comes from the cookie, as for the timer. The
 * video bytes never pass through here: the phone PUTs them to the bucket.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function whoIsLogging(): Promise<string | null> {
  const jar = await cookies();
  const [pro, admin] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);
  return pro?.email || admin?.email || null;
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    mimeType: z.string().max(80),
    chunkSeconds: z.number().int().min(5).max(120),
  }),
  z.object({ action: z.literal('chunk'), recordingId: z.string().max(64), index: z.number().int().min(0).max(5000) }),
  z.object({
    action: z.literal('uploaded'),
    recordingId: z.string().max(64),
    index: z.number().int().min(0).max(5000),
    kilobytes: z.number().min(0).max(200_000),
  }),
  z.object({ action: z.literal('stop'), recordingId: z.string().max(64) }),
]);

/** The recording, if it belongs to the job this person has open. */
async function ownRecording(loggedBy: string, recordingId: string): Promise<RecordingRecord | null> {
  const [session, record] = await Promise.all([openSession(loggedBy), getRecording(recordingId)]);
  if (!session || !record || record.sessionId !== session.id) return null;
  return record;
}

export async function POST(req: Request) {
  const loggedBy = await whoIsLogging();
  if (!loggedBy) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 422 });
  const body = parsed.data;

  if (body.action === 'start') {
    const session = await openSession(loggedBy);
    if (!session) return NextResponse.json({ error: 'no_open_job' }, { status: 409 });
    const base = body.mimeType.split(';')[0].trim();
    if (!(RECORDING_TYPES as readonly string[]).includes(base)) {
      return NextResponse.json({ error: 'unsupported_type' }, { status: 422 });
    }
    const record = await startRecording(session.id, base, body.chunkSeconds);
    return NextResponse.json({ recordingId: record.id, uploads: Boolean(record.storagePrefix) });
  }

  const record = await ownRecording(loggedBy, body.recordingId);
  if (!record) return NextResponse.json({ error: 'unknown_recording' }, { status: 404 });

  switch (body.action) {
    case 'chunk': {
      const url = chunkUploadUrl(record, body.index);
      if (!url) return NextResponse.json({ error: 'uploads_off' }, { status: 409 });
      return NextResponse.json({ url, contentType: record.mimeType });
    }
    case 'uploaded':
      await markChunkUploaded(record, body.index, body.kilobytes);
      return NextResponse.json({ ok: true });
    case 'stop':
      await stopRecording(record);
      return NextResponse.json({ ok: true });
  }
}
