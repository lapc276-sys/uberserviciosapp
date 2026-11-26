import { prisma, isDbConfigured } from '../db';

/**
 * The app's side of the work queue the Python pipeline consumes
 * (pipeline/klaudy_pipeline/queue.py). The app only ever enqueues; claiming,
 * retrying and finishing are the pipeline's.
 *
 * Without a database there is no pipeline to hand work to, so this does
 * nothing — the same "off, not failing" rule as every other integration.
 */

export type JobKind = 'validate_recording' | 'extract_frames' | 'summarize_sensors' | 'export_dataset';

export async function enqueueJob(kind: JobKind, payload: Record<string, unknown>, runAfter?: Date): Promise<string | null> {
  if (!isDbConfigured || !prisma) return null;
  const row = await prisma.processingJob
    .create({ data: { kind, payload: payload as object, runAfter: runAfter ?? new Date() } })
    .catch((err: unknown) => {
      // A recording must never fail to close because the queue is unhappy.
      console.error('[pipeline] could not enqueue', kind, err);
      return null;
    });
  return row?.id ?? null;
}
