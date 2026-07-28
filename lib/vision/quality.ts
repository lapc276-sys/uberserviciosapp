import { SOIL_DIMENSIONS, type PropertyAnalysis, type SoilDimension } from './types';

/**
 * Quality assessment from before/after analyses.
 *
 * Turns "the job is done" into a measurable claim: how much did each soil
 * dimension actually drop, and what is still dirty. That serves three
 * purposes at once — proof for the customer, automated QA for the platform,
 * and another labeled data point for the model.
 *
 * Deliberately measures *improvement*, not final state: a hoarder's kitchen
 * taken from 90 to 25 is excellent work, while a tidy flat left at 25 is not.
 */

/** Soil left above this is treated as "still needs attention". */
const REMAINING_THRESHOLD = 30;

/** Below this starting level there was nothing meaningful to improve. */
const NEGLIGIBLE_BEFORE = 10;

export interface RoomQuality {
  label: string;
  /** Weighted soil before and after, 0-100. */
  before: number;
  after: number;
  /** Percentage of the original soil removed, 0-100. */
  improvement: number;
}

export interface MissedArea {
  room: string;
  dimension: SoilDimension;
  remaining: number;
}

export type QualityVerdict = 'excellent' | 'good' | 'needs_attention' | 'insufficient_data';

export interface QualityAssessment {
  score: number; // 0-100
  verdict: QualityVerdict;
  byRoom: RoomQuality[];
  missedAreas: MissedArea[];
  /** Human-readable summary, safe to show a customer. */
  summary: string;
}

function meanSoil(soil: Record<string, number>): number {
  const total = SOIL_DIMENSIONS.reduce((sum, d) => sum + (soil[d] ?? 0), 0);
  return total / SOIL_DIMENSIONS.length;
}

function verdictFor(score: number): QualityVerdict {
  if (score >= 85) return 'excellent';
  if (score >= 65) return 'good';
  return 'needs_attention';
}

/**
 * Matches rooms between the two walkthroughs by type and order, since the
 * after-video is usually filmed in a different sequence.
 */
function pairRooms(before: PropertyAnalysis, after: PropertyAnalysis) {
  const used = new Set<number>();
  return before.rooms.map((beforeRoom) => {
    const matchIndex = after.rooms.findIndex((r, i) => !used.has(i) && r.type === beforeRoom.type);
    if (matchIndex >= 0) used.add(matchIndex);
    return { beforeRoom, afterRoom: matchIndex >= 0 ? after.rooms[matchIndex] : null };
  });
}

export function assessQuality(before: PropertyAnalysis, after: PropertyAnalysis): QualityAssessment {
  const pairs = pairRooms(before, after);
  const matched = pairs.filter((p) => p.afterRoom !== null);

  if (matched.length === 0) {
    return {
      score: 0,
      verdict: 'insufficient_data',
      byRoom: [],
      missedAreas: [],
      summary: 'The after-walkthrough didn’t show the same rooms, so improvement couldn’t be measured.',
    };
  }

  const byRoom: RoomQuality[] = [];
  const missedAreas: MissedArea[] = [];
  let weightedImprovement = 0;
  let weightTotal = 0;

  for (const { beforeRoom, afterRoom } of matched) {
    if (!afterRoom) continue;

    const beforeLevel = meanSoil(beforeRoom.soil);
    const afterLevel = meanSoil(afterRoom.soil);

    // Rooms that started clean can't demonstrate improvement — report them,
    // but don't let them drag the score in either direction.
    const improvable = beforeLevel > NEGLIGIBLE_BEFORE;
    const improvement = improvable
      ? Math.max(0, Math.min(100, ((beforeLevel - afterLevel) / beforeLevel) * 100))
      : 100;

    byRoom.push({
      label: beforeRoom.label,
      before: Math.round(beforeLevel),
      after: Math.round(afterLevel),
      improvement: Math.round(improvement),
    });

    if (improvable) {
      // Dirtier rooms represent more of the job, so they weigh more.
      weightedImprovement += improvement * beforeLevel;
      weightTotal += beforeLevel;
    }

    for (const dim of SOIL_DIMENSIONS) {
      const remaining = afterRoom.soil[dim] ?? 0;
      if (remaining >= REMAINING_THRESHOLD) {
        missedAreas.push({ room: beforeRoom.label, dimension: dim, remaining });
      }
    }
  }

  const score = weightTotal > 0 ? Math.round(weightedImprovement / weightTotal) : 100;
  const verdict = verdictFor(score);

  missedAreas.sort((a, b) => b.remaining - a.remaining);

  const summary =
    verdict === 'excellent'
      ? `Excellent result — ${score}% of the original soiling removed across ${byRoom.length} ${byRoom.length === 1 ? 'room' : 'rooms'}.`
      : verdict === 'good'
        ? `Good result — ${score}% improvement. ${missedAreas.length ? `${missedAreas.length} ${missedAreas.length === 1 ? 'area' : 'areas'} could use another pass.` : ''}`.trim()
        : `${score}% improvement. ${missedAreas
            .slice(0, 3)
            .map((m) => `${m.room.toLowerCase()} (${m.dimension})`)
            .join(', ')} still need attention.`;

  return { score, verdict, byRoom, missedAreas: missedAreas.slice(0, 12), summary };
}
