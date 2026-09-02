import {
  ROOM_TYPES,
  SOIL_DIMENSIONS,
  EMPTY_SOIL,
  type AnalyzerInput,
  type RawRoomObservation,
  type RoomType,
  type SoilScores,
  type VisionAnalyzer,
} from './types';
import { appaPromptRubric } from './appa';
import { OBJECT_TIME_COST } from './model';

/**
 * Vision backends.
 *
 * `visionLlmAnalyzer` uses a hosted multimodal model on sampled frames — no
 * GPU infrastructure, cents per walkthrough, available today. When volume
 * justifies self-hosted detection (YOLO/SAM/Grounding DINO), implement the
 * same `VisionAnalyzer` interface and swap it in `getAnalyzer()`; nothing else
 * in the app changes.
 */

const SYSTEM_PROMPT = `You are a property inspection model for a professional cleaning company.
You receive still frames sampled from a walkthrough video of a home or business.

Identify each DISTINCT physical room visible across the frames. Multiple frames often show the SAME room from different angles — do not double-count. Prefer under-reporting rooms over inventing them.

Frames may be captioned. A caption looks like "[kitchen-1] kitchen — Dentro del microondas (Cocina)". When captions are present they are ground truth recorded at capture time, not guesses:
- The bracketed id identifies the physical space. Every frame sharing an id is the SAME room. Report exactly one room per distinct id, no more and no fewer.
- Use the caption's room type rather than inferring one from the pixels.
- The Spanish text says what the camera was aimed at, so judge that surface. A frame captioned "Dentro del horno" is scored on the inside of the oven, not on the kitchen around it.
- Score each room from all of its frames together. A close-up of clean countertops does not make the room clean if its floor frame is filthy.
- An uncaptioned frame is an extra the person added; assign it to a captioned space if it clearly belongs to one, otherwise treat it as its own room.

Rate soiling against this published industry rubric, not against your own sense of "dirty". A human inspector is scoring the same rooms with these exact words, and the two of you must be able to disagree about the room rather than about what the number means:

${appaPromptRubric()}

For each room, rate each dimension 0-100 using that rubric:
- dust: visible dust, cobwebs, film on surfaces
- grease: cooking grease, oily residue (mostly kitchens)
- stains: set-in marks on floors, counters, walls, fixtures
- clutter: items out of place that must be moved before cleaning
- hair: pet or human hair accumulation
- trash: loose garbage, food waste, packaging
- mold: mildew or mold, especially grout, caulk, damp corners

List the objects you can actually see, with a count and your confidence, using EXACTLY these names — anything else is discarded, and a near-miss like "fridge door" or "kitchen cabinets" matches nothing:

${Object.keys(OBJECT_TIME_COST).sort().join(', ')}

Count what you can see. Ten cabinet doors is cabinet:10, not cabinet:1. Do not list an object because a room of this type usually has one; a kitchen you cannot see the oven in has no oven.

Also report these, which are never cleaned themselves but say who lives here and therefore how fast the place gets dirty again: baby bottle, bottle warmer, changing table, diaper, baby toys, toys, toy box, play mat, dog bowl, cat bowl, pet bowl, pet food, dog food, cat food, dog bed, leash, scratching post, dog, cat, ashtray, cigarettes, moving boxes, cardboard boxes.

Be conservative and evidence-based. If a frame is blurry, dark, or ambiguous, lower your confidence rather than guessing. Do NOT estimate time or price — that is computed separately.

Respond ONLY with JSON matching:
{"rooms":[{"type":"kitchen","confidence":0.0-1.0,"objects":[{"name":"oven","count":1,"confidence":0.0-1.0}],"soil":{"dust":0,"grease":0,"stains":0,"clutter":0,"hair":0,"trash":0,"mold":0},"notes":"short observation"}],"warnings":["..."]}

Valid room types: ${ROOM_TYPES.join(', ')}.`;

function coerceRoomType(value: unknown): RoomType {
  const s = String(value ?? '').toLowerCase().replace(/\s+/g, '_');
  return (ROOM_TYPES as readonly string[]).includes(s) ? (s as RoomType) : 'other';
}

function coerceSoil(raw: any): SoilScores {
  const out = { ...EMPTY_SOIL };
  for (const dim of SOIL_DIMENSIONS) {
    const n = Number(raw?.[dim]);
    out[dim] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  }
  return out;
}

