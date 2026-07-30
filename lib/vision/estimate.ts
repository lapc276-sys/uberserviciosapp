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
import { planSupplies } from './supplies';
import { planRoomTasks } from './tasks';
import {
  DEFAULT_TIME_MODEL,
  soilWeightsFor,
  soilIndex,
  conditionFromIndex,
  type TimeModelParams,
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

function roomMinutes(room: RawRoomObservation, soil: SoilScores, params: TimeModelParams): number {
  const base = params.roomBaseMinutes[room.type] ?? params.roomBaseMinutes.other;
  const weights = soilWeightsFor(room.type, params);

  // Soil contributes its weighted minutes scaled by severity.
  const soilMinutes = (Object.keys(weights) as SoilDimension[]).reduce(
    (sum, key) => sum + (soil[key] / 100) * weights[key],
    0,
  );

  // Objects add fixed handling time, discounted by detection confidence so a
  // shaky guess can't inflate the bill.
  const objectMinutes = room.objects.reduce((sum, obj) => {
    const key = obj.name.trim().toLowerCase();
    const cost = params.objectTimeCost[key];
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
  /**
   * The calibrated model for this market. Defaults to the uncalibrated
   * hypothesis so this function stays pure and callable from a test without a
   * database — the caller is responsible for loading the market's model.
   */
  model?: TimeModelParams;
}

export function buildAnalysis(
  observations: RawRoomObservation[],
  { serviceSlug, source, warnings = [], model = DEFAULT_TIME_MODEL }: EstimateOptions,
): PropertyAnalysis {
  const labels = labelRooms(observations);
  const multiplier = model.serviceTimeMultiplier[serviceSlug] ?? 1;

  // Both estimators run for every room. The unused one costs nothing and is the
  // only way to watch the two converge — or fail to — as field data lands.
  const estimatorMinutes = { room: 0, task: 0 };

  const rooms: RoomAnalysis[] = observations.map((obs, i) => {
    const soil = normalizeSoil(obs.soil);
    const objects = obs.objects.filter((o) => o.name?.trim()).slice(0, 25);

    const taskPlan = planRoomTasks({ roomType: obs.type, soil, objects, serviceSlug });

    // Rounded per room, then summed — so the total always equals the sum of the
    // per-room figures the customer is shown, with no stray minute to explain.
    const fromRoomModel = Math.round(roomMinutes(obs, soil, model) * multiplier);

    // No service multiplier here, on purpose. The room model needs one because
    // it has no way to express that a deep clean does *more things* — it only
    // has one number per room. The task model says so directly: a deep clean
    // fires the oven interior, the baseboards, inside the cabinets. Multiplying
    // on top would charge for that scope twice.
    const fromTaskModel = Math.round(taskPlan.totalMinutes);

    estimatorMinutes.room += fromRoomModel;
    estimatorMinutes.task += fromTaskModel;

    return {
      type: obs.type,
      label: labels[i],
      confidence: Math.max(0, Math.min(obs.confidence ?? 0.5, 1)),
      objects,
      soil,
      condition: conditionFromIndex(soilIndex(soil, obs.type, model)),
      estimatedMinutes: model.estimator === 'task' ? fromTaskModel : fromRoomModel,
      tasks: taskPlan.lines,
      notes: obs.notes,
    };
  });

  const totalMinutes = rooms.reduce((sum, r) => sum + r.estimatedMinutes, 0);

  // Overall condition weights each room by the work it represents, so one
  // spotless hallway can't offset a disastrous kitchen.
  const weightedIndex =
    totalMinutes > 0
      ? rooms.reduce((sum, r) => sum + soilIndex(r.soil, r.type, model) * r.estimatedMinutes, 0) / totalMinutes
      : 0;

  // Supplies are planned from the worst level seen anywhere: if one bathroom
  // has mold, the van needs mold remover regardless of the average.
  const worstSoil = rooms.reduce<SoilScores>((acc, r) => {
    for (const key of Object.keys(acc) as SoilDimension[]) acc[key] = Math.max(acc[key], r.soil[key]);
    return acc;
  }, { ...EMPTY_SOIL });

  const supplyPlan = planSupplies({
    soil: worstSoil,
    objects: rooms.flatMap((r) => r.objects),
    roomTypes: rooms.map((r) => r.type),
    serviceSlug,
    totalMinutes: Math.round(totalMinutes),
  });

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
    estimatorMinutes,
    estimator: model.estimator,
    recommendedPros: Math.max(1, Math.ceil(totalMinutes / model.minutesPerPro)),
    suppliesNeeded: supplyPlan.lines.map((l) => l.name),
    supplyPlan,
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
