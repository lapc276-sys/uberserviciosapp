import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { getCalibration } from '@/lib/data';
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
  const c = await getCalibration();

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
