import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { listSessions, roomTimings } from '@/lib/activity/store';
import { ROOM_BASE_MINUTES } from '@/lib/vision/model';
import { ROOM_LABELS, type RoomType } from '@/lib/vision/types';

export const metadata: Metadata = buildMetadata({
  title: 'Timings | Homigo Admin',
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

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Timings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Real minutes per room, logged from the field · {finished.length}{' '}
          {finished.length === 1 ? 'job' : 'jobs'} recorded
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-white/[0.03]">
          <p>Nothing logged yet.</p>
          <p className="mt-2">
            Set up the Telegram bot (see <span className="font-mono">SETUP.md</span>), then say a room name
            on your next job. Every room you name becomes a labelled sample here.
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
