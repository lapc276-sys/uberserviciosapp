import {
  EMPTY_SOIL,
  ROOM_TYPES,
  SOIL_DIMENSIONS,
  type DetectedDamage,
  type DetectedObject,
  type RoomType,
  type SoilScores,
  type TidyingCounts,
} from './types';
import { OBJECT_TIME_COST } from './model';
import { coerceTidying } from './tidying';
import { damagePromptSection, knownDamage } from './damage';
import { ISSUES, coerceConditions, type ObjectCondition } from './remarks';

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

const SYSTEM_PROMPT = `You are looking at frames captured seconds ago by someone walking through a home with a phone.

Your only job is to say what is physically in front of the camera and how cluttered it is. Do NOT estimate time, price, or effort.

FIRST, before anything else, say what the frames actually show, as "scene":
- one of ${ROOM_TYPES.filter((t) => t !== 'other').join(', ')} — when they show that room of a home or office
- "none" — when they do not show the inside of a home or office at all: the inside of a car, a street, a parking lot, a shop, a screen, a person, a hand over the lens
- "unclear" — when they are too dark, too blurry or too close to tell
and "sceneConfidence", 0.0-1.0.

You will be told which room the person was ASKED to film. That is what they were asked, not proof of what is in the frames: people test this app in cars and offices. Never report an object because that room usually has one, or because you were told the room's name. If the scene is "none", report no objects, no damage and no clutter.

List the objects you can actually see, using EXACTLY these names — anything else is discarded:

${Object.keys(OBJECT_TIME_COST).sort().join(', ')}

Count what you see. Ten cabinet doors is cabinet:10. Do not list an object because a room of this type usually has one: a kitchen you cannot see the oven in has no oven. If a frame is dark or blurry, lower your confidence rather than guessing.

For each object, also rate how dirty THAT object looks, as "dirt": 0 = clean, 1 = a little (light dust, a few marks), 2 = dirty (visible grease, stains or buildup), 3 = very dirty. When it is 1 or more, name the main problem as "issue", using exactly one of: ${ISSUES.join(', ')}. If you cannot see the object well enough to judge, leave "dirt" out.

Also rate clutter 0-100: how much is out of place and would have to be moved before cleaning could start. 0 is clear surfaces, 100 is unusable.

And count, roughly, three things you can see:
- toClear: loose items on floors and surfaces that would have to be moved to clean — clothes, toys, shoes, papers, bottles
- elsewhere: of those, how many plainly belong in a different room, like a sock in the kitchen. Never more than toClear.
- dishes: dishes, cups, pots and pans waiting to be washed

${damagePromptSection()}

Respond ONLY with JSON:
{"scene":"kitchen","sceneConfidence":0.0-1.0,"objects":[{"name":"oven","count":1,"confidence":0.0-1.0,"dirt":0,"issue":"grease"}],"clutter":0,"tidying":{"toClear":0,"elsewhere":0,"dishes":0},"damage":[{"kind":"cabinet","confidence":0.0-1.0}]}`;

/** What the frames show, by the model's account, before any object is listed. */
export type Scene = RoomType | 'none' | 'unclear';

export interface ScoutResult {
  /** "none" for a car or a street; "unclear" when it could not tell. */
  scene: Scene;
  sceneConfidence: number;
  objects: DetectedObject[];
  soil: SoilScores;
  /** What the questions about tidying and dishes are built from. */
  tidying?: TidyingCounts;
  /** Broken things, for the repair question. Known kinds only. */
  damage?: DetectedDamage[];
  /** How dirty each object looked, for the remark said as the room is left. */
  conditions?: ObjectCondition[];
  /** False when nothing could be looked at — no key, no network, bad reply. */
  ok: boolean;
}

const NOTHING: ScoutResult = { scene: 'unclear', sceneConfidence: 0, objects: [], soil: { ...EMPTY_SOIL }, ok: false };

/**
 * Rooms whose objects are the expensive questions — the oven inside, the
 * shower scrubbed — and which no other room can pass for. A pan of an office
 * answered as a kitchen is how "I can see the microwave" got said in a car.
 * A bedroom that turns out to be a study is still the same clean, and asking
 * about it would only interrupt.
 */
