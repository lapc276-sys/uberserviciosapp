import { EMPTY_SOIL, SOIL_DIMENSIONS, type DetectedObject, type RoomType, type SoilScores } from './types';
import { OBJECT_TIME_COST } from './model';

/**
 * A quick look at one room, mid-walkthrough, so the next question can be
 * about what is actually there.
 *
 * Deliberately not the full analyzer. That one scores seven soil dimensions
 * against a published rubric across every room at once and is worth its
 * latency at the end of a walk; this runs while somebody stands in their own
 * kitchen waiting, so it asks one room, one short question, and nothing else.
 *
 * This does not break the rule that the shutter never consults the model.
 * That rule is about cadence: asking "is the fridge open yet?" is a network
 * round trip per frame, a hundred per walkthrough, in a basement with no
 * signal. This is one call per room at the moment the person has stopped
 * moving anyway, and when it fails the walkthrough carries on with the fixed
 * script rather than stalling — see `scoutRoom`'s empty return.
 */

const MAX_SCOUT_FRAMES = 4;

const SYSTEM_PROMPT = `You are looking at frames from one room of a home, captured seconds ago by someone walking through it with a phone.

Your only job is to say what is physically in this room and how cluttered it is. Do NOT estimate time, price, or effort.

List the objects you can actually see, using EXACTLY these names — anything else is discarded:

${Object.keys(OBJECT_TIME_COST).sort().join(', ')}

Count what you see. Ten cabinet doors is cabinet:10. Do not list an object because a room of this type usually has one: a kitchen you cannot see the oven in has no oven. If a frame is dark or blurry, lower your confidence rather than guessing.

Also rate clutter 0-100: how much is out of place and would have to be moved before cleaning could start. 0 is clear surfaces, 100 is unusable.

Respond ONLY with JSON:
{"objects":[{"name":"oven","count":1,"confidence":0.0-1.0}],"clutter":0}`;

export interface ScoutResult {
  objects: DetectedObject[];
  soil: SoilScores;
  /** False when nothing could be looked at — no key, no network, bad reply. */
  ok: boolean;
}

const NOTHING: ScoutResult = { objects: [], soil: { ...EMPTY_SOIL }, ok: false };

function coerce(parsed: unknown): ScoutResult {
  const raw = parsed as { objects?: unknown; clutter?: unknown };
  const objects = Array.isArray(raw?.objects)
    ? raw.objects
        .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
        .filter((o) => typeof o.name === 'string' && o.name.trim())
        .slice(0, 25)
        .map((o) => ({
          name: String(o.name).trim().toLowerCase(),
          count: Math.max(1, Math.min(Number(o.count) || 1, 20)),
          confidence: Math.max(0, Math.min(Number(o.confidence) || 0.5, 1)),
        }))
        // A name outside the catalogue prices at zero and would produce a
        // question about something that costs nothing, so it is dropped here
        // rather than further down where it looks like a pricing bug.
        .filter((o) => Boolean(OBJECT_TIME_COST[o.name]))
    : [];

  const clutter = Number(raw?.clutter);
  const soil: SoilScores = { ...EMPTY_SOIL };
  for (const dim of SOIL_DIMENSIONS) soil[dim] = 0;
  soil.clutter = Number.isFinite(clutter) ? Math.max(0, Math.min(100, Math.round(clutter))) : 0;

  return { objects, soil, ok: true };
}

/**
 * Returns what is in the room, or `ok: false` if it could not look.
 *
 * Never throws and never rejects. A failed scout must degrade to the fixed
 * script — the person is standing in a kitchen and the walkthrough has to
 * continue — so every failure path returns the same empty result and the
 * caller cannot tell a missing API key from a dead network, because it should
 * not behave differently either way.
 */
export async function scoutRoom(
  frames: string[],
  roomType: RoomType,
  options: { signal?: AbortSignal } = {},
): Promise<ScoutResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || frames.length === 0) return NOTHING;

  // The last frames of a pan are the ones taken once the sweep settled; the
  // first are usually still moving.
  const looked = frames.slice(-MAX_SCOUT_FRAMES);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: options.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL ?? 'gpt-4o',
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `This is a ${roomType}. List what you can see in it.` },
              ...looked.map((url) => ({
                type: 'image_url' as const,
                image_url: { url, detail: 'low' as const },
              })),
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error('[scout] model error', res.status);
      return NOTHING;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return NOTHING;

    return coerce(JSON.parse(content));
  } catch (err) {
    // Includes the abort the caller fires when the person moved on. Nothing
    // here is worth surfacing to somebody holding a phone.
    console.error('[scout] failed', err);
    return NOTHING;
  }
}
