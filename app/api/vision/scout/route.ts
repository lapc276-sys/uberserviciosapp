import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scoutRoom } from '@/lib/vision/scout';
import { questionsForRoom, MAX_QUESTIONS_PER_ROOM } from '@/lib/vision/upsell';
import { isDeepService } from '@/lib/vision/model';
import { validateFrames } from '@/lib/vision/input';
import { ROOM_TYPES, type RoomType } from '@/lib/vision/types';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/vision/scout — what is in this room, and what should we ask about it.
 *
 * Called once per room, right after its pan, while the person is standing
 * still. Answering takes a few seconds, so everything that can be cut has
 * been: four frames at most, one short prompt, no soil rubric, no pricing.
 *
 * It never returns an error the caller has to handle. A room it could not
 * look at comes back with no questions, and the walkthrough continues on the
 * fixed script — which is the correct behaviour in a basement with no signal
 * and the reason this is a separate route from /api/vision/analyze, whose
 * failures the customer genuinely does need to hear about.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

/** A pan is a handful of frames; more than this is not a pan. */
const MAX_FRAMES = 8;

const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const schema = z.object({
  frames: z.array(z.string()).min(1).max(MAX_FRAMES),
  roomType: z.string().refine((r) => (ROOM_TYPES as readonly string[]).includes(r), 'Unknown room'),
  serviceSlug: z.string().min(1),
});

/** Nothing to ask. Used for every failure, deliberately indistinguishable. */
const SILENT = { questions: [], objects: [], clutter: 0, scouted: false };

export async function POST(req: Request) {
  const limit = rateLimit(`scout:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return NextResponse.json(SILENT);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json(SILENT);

  const { frames, roomType, serviceSlug } = parsed.data;

  // The same validation the analyzer uses, so one path cannot become a way
  // in that the other closed.
  if (validateFrames(frames) !== null) return NextResponse.json(SILENT);

  const result = await scoutRoom(frames, roomType as RoomType);
  if (!result.ok) return NextResponse.json(SILENT);

  const questions = questionsForRoom(roomType as RoomType, result.objects, result.soil, {
    alreadyDeep: isDeepService(serviceSlug),
  }).slice(0, MAX_QUESTIONS_PER_ROOM + 1);

  return NextResponse.json({
    questions,
    objects: result.objects,
    clutter: result.soil.clutter,
    scouted: true,
  });
}