const DISTINCTIVE = new Set<RoomType>(['kitchen', 'bathroom', 'laundry']);

/** One open-plan space seen from different corners. */
const OPEN_PLAN = new Set<RoomType>(['kitchen', 'dining_room', 'living_room']);

/** Below this the model is unsure enough that saying so would be the insult. */
export const MISMATCH_CONFIDENCE = 0.6;

export interface SceneVerdict {
  /** False when the walkthrough should stop and say what it saw. */
  matches: boolean;
  /** What was seen instead, when it does not match. */
  saw?: RoomType | 'none';
}

/**
 * Whether the room the person was asked to film is the room in the frames.
 *
 * Errs towards "matches": a false alarm stops somebody in their own kitchen
 * to say it is not a kitchen, which is the one thing worse than a missed
 * one. So "unclear" always passes, a different room only fails for the rooms
 * nothing else can pass for, and every failure needs a confident model.
 */
export function sceneVerdict(asked: RoomType, scene: Scene, confidence: number): SceneVerdict {
  if (scene === 'unclear' || confidence < MISMATCH_CONFIDENCE) return { matches: true };
  if (scene === 'none') return { matches: false, saw: 'none' };
  if (scene === asked || asked === 'other') return { matches: true };
  // A Brooklyn kitchen is often a wall of the living room: a pan of it that
  // reads as "living room" is the right room, not a wrong one.
  if (OPEN_PLAN.has(asked) && OPEN_PLAN.has(scene)) return { matches: true };
  if (!DISTINCTIVE.has(asked)) return { matches: true };
  return { matches: false, saw: scene };
}

/** Exported for tests: what a model reply is allowed to become. */
function coerceScene(value: unknown): Scene {
  const s = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (s === 'none' || s === 'unclear') return s;
  return (ROOM_TYPES as readonly string[]).includes(s) && s !== 'other' ? (s as RoomType) : 'unclear';
}

export function coerceScout(parsed: unknown): ScoutResult {
  const raw = parsed as {
    scene?: unknown;
    sceneConfidence?: unknown;
    objects?: unknown;
    clutter?: unknown;
    tidying?: unknown;
    damage?: unknown;
  };
  // A reply without a scene is from before the question existed, or a model
  // that skipped it: "unclear", which never stops anybody.
  const scene = coerceScene(raw?.scene);
  const sceneConfidence = Math.max(0, Math.min(Number(raw?.sceneConfidence) || 0, 1));
  if (scene === 'none' && sceneConfidence >= MISMATCH_CONFIDENCE) {
    // Nothing of a home in the frames: whatever it listed, it imagined.
    return { scene, sceneConfidence, objects: [], soil: { ...EMPTY_SOIL }, conditions: [], ok: true };
  }
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

  return {
    scene,
    sceneConfidence,
    objects,
    soil,
    tidying: coerceTidying(raw?.tidying),
    damage: knownDamage(raw?.damage),
    // Catalogue names only, like the objects: a condition for something the
    // price never heard of would be a remark about nothing.
    conditions: coerceConditions(raw?.objects).filter((c) => Boolean(OBJECT_TIME_COST[c.name])),
    ok: true,
  };
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
  options: { signal?: AbortSignal; pointed?: boolean } = {},
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
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                // Said as what was asked, never as a fact: "This is a kitchen"
                // is how a car seat became a microwave.
                text: options.pointed
                  ? `The person was asked to point the camera at something in the ${roomType} that a walkthrough missed. Say the scene, then list only the object or objects at the centre of the frame.`
                  : `The person was asked to film the ${roomType}. Say what the frames actually show, then list what you can see.`,
              },
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

    return coerceScout(JSON.parse(content));
  } catch (err) {
    // Includes the abort the caller fires when the person moved on. Nothing
    // here is worth surfacing to somebody holding a phone.
    console.error('[scout] failed', err);
    return NOTHING;
  }
}
