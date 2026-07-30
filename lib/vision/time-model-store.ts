import { prisma, isDbConfigured } from '../db';
import { getCityByName } from '../config/cities';
import { DEFAULT_TIME_MODEL, mergeTimeModel, scaleTimeModel, type TimeModelParams } from './model';
import { buildCalibrationSet, exclusionWarning, type ScoredSample } from './outliers';

/**
 * Loading, versioning and activating the calibrated time model.
 *
 * The model has to be changeable without a deploy, but a live pricing model is
 * also the last thing that should change casually. The shape here reflects
 * that tension: creating a version is cheap and reversible, *activating* one is
 * an explicit second step, and every read falls back to the built-in defaults
 * rather than failing a quote.
 */

/** Markets without their own calibration inherit this one. */
export const DEFAULT_MARKET = 'default';

export interface TimeModelVersion {
  id: string;
  market: string;
  version: number;
  active: boolean;
  params: TimeModelParams;
  note: string | null;
  createdBy: string | null;
  basedOnSamples: number | null;
  basedOnBiasPct: number | null;
  createdAt: string;
  activatedAt: string | null;
}

/** Resolves a city display name to its market key. */
export function marketFor(city?: string | null): string {
  if (!city) return DEFAULT_MARKET;
  return getCityByName(city)?.slug ?? DEFAULT_MARKET;
}

/**
 * Short-lived cache.
 *
 * Every video quote reads the model, so hitting the database each time adds a
 * round trip to the critical path for a value that changes a few times a year.
 * The TTL is deliberately short: an operator who activates a new version wants
 * to see it take effect while they are still watching, not after a redeploy.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { params: TimeModelParams; at: number }>();

export function invalidateTimeModelCache(market?: string): void {
  if (market) cache.delete(market);
  else cache.clear();
}

/**
 * The active model for a market, falling back to the default market and then
 * to the built-in hypothesis.
 *
 * Never throws. A database blip must not take down quoting — it degrades to
 * uncalibrated pricing, which is what the product did before calibration
 * existed and is survivable, unlike a 500 on the money path.
 */
export async function getTimeModel(market = DEFAULT_MARKET): Promise<TimeModelParams> {
  const cached = cache.get(market);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.params;

  if (!isDbConfigured || !prisma) return DEFAULT_TIME_MODEL;

  try {
    const row =
      (await prisma.timeModelConfig.findFirst({ where: { market, active: true } })) ??
      (market !== DEFAULT_MARKET
        ? await prisma.timeModelConfig.findFirst({ where: { market: DEFAULT_MARKET, active: true } })
        : null);

    const params = row ? mergeTimeModel(row.params) : DEFAULT_TIME_MODEL;
    cache.set(market, { params, at: Date.now() });
    return params;
  } catch {
    return DEFAULT_TIME_MODEL;
  }
}

function toVersion(row: {
  id: string;
  market: string;
  version: number;
  active: boolean;
  params: unknown;
  note: string | null;
  createdBy: string | null;
  basedOnSamples: number | null;
  basedOnBiasPct: number | null;
  createdAt: Date;
  activatedAt: Date | null;
}): TimeModelVersion {
  return {
    id: row.id,
    market: row.market,
    version: row.version,
    active: row.active,
    params: mergeTimeModel(row.params),
    note: row.note,
    createdBy: row.createdBy,
    basedOnSamples: row.basedOnSamples,
    basedOnBiasPct: row.basedOnBiasPct,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
  };
}

export async function listTimeModelVersions(market = DEFAULT_MARKET): Promise<TimeModelVersion[]> {
  if (!isDbConfigured || !prisma) return [];
  const rows = await prisma.timeModelConfig.findMany({
    where: { market },
    orderBy: { version: 'desc' },
    take: 50,
  });
  return rows.map(toVersion);
}

export async function getActiveVersion(market = DEFAULT_MARKET): Promise<TimeModelVersion | null> {
  if (!isDbConfigured || !prisma) return null;
  const row = await prisma.timeModelConfig.findFirst({ where: { market, active: true } });
  return row ? toVersion(row) : null;
}

export interface CreateVersionInput {
  market?: string;
  params: unknown;
  note?: string;
  createdBy?: string;
  basedOnSamples?: number;
  basedOnBiasPct?: number;
  /** Activate immediately. Off by default — review then activate. */
  activate?: boolean;
}

/**
 * Stores a new version. Inactive unless explicitly activated, so writing a
 * candidate model can never change live prices as a side effect.
 */
