import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { listSessions, overheadSummary, roomTimings } from '@/lib/activity/store';
import { ROOM_BASE_MINUTES } from '@/lib/vision/model';
import { ROOM_LABELS, type RoomType } from '@/lib/vision/types';

export const metadata: Metadata = buildMetadata({
  title: 'Timings | Klaudy Admin',
  path: '/admin/timings',
  noindex: true,
});
export const dynamic = 'force-dynamic';

/**
 * Measured minutes per room against the constants the estimator is using.
 *
 * ROOM_BASE_MINUTES in lib/vision/model.ts is a set of guesses I wrote. This
 * page is where they stop being guesses — or where it becomes obvious they
 * were badly wrong, which is just as useful and a lot cheaper to learn here
 * than from a customer disputing an invoice.
 */
export default async function TimingsPage() {
  const sessions = await listSessions(200);
  const timings = roomTimings(sessions);
  const finished = sessions.filter((s) => s.endedAt);
  const overhead = overheadSummary(sessions);

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Timings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Real minutes per room, logged from the field · {finished.length}{' '}
          {finished.length === 1 ? 'job' : 'jobs'} recorded
        </p>
      </div>

      {/* The headline number, above the per-room table on purpose.
          ROOM_BASE_MINUTES being wrong is a calibration problem; overhead
          being unmeasured is the reason those constants cannot be corrected
          at all, because a per-task stopwatch never sees it. */}
      <div className="mb-6 rounded-2xl border bg-white p-5 dark:bg-white/[0.03]">
        <h2 className="text-sm font-medium">Door-to-door vs hands-on</h2>
        {overhead.samples === 0 ? (
          <p className="mt-1.5 text-sm text-slate-400">
            No job has both an arrival and a departure yet. Use{' '}
            <span className="font-mono">/pilot/tiempo</span> and tap &ldquo;Llegué&rdquo; at the door —
            that tap is the measurement.
          </p>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold tracking-tight">
              {Math.round((overhead.medianShare ?? 0) * 100)}%
              <span className="ml-2 text-sm font-normal text-slate-500">
                of the day is not hands-on a room
              </span>
            </p>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              {overhead.doorToDoorMinutes} min door-to-door against {overhead.taskMinutes} min in
              rooms, across {overhead.samples} {overhead.samples === 1 ? 'job' : 'jobs'}. Travel,
              setup, moving furniture, packing up — all billed.
            </p>
            {overhead.samples < 5 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Too few jobs to act on. Do not touch the time constants yet.
              </p>
            )}
          </>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
          <p>Nothing logged yet.</p>
          <p className="mt-2">
            Open <span className="font-mono">/pilot/tiempo</span> on your phone and tap
            &ldquo;Llegué&rdquo; at the door, then a room as you start it. Every room becomes a
            labelled sample here. The Telegram bot writes to the same place (see{' '}
            <span className="font-mono">SETUP.md</span>).
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-white dark:bg-white/[0.03]">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Room</th>
                  <th className="px-4 py-3 font-medium">Measured (median)</th>
                  <th className="px-4 py-3 font-medium">Model assumes</th>
                  <th className="px-4 py-3 font-medium">Gap</th>
                  <th className="px-4 py-3 font-medium">Range</th>
                  <th className="px-4 py-3 font-medium">Samples</th>
                </tr>
              </thead>
              <tbody>
                {timings.map((t) => {
                  const assumed = ROOM_BASE_MINUTES[t.roomType as RoomType];
                  const gap = assumed ? t.medianMinutes - assumed : null;
                  // Under ~8 samples the median still swings on one odd job.
                  const trusted = t.samples >= 8;
                  return (
                    <tr key={t.roomType} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {ROOM_LABELS[t.roomType as RoomType] ?? t.roomType}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{t.medianMinutes} min</td>
                      <td className="px-4 py-3 tabular-nums text-slate-500">
                        {assumed ? `${assumed} min` : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 tabular-nums ${
                          gap === null ? 'text-slate-400' : Math.abs(gap) > 8 ? 'font-medium text-amber-600' : 'text-slate-500'
                        }`}
                      >
                        {gap === null ? '—' : gap > 0 ? `+${gap} min` : `${gap} min`}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-400">
                        {t.minMinutes}–{t.maxMinutes}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {t.samples}
                        {!trusted && <span className="ml-1.5 text-xs text-slate-400">too few</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            &ldquo;Gap&rdquo; is measured minus assumed. A positive number means the estimator is quoting that
            room short, which is the expensive direction: the job runs long and the margin pays for it.
          </p>

          <h2 className="mt-8 text-sm font-semibold">Recent jobs</h2>
          <div className="mt-3 space-y-3">
            {sessions.slice(0, 12).map((s) => (
              <div key={s.id} className="rounded-2xl border bg-white p-4 dark:bg-white/[0.03]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{s.label ?? 'Untitled job'}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(s.startedAt).toLocaleString()}
                    {!s.endedAt && ' · still open'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.segments.map((seg) => (
                    <span
                      key={seg.id}
                      className="rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-white/10"
                      title={seg.task}
                    >
                      {ROOM_LABELS[seg.roomType as RoomType] ?? seg.roomType}{' '}
                      <span className="tabular-nums text-slate-500">
                        {typeof seg.minutes === 'number' ? `${seg.minutes}m` : 'running'}
                      </span>
                    </span>
                  ))}
                  {s.segments.length === 0 && <span className="text-xs text-slate-400">no rooms logged</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