function coerceObservations(parsed: any): { rooms: RawRoomObservation[]; warnings: string[] } {
  const rawRooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
  const rooms: RawRoomObservation[] = rawRooms.slice(0, 30).map((r: any) => ({
    type: coerceRoomType(r?.type),
    confidence: Math.max(0, Math.min(Number(r?.confidence) || 0.5, 1)),
    objects: Array.isArray(r?.objects)
      ? r.objects
          .filter((o: any) => typeof o?.name === 'string' && o.name.trim())
          .slice(0, 25)
          .map((o: any) => ({
            name: String(o.name).trim().toLowerCase(),
            count: Math.max(1, Math.min(Number(o?.count) || 1, 20)),
            confidence: Math.max(0, Math.min(Number(o?.confidence) || 0.5, 1)),
          }))
      : [],
    soil: coerceSoil(r?.soil),
    notes: typeof r?.notes === 'string' ? r.notes.slice(0, 280) : undefined,
  }));

  const warnings = Array.isArray(parsed?.warnings)
    ? parsed.warnings.filter((w: any) => typeof w === 'string').slice(0, 5)
    : [];

  return { rooms, warnings };
}

export const visionLlmAnalyzer: VisionAnalyzer = {
  name: 'vision-llm',
  async analyze({ frames, captions, focus }: AnalyzerInput) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { rooms: [], warnings: ['Vision model not configured.'] };

    // A caption goes immediately before the image it describes. Sending them
    // as one block up front would make the model count positions to pair them
    // up, and an off-by-one there labels every frame with its neighbour.
    const frameParts = frames.flatMap((url, i) => {
      const caption = captions?.[i]?.trim();
      const image = { type: 'image_url' as const, image_url: { url, detail: 'low' as const } };
      return caption ? [{ type: 'text' as const, text: `Frame ${i + 1} — ${caption}` }, image] : [image];
    });

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.OPENAI_VISION_MODEL ?? 'gpt-4o',
          temperature: 0.2,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: captions?.length
                    ? `Analyze these ${frames.length} captioned frames from a guided walkthrough. The captions were recorded as each shot was taken — trust them for room identity.`
                    : `Analyze these ${frames.length} frames from a property walkthrough.`,
                },
                // The customer's own words about what matters to them. It
                // directs attention, never conclusions: somebody insisting
                // their kitchen is spotless does not make the grease go away.
                ...(focus?.trim()
                  ? [
                      {
                        type: 'text' as const,
                        text: `The customer asked for attention on: "${focus.trim().slice(0, 400)}". Look there carefully. Score what you actually see — their description is a hint about where to look, not a claim to accept.`,
                      },
                    ]
                  : []),
                ...frameParts,
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        console.error('[vision] model error', res.status, await res.text().catch(() => ''));
        return { rooms: [], warnings: ['Vision model unavailable.'] };
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return { rooms: [], warnings: ['Vision model returned no content.'] };

      return coerceObservations(JSON.parse(content));
    } catch (err) {
      console.error('[vision] analyze failed', err);
      return { rooms: [], warnings: ['Vision analysis failed.'] };
    }
  },
};

/**
 * Deterministic stand-in so the whole flow — upload, analysis, quote, booking —
 * is demoable and testable without an API key. It derives a plausible layout
 * from the number of frames rather than pretending to see anything, and always
 * flags itself so no one mistakes it for a real inspection.
 */
export const heuristicAnalyzer: VisionAnalyzer = {
  name: 'heuristic',
  async analyze({ frames }: AnalyzerInput) {
    const roomCount = Math.max(2, Math.min(Math.round(frames.length / 2), 8));
    const layout: RoomType[] = ['living_room', 'kitchen', 'bathroom', 'bedroom', 'bedroom', 'dining_room', 'hallway', 'office'];

    const rooms: RawRoomObservation[] = Array.from({ length: roomCount }, (_, i) => {
      const type = layout[i % layout.length];
      const soil = { ...EMPTY_SOIL, dust: 30, clutter: 25, stains: 15 };
      if (type === 'kitchen') Object.assign(soil, { grease: 45, stains: 30, trash: 20 });
      if (type === 'bathroom') Object.assign(soil, { mold: 30, stains: 35, hair: 25 });

      const objects =
        type === 'kitchen'
          ? [
              { name: 'oven', count: 1, confidence: 0.6 },
              { name: 'refrigerator', count: 1, confidence: 0.6 },
              { name: 'microwave', count: 1, confidence: 0.5 },
            ]
          : type === 'bathroom'
            ? [
                { name: 'toilet', count: 1, confidence: 0.6 },
                { name: 'shower', count: 1, confidence: 0.6 },
                { name: 'mirror', count: 1, confidence: 0.5 },
              ]
            : [{ name: 'window', count: 2, confidence: 0.5 }];

      return { type, confidence: 0.4, objects, soil };
    });

    return {
      rooms,
      warnings: ['Demo estimate — no vision model configured, so this is not a real inspection.'],
    };
  },
};

export function getAnalyzer(): VisionAnalyzer {
  return process.env.OPENAI_API_KEY ? visionLlmAnalyzer : heuristicAnalyzer;
}
