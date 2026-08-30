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
import {
  ROOM_BASE_MINUTES,
  OBJECT_TIME_COST,
  HOUSEHOLD_SIGNALS,
  countCapFor,
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

/**
 * Raises soil floors where the objects predict work the frames didn't show.
 *
 * Applied before minutes are computed, so a signal flows through the normal
 * weighting rather than being bolted on as a surcharge — pet hair in a bedroom
 * costs what pet hair in a bedroom costs. Returns the labels it fired so the
 * pro sees why the number moved.
 */
function applyHouseholdSignals(
  soil: SoilScores,
  objects: RawRoomObservation['objects'],
): { soil: SoilScores; fired: string[] } {
  if (objects.length === 0) return { soil, fired: [] };

  const names = new Set(objects.map((o) => o.name.trim().toLowerCase()));
  const out = { ...soil };
  const fired: string[] = [];

  for (const signal of HOUSEHOLD_SIGNALS) {
    if (!signal.match.some((m) => names.has(m))) continue;
    // Only ever raises. A room already scored above the floor was observed
    // properly, and overwriting that would double-count the same evidence.
    if (out[signal.dimension] >= signal.floor) continue;
    out[signal.dimension] = signal.floor;
    fired.push(signal.label);
  }

  return { soil: out, fired };
}

function roomMinutes(
  room: RawRoomObservation,
  soil: SoilScores,
  baseOverrides: Partial<Record<RawRoomObservation['type'], number>>,
): number {
  const base = baseOverrides[room.type] ?? ROOM_BASE_MINUTES[room.type] ?? ROOM_BASE_MINUTES.other;
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
    const count = Math.max(1, Math.min(obj.count || 1, countCapFor(key)));
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
   * Per-tenant corrections fitted to that company's own completed jobs.
   *
   * Omitted, the shipped constants apply — which is what the marketplace uses.
   * Supplied, the same footage yields a different number of minutes, because a
   * crew that consistently finishes bathrooms in 16 minutes should not be
   * quoting 22. This is the entire reason the engine is worth paying for.
   */
  calibration?: {
    globalTimeFactor?: number;
    roomBaseMinutes?: Partial<Record<RawRoomObservation['type'], number>>;
    serviceMultiplier?: Record<string, number>;
  };
  /** Scales supply costs into the tenant's market. */
  supplyCostMultiplier?: number;
}

export function buildAnalysis(
  observations: RawRoomObservation[],
  { serviceSlug, source, warnings = [], calibration, supplyCostMultiplier }: EstimateOptions,
): PropertyAnalysis {
  const labels = labelRooms(observations);

  const baseOverrides = calibration?.roomBaseMinutes ?? {};
  // A calibrated factor of 0 would zero out every job, so an explicitly
  // nonsensical value falls back to the neutral 1 rather than producing a
  // free quote.
  const timeFactor =
    calibration?.globalTimeFactor && calibration.globalTimeFactor > 0 ? calibration.globalTimeFactor : 1;
  const multiplier =
    (calibration?.serviceMultiplier?.[serviceSlug] ?? SERVICE_TIME_MULTIPLIER[serviceSlug] ?? 1) * timeFactor;

  const rooms: RoomAnalysis[] = observations.map((obs, i) => {
    const observed = normalizeSoil(obs.soil);
    const { soil, fired } = applyHouseholdSignals(observed, obs.objects);
    const minutes = roomMinutes(obs, soil, baseOverrides) * multiplier;
    return {
      type: obs.type,
      label: labels[i],
      confidence: Math.max(0, Math.min(obs.confidence ?? 0.5, 1)),
      objects: obs.objects.filter((o) => o.name?.trim()).slice(0, 25),
      soil,
      condition: conditionFromIndex(soilIndex(soil, obs.type)),
      estimatedMinutes: Math.round(minutes),
      // Signals are appended to the note rather than hidden, so a pro who
      // wonders why a tidy-looking bedroom was budgeted for hair can read the
      // reason instead of distrusting the number.
      notes: [obs.notes, fired.length ? `Señales: ${fired.join(', ')}` : '']
        .filter(Boolean)
        .join(' · ') || undefined,
    };
  });

  const totalMinutes = rooms.reduce((sum, r) => sum + r.estimatedMinutes, 0);

  // Overall condition weights each room by the work it represents, so one
  // spotless hallway can't offset a disastrous kitchen.
  const weightedIndex =
    totalMinutes > 0
      ? rooms.reduce((sum, r) => sum + soilIndex(r.soil, r.type) * r.estimatedMinutes, 0) / totalMinutes
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
    costMultiplier: supplyCostMultiplier,
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
    recommendedPros: Math.max(1, Math.ceil(totalMinutes / MINUTES_PER_PRO)),
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
