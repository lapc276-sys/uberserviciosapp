import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { getCalibration } from '@/lib/data';
import { getTrainingReport } from '@/lib/vision/training';
import { formatDuration } from '@/lib/vision/estimate';
import { formatCurrency } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({ title: 'AI Vision | Homigo Admin', path: '/admin/vision', noindex: true });
export const dynamic = 'force-dynamic';

/**
 * Calibration view. The time model in lib/vision/model.ts is a hypothesis
 * until these numbers say otherwise — this page is how you find out whether
 * the AI is over- or under-estimating, and by how much.
 */
export default async function VisionAdminPage() {
  const [c, training] = await Promise.all([getCalibration(), getTrainingReport()]);

  const biasLabel =
    c.withActuals === 0
      ? '—'
      : c.meanBiasMinutes > 0
        ? `+${c.meanBiasMinutes} min over`
        : c.meanBiasMinutes < 0
          ? `${Math.abs(c.meanBiasMinutes)} min under`
          : 'on target';

  const tiles = [
    { label: 'Analyses run', value: String(c.analyses), sub: 'walkthroughs processed' },
    { label: 'With actual times', value: String(c.withActuals), sub: 'usable for calibration' },
    { label: 'Model bias', value: biasLabel, sub: 'predicted vs. actual' },
    { label: 'Mean abs. error', value: c.withActuals ? `${c.meanAbsErrorMinutes} min` : '—', sub: 'average miss' },
    { label: 'Within 20%', value: c.withActuals ? `${c.within20Pct}%` : '—', sub: 'of actual time' },
  ];

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">AI Vision</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Prediction accuracy and analysis history
        </p>
      </div>

      {c.withActuals === 0 && (
        <div className="mb-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">No ground truth yet</p>
          <p className="mt-1">
            The time model can’t be calibrated until pros record how long jobs actually take. Capture{' '}
            <span className="font-mono text-xs">actualMinutes</span> on completed bookings and accuracy metrics appear here.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold">{t.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{t.sub}</p>
          </div>
        ))}
      </div>

      {/* Field training samples — the only thing that improves the model */}
      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Field training</h2>
          <p className="text-xs text-slate-400">
            Captured at <a href="/pilot" className="text-brand-600 underline">/pilot</a> on real jobs. Each sample pairs
            the model&apos;s guess with a human correction — that pair is what makes the engine better.
          </p>
        </div>

        {training.samples === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No labeled samples yet. Capture your next job at{' '}
            <a href="/pilot" className="text-brand-600 underline">/pilot</a> to start the training set.
          </div>
        ) : (
          <div className="p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MiniTile label="Labeled samples" value={String(training.samples)} />
              <MiniTile
                label="Time bias"
                value={training.timeBias > 0 ? `+${training.timeBias} min` : `${training.timeBias} min`}
                sub={training.timeBias > 0 ? 'over-estimating' : training.timeBias < 0 ? 'under-estimating' : 'on target'}
              />
              <MiniTile label="Mean abs. error" value={`${training.timeMeanAbsError} min`} />
              <MiniTile label="Avg. correction" value={`${training.avgCorrectionMagnitude} pts`} sub="how wrong per dimension" />
            </div>

            <h3 className="mt-8 text-sm font-semibold">Where the model is weakest</h3>
            <p className="text-xs text-slate-400">
              Sorted by how far off it is. Positive bias means it over-scores that dimension — fix the worst ones first.
            </p>
            <div className="mt-4 space-y-3">
              {training.dimensions.filter((d) => d.samples > 0).map((d) => (
                <div key={d.dimension}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-600 dark:text-slate-300">{d.dimension}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      ±{d.meanAbsError}
                      <span className={`ml-2 ${d.bias > 0 ? 'text-amber-600' : d.bias < 0 ? 'text-brand-600' : 'text-slate-400'}`}>
                        ({d.bias > 0 ? '+' : ''}{d.bias} bias)
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                    <div
                      className="h-full rounded-full bg-brand-600 dark:bg-brand-500"
                      style={{ width: `${Math.min(100, d.meanAbsError * 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Recent analyses</h2>
        </div>
        {c.recent.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No analyses yet. They appear here after customers use the{' '}
            <a href="/quote/video" className="text-brand-600 underline">video quote</a>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="p-4">Service</th>
                  <th className="p-4">City</th>
                  <th className="p-4">Rooms</th>
                  <th className="p-4">Condition</th>
                  <th className="p-4">Predicted</th>
                  <th className="p-4">Actual</th>
                  <th className="p-4">Quote</th>
                  <th className="p-4">Engine</th>
                </tr>
              </thead>
              <tbody>
                {c.recent.map((r) => {
                  const delta = r.actualMinutes ? r.predictedMinutes - r.actualMinutes : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-4">{r.serviceSlug}</td>
                      <td className="p-4">{r.city ?? '—'}</td>
                      <td className="p-4">{r.roomCount}</td>
                      <td className="p-4 capitalize">{r.condition.replace('_', ' ')}</td>
                      <td className="p-4">{formatDuration(r.predictedMinutes)}</td>
                      <td className="p-4">
                        {r.actualMinutes ? (
                          <span>
                            {formatDuration(r.actualMinutes)}
                            {delta !== null && (
                              <span className={`ml-1.5 text-xs ${Math.abs(delta) <= 15 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                ({delta > 0 ? '+' : ''}{delta})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-4">{formatCurrency(r.quoteLow)}–{formatCurrency(r.quoteHigh)}</td>
                      <td className="p-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs ${
                            r.source === 'vision-llm'
                              ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-white/5'
                          }`}
                        >
                          {r.source === 'vision-llm' ? 'Vision AI' : 'Demo'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function MiniTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-slate-50/50 p-4 dark:bg-white/[0.02]">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
