import { prisma, isDbConfigured } from '@/lib/db';

/**
 * Keeping enough of a walkthrough to train on later, without keeping a photo
 * album of people's homes.
 *
 * The corrections a pro makes are the valuable half of a training pair: a
 * human saying "that kitchen is grease 70, not 45" is a label nobody can buy.
 * They are also, on their own, useless for training vision — a label needs the
 * pixels it labels. Today those pixels are discarded the moment the estimate
 * comes back, which means every corrected job is a training example thrown
 * away while its consent record is filed.
 *
 * The obvious fix — store the frames — buys a real liability. A database of
 * photographs of the inside of customers' homes is a different kind of asset
 * from a table of numbers: it attracts subject-access requests, it has to be
 * deletable on demand, and a breach of it is a genuinely bad day. So the mode
 * is a deliberate setting, not a default, and there are three of them:
 *
 *   off        Nothing kept. The current behaviour, and the default.
 *   thumbnail  A 96px-edge JPEG per frame. Enough for a model to learn
 *              texture, grease sheen and clutter density from; too coarse to
 *              read a document on a counter or recognise a face across a
 *              room. Roughly 3KB per frame instead of 50KB.
 *   full       The frame as analysed. The strongest training data and the
 *              heaviest obligation. Only worth it once someone has decided to
 *              actually train something.
 *
 * The honest caveat on `thumbnail`: it is a reduction in identifiability, not
 * anonymisation. A 96px photograph of a room is still a photograph of a room,
 * and it is still personal data if it can be tied back to a household. It is
 * treated as such below — consent gated, retention bounded, purgeable.
 */

export type ArchiveMode = 'off' | 'thumbnail' | 'full';

export function archiveMode(): ArchiveMode {
  const raw = (process.env.VISION_ARCHIVE_MODE ?? 'off').trim().toLowerCase();
  return raw === 'thumbnail' || raw === 'full' ? raw : 'off';
}

/**
 * How long a stored frame lives.
 *
 * A ceiling rather than a target. "We keep it until we get round to deleting
 * it" is the policy that turns into a five-year archive nobody remembers
 * agreeing to, so the expiry is written at insert time and a scheduled purge
 * enforces it whether or not anyone is paying attention.
 */
export function retentionDays(): number {
  const n = Number(process.env.VISION_ARCHIVE_RETENTION_DAYS ?? 180);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 730) : 180;
}

/** Long edge of a stored thumbnail, in pixels. */
export const THUMBNAIL_EDGE_PX = 96;

export interface ArchiveInput {
  analysisId: string;
  /** Data URLs, in the order they were analysed. */
  frames: string[];
  /** Parallel to `frames`, so a stored image keeps knowing what it showed. */
  captions?: string[];
  /**
   * Whether the customer agreed their footage may improve the model.
   *
   * Not a formality and not defaulted: without it nothing is written, whatever
   * the mode says. The mode decides what we are willing to keep; this decides
   * whether we are allowed to.
   */
  consentTraining: boolean;
}

export interface ArchiveResult {
  stored: number;
  mode: ArchiveMode;
  /** Why nothing was stored, when nothing was. */
  skipped?: 'mode_off' | 'no_consent' | 'no_database';
}

/**
 * Stores frames for later training, if and only if we are allowed to.
 *
 * Never throws. An archive failure must not cost the customer their estimate —
 * they asked for a price, not to donate training data, and the estimate is the
 * part they are owed.
 */
export async function archiveFrames(input: ArchiveInput): Promise<ArchiveResult> {
  const mode = archiveMode();
  if (mode === 'off') return { stored: 0, mode, skipped: 'mode_off' };
  if (!input.consentTraining) return { stored: 0, mode, skipped: 'no_consent' };
  if (!isDbConfigured || !prisma) return { stored: 0, mode, skipped: 'no_database' };

  const expiresAt = new Date(Date.now() + retentionDays() * 24 * 60 * 60 * 1000);

  try {
    const rows = input.frames.map((frame, position) => ({
      analysisId: input.analysisId,
      position,
      caption: input.captions?.[position]?.slice(0, 200) ?? null,
      kind: mode,
      // Thumbnails are produced on the client, which already has a canvas and
      // the decoded frame. Re-decoding here would mean an image library in a
      // serverless runtime for a job the browser did for free.
      data: frame,
      expiresAt,
    }));

    await prisma.visionFrameArchive.createMany({ data: rows });
    return { stored: rows.length, mode };
  } catch (err) {
    console.error('[archive] failed to store frames', err);
    return { stored: 0, mode };
  }
}

/**
 * Deletes everything past its retention date.
 *
 * Called from the scheduled job. Written to be safe to run at any time and any
 * number of times — a retention policy that only works if a cron fires exactly
 * once is not a retention policy.
 */
export async function purgeExpiredFrames(): Promise<number> {
  if (!isDbConfigured || !prisma) return 0;

  const { count } = await prisma.visionFrameArchive.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  if (count > 0) console.log(`[archive] purged ${count} expired frames`);
  return count;
}

/**
 * Deletes everything held for one analysis.
 *
 * The mechanism behind "delete my data". Whatever the retention window says,
 * someone who asks has to be able to get it removed now, and that has to be
 * one call rather than a hand-written query under time pressure.
 */
export async function forgetAnalysis(analysisId: string): Promise<number> {
  if (!isDbConfigured || !prisma) return 0;
  const { count } = await prisma.visionFrameArchive.deleteMany({ where: { analysisId } });
  return count;
}

export interface ArchiveStats {
  frames: number;
  analyses: number;
  approxMegabytes: number;
  oldest: string | null;
}

/** What is actually being held, for the admin — and for answering a regulator. */
export async function archiveStats(): Promise<ArchiveStats> {
  if (!isDbConfigured || !prisma) return { frames: 0, analyses: 0, approxMegabytes: 0, oldest: null };

  const [frames, grouped, oldest] = await Promise.all([
    prisma.visionFrameArchive.count(),
    prisma.visionFrameArchive.groupBy({ by: ['analysisId'], _count: true }),
    prisma.visionFrameArchive.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);

  // Base64 of a 96px JPEG runs ~3KB; a full frame ~50KB. Estimated from the
  // mode rather than measured, because summing the column means reading every
  // row, and this is a dashboard number, not an invoice.
  const perFrameKb = archiveMode() === 'full' ? 50 : 3;

  return {
    frames,
    analyses: grouped.length,
    approxMegabytes: Math.round((frames * perFrameKb) / 1000),
    oldest: oldest?.createdAt.toISOString() ?? null,
  };
}
