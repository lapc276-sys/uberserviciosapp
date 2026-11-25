import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scoutRoom, sceneVerdict } from '@/lib/vision/scout';
import { questionsForRoom, MAX_QUESTIONS_PER_ROOM } from '@/lib/vision/upsell';
import { isDeepService } from '@/lib/vision/model';
import { validateFrames } from '@/lib/vision/input';
import { ROOM_TYPES, type RoomType } from '@/lib/vision/types';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { objectNoun, roomRemark } from '@/lib/vision/remarks';
import { LANGS } from '@/lib/capture/lang';

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
  /** The walkthrough's language; the questions and the remark come back in it. */
  lang: z.enum(LANGS).optional(),
  /**
   * The customer is pointing at something the walkthrough missed ("¿me salté
   * algo?"). The answer is what it is, not questions about it.
   */
  pointed: z.boolean().optional(),
});

/** Nothing to ask. Used for every failure, deliberately indistinguishable. */
const SILENT = { questions: [], objects: [], clutter: 0, remark: null, scouted: false };

export async function POST(req: Request) {
  const limit = rateLimit(`scout:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return NextResponse.json(SILENT);

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json(SILENT);

  const { frames, roomType, serviceSlug } = parsed.data;
  const lang = parsed.data.lang ?? 'es';

  // The same validation the analyzer uses, so one path cannot become a way
  // in that the other closed.
  if (validateFrames(frames) !== null) return NextResponse.json(SILENT);

  const result = await scoutRoom(frames, roomType as RoomType, { pointed: parsed.data.pointed });
  if (!result.ok) return NextResponse.json(SILENT);

  // Before a single question: is this the room at all? A car answered as a
  // kitchen is where "ya vi el microondas" came from, so a room that is not
  // there gets no questions and no remark — only the fact, to say out loud.
  const verdict = sceneVerdict(roomType as RoomType, result.scene, result.sceneConfidence);
  if (!verdict.matches) {
    return NextResponse.json({ ...SILENT, scouted: true, mismatch: { saw: verdict.saw } });
  }

  if (parsed.data.pointed) {
    const found = [...new Set(result.objects.filter((o) => o.confidence >= 0.5).map((o) => o.name))]
      .map((name) => ({ name, label: objectNoun(name, roomType as RoomType, lang) }))
      .filter((o): o is { name: string; label: string } => o.label !== null);
    return NextResponse.json({ ...SILENT, scouted: true, found });
  }

  // Room for the repair question, every depth question and the two tidying
  // ones. The depth list is already capped inside questionsForRoom; this
  // outer slice only guards against the whole card growing past what anyone
  // answers standing up.
  const questions = questionsForRoom(roomType as RoomType, result.objects, result.soil, {
    alreadyDeep: isDeepService(serviceSlug),
    tidying: result.tidying,
    damage: result.damage,
    lang,
  }).slice(0, MAX_QUESTIONS_PER_ROOM + 3);

  return NextResponse.json({
    questions,
    objects: result.objects,
    clutter: result.soil.clutter,
    // Built from the same scores the questions come from — see remarks.ts.
    remark: roomRemark(roomType as RoomType, result.conditions ?? [], lang),
    scouted: true,
  });
}
