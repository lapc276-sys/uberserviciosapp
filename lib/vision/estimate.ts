import {
  ROOM_LABELS,
  EMPTY_SOIL,
  type PropertyAnalysis,
  type RawRoomObservation,
  type RoomAnalysis,
  type SoilScores,
  type SoilDimension,
  type ConditionLevel,
} from './types';
import {
  ROOM_BASE_MINUTES,
  OBJECT_TIME_COST,
  SUPPLY_RULES,
  MINUTES_PER_PRO,
  SERVICE_TIME_MULTIPLIER,
  soilWeightsFor,
  soilIndex,
  conditionFromIndex,
} from './model';

/**
 * Turns raw model observations into a costed plan.
 *
 * Time is computed here, never by the vision model: models are good at "how
 * dirty is this" and bad at "how many minutes does that take". Keeping the
 * arithmetic in code makes it auditable and calibratable.
 */

function clampScore(n: unknown): number {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSoil(soil: Partial<SoilScores> | undefined): SoilScores {
  const out = { ...EMPTY_SOIL };
  for (const key of Object.keys(EMPTY_SOIL) as SoilDimension[]) {
    out[key] = clampScore(soil?.[key]);
  }
  return out;
}

function roomMinutes(room: RawRoomObservation, soil: SoilScores): number {
  const base = ROOM_BASE_MINUTES[room.type] ?? ROOM_BASE_MINUTES.other;
  const weights = soilWeightsFor(room.type);

  // Soil contributes its weighted minutes scaled by severity.
  const soilMinutes = (Object.keys(weights) as SoilDimension[]).reduce(
    (sum, key) => sum + (soil[key] / 100) * weights[key],
    0,
  );

  // Objects add fixed handling time, discounted by detection confidence so a
  // shaky guess can't inflate the bill.
  const objectMinutes = room.objects.reduce((sum, obj) => {
    const key = obj.name.trim().toLowerCase();
    const cost = OBJECT_TIME_COST[key];
    if (!cost) return sum;
    const count = Math.max(1, Math.min(obj.count || 1, 6));
    const weight = Math.max(0.3, Math.min(obj.confidence || 0.5, 1));
    return sum + cost * count * weight;
  }, 0);

  return base + soilMinutes + objectMinutes;
}

/** Labels repeated room types as "Bedroom 2", "Bathroom 3", etc. */
function labelRooms(rooms: RawRoomObservation[]): string[] {
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const r of rooms) totals.set(r.type, (totals.get(r.type) ?? 0) + 1);

  return rooms.map((r) => {
    const base = ROOM_LABELS[r.type] ?? ROOM_LABELS.other;
    if ((totals.get(r.type) ?? 0) < 2) return base;
    const n = (seen.get(r.type) ?? 0) + 1;
    seen.set(r.type, n);
    return `${base} ${n}`;
  });
}

export interface EstimateOptions {
  serviceSlug: string;
  source: PropertyAnalysis['source'];
  warnings?: string[];
}

export function buildAnalysis(
  observations: RawRoomObservation[],
  { serviceSlug, source, warnings = [] }: EstimateOptions,
): PropertyAnalysis {
  const labels = labelRooms(observations);
  const multiplier = SERVICE_TIME_MULTIPLIER[serviceSlug] ?? 1;

  const rooms: RoomAnalysis[] = observations.map((obs, i) => {
    const soil = normalizeSoil(obs.soil);
    const minutes = roomMinutes(obs, soil) * multiplier;
    return {
      type: obs.type,
      label: labels[i],
      confidence: Math.max(0, Math.min(obs.confidence ?? 0.5, 1)),
      objects: obs.objects.filter((o) => o.name?.trim()).slice(0, 25),
      soil,
      condition: conditionFromIndex(soilIndex(soil, obs.type)),
      estimatedMinutes: Math.round(minutes),
      notes: obs.notes,
    };
  });

  const totalMinutes = rooms.reduce((sum, r) => sum + r.estimatedMinutes, 0);

  // Overall condition weights each room by the work it represents, so one
  // spotless hallway can't offset a disastrous kitchen.
  const weightedIndex =
    totalMinutes > 0
      ? rooms.reduce((sum, r) => sum + soilIndex(r.soil, r.type) * r.estimatedMinutes, 0) / totalMinutes
      : 0;

  const allObjects = rooms.flatMap((r) => r.objects.map((o) => o.name.toLowerCase()));
  const worstSoil = rooms.reduce<SoilScores>((acc, r) => {
    for (const key of Object.keys(acc) as SoilDimension[]) acc[key] = Math.max(acc[key], r.soil[key]);
    return acc;
  }, { ...EMPTY_SOIL });

  const supplies = SUPPLY_RULES.filter((rule) => rule.when(worstSoil, allObjects)).map((r) => r.supply);

  const confidence = rooms.length
    ? rooms.reduce((sum, r) => sum + r.confidence, 0) / rooms.length
    : 0;

  const allWarnings = [...warnings];
  if (rooms.length === 0) allWarnings.push('No rooms could be identified in the footage.');
  if (confidence < 0.55 && rooms.length > 0) {
    allWarnings.push('Low confidence — a pro will confirm details on arrival.');
  }

  return {
    rooms,
    totalMinutes: Math.round(totalMinutes),
    recommendedPros: Math.max(1, Math.ceil(totalMinutes / MINUTES_PER_PRO)),
    suppliesNeeded: [...new Set(supplies)],
    condition: conditionFromIndex(weightedIndex) as ConditionLevel,
    confidence: Number(confidence.toFixed(2)),
    source,
    warnings: allWarnings,
  };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