export async function createTimeModelVersion(input: CreateVersionInput): Promise<TimeModelVersion | null> {
  if (!isDbConfigured || !prisma) return null;

  const market = input.market ?? DEFAULT_MARKET;
  // Validated on the way in as well as on the way out: a version that would
  // read back as defaults should be rejected at creation, when someone is
  // still looking at the screen.
  const params = mergeTimeModel(input.params);

  const latest = await prisma.timeModelConfig.findFirst({
    where: { market },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const row = await prisma.timeModelConfig.create({
    data: {
      market,
      version: (latest?.version ?? 0) + 1,
      params: params as unknown as object,
      note: input.note,
      createdBy: input.createdBy,
      basedOnSamples: input.basedOnSamples,
      basedOnBiasPct: input.basedOnBiasPct,
    },
  });

  if (input.activate) {
    const activated = await activateTimeModelVersion(row.id);
    return activated ?? toVersion(row);
  }

  return toVersion(row);
}

/**
 * Makes one version live, atomically.
 *
 * Deactivating the old and activating the new in a single transaction is what
 * keeps "exactly one active version per market" true. Split across two writes,
 * a failure between them leaves a market with either two active models or
 * none — and "none" silently reverts pricing to the uncalibrated defaults
 * without anyone noticing.
 */
export async function activateTimeModelVersion(id: string): Promise<TimeModelVersion | null> {
  if (!isDbConfigured || !prisma) return null;

  const target = await prisma.timeModelConfig.findUnique({ where: { id } });
  if (!target) return null;

  const [, activated] = await prisma.$transaction([
    prisma.timeModelConfig.updateMany({
      where: { market: target.market, active: true },
      data: { active: false },
    }),
    prisma.timeModelConfig.update({
      where: { id },
      data: { active: true, activatedAt: new Date() },
    }),
  ]);

  invalidateTimeModelCache(target.market);
  return toVersion(activated);
}

export interface CalibrationSuggestion {
  /** Multiplier to apply to the current model. */
  factor: number;
  /** Samples that survived outlier screening — the ones the factor is built on. */
  samples: number;
  /** Samples rejected before the arithmetic ran. */
  excluded: number;
  /** Set when the rejected pile is large enough to distrust the capture flow. */
  dataWarning: string | null;
  biasPct: number;
  /** Whether there is enough evidence to act on this. */
  confident: boolean;
  rationale: string;
  params: TimeModelParams;
}

/**
 * Minimum completed jobs before a suggestion is worth acting on.
 *
 * Below this, the "bias" is mostly the variance of a handful of jobs — one
 * chatty customer and one interrupted shift can move it ten points. Acting on
 * that isn't calibration, it's overfitting to noise, and it burns the operator's
 * trust in the number the first time it swings back.
 */
export const MIN_SAMPLES_FOR_CONFIDENCE = 30;

/**
 * Proposes a uniform correction from observed predicted-vs-actual error.
 *
 * Deliberately a single global factor rather than a per-weight refit: with a
 * few dozen jobs there is enough signal to say "we are systematically fast",
 * and nowhere near enough to say "grease in kitchens specifically is
 * underweighted by 4 minutes". The honest model is the simple one.
 */
export function suggestCalibration(
  current: TimeModelParams,
  rawSamples: ScoredSample[],
): CalibrationSuggestion {
  // Screened before anything is summed. An unscreened set produces a
  // suggestion worded exactly as confidently as a real one.
  const set = buildCalibrationSet(rawSamples);
  const samples = set.used.length;
  const dataWarning = exclusionWarning(set);

  if (samples === 0 || set.predictedTotal <= 0) {
    return {
      factor: 1,
      samples,
      excluded: set.excluded.length,
      dataWarning,
      biasPct: 0,
      confident: false,
      rationale:
        set.excluded.length > 0
          ? 'Every recorded time so far was rejected as implausible. Nothing usable to calibrate from.'
          : 'No completed jobs with recorded actual minutes yet.',
      params: current,
    };
  }

  const factor = set.factor;
  const biasPct = Number(((factor - 1) * 100).toFixed(1));
  const confident = samples >= MIN_SAMPLES_FOR_CONFIDENCE && Math.abs(biasPct) >= 5;

  const rationale = confident
    ? `Across ${samples} jobs the model runs ${biasPct > 0 ? 'short' : 'long'} by ${Math.abs(biasPct)}%. Scaling every duration by ${factor.toFixed(3)} centers it.`
    : samples < MIN_SAMPLES_FOR_CONFIDENCE
      ? `Only ${samples} of the ${MIN_SAMPLES_FOR_CONFIDENCE} jobs needed. The ${biasPct}% gap is still mostly noise.`
      : `Bias is ${biasPct}% across ${samples} jobs — inside the range where a correction would chase noise.`;

  return {
    factor: Number(factor.toFixed(3)),
    samples,
    excluded: set.excluded.length,
    dataWarning,
    biasPct,
    confident,
    rationale,
    params: scaleTimeModel(current, factor),
  };
}
