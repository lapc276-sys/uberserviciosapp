'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, TriangleAlert, History } from 'lucide-react';
import type { CalibrationSuggestion, TimeModelVersion } from '@/lib/vision/time-model-store';

/**
 * Applying a calibration.
 *
 * The interaction is deliberately two steps — save a version, then activate
 * it — because this is the one control in the admin that changes what every
 * future customer is charged. A single button that silently repriced the
 * business would be faster and worse.
 */
export function TimeModelPanel({
  active,
  versions,
  suggestion,
  dbConfigured,
  market,
  markets,
}: {
  active: TimeModelVersion | null;
  versions: TimeModelVersion[];
  suggestion: CalibrationSuggestion;
  dbConfigured: boolean;
  market: string;
  markets: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const isDefaultMarket = market === 'default';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/time-model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          market,
          params: suggestion.params,
          note: `Calibration ×${suggestion.factor} from ${suggestion.samples} jobs (${suggestion.biasPct > 0 ? '+' : ''}${suggestion.biasPct}% bias)`,
          basedOnSamples: suggestion.samples,
          basedOnBiasPct: suggestion.biasPct,
          activate: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save the calibration.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/time-model', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not activate that version.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
        <div>
          <h2 className="font-semibold">Time model</h2>
          <p className="text-xs text-slate-400">
            The minutes behind every video quote. Calibrating here changes pricing immediately — no deploy.
          </p>
        </div>
        <select
          value={market}
          onChange={(e) => router.push(`/admin/vision?market=${encodeURIComponent(e.target.value)}`)}
          className="rounded-xl border bg-white px-3 py-1.5 text-sm dark:bg-white/[0.06]"
          aria-label="Market"
        >
          {markets.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="p-5">
        {/*
          The trap this warning exists for: samples captured somewhere with no
          market of its own land in `default`, and `default` is what every
          uncalibrated market inherits. Calibrating it from that data reprices
          cities the footage never came from.
        */}
        {isDefaultMarket && (
          <div className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="font-medium">This is the fallback for every market</p>
            <p className="mt-1">
              Any city without its own calibration inherits it. If these samples came from one place, calibrate that
              market instead — otherwise footage from one city sets prices in all of them.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Active:</span>
          {active ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5" /> v{active.version} · {active.market}
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/10 dark:text-slate-300">
              Built-in defaults (uncalibrated)
            </span>
          )}
          {active?.note && <span className="text-xs text-slate-400">{active.note}</span>}
        </div>

        <div className="mt-5 rounded-xl border border-dashed p-4">
          <p className="text-sm font-medium">Suggested calibration</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{suggestion.rationale}</p>

          {/* Rejected samples are shown, never quietly dropped — a growing pile
              of them usually means the capture flow is confusing somebody. */}
          {suggestion.dataWarning && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{suggestion.dataWarning}</p>
          )}

          {suggestion.confident ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={apply}
                disabled={busy || !dbConfigured}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Applying…' : `Apply ×${suggestion.factor} and activate`}
              </button>
              <span className="text-xs text-slate-400">
                Saves a new version and makes it live. The current version stays and can be re-activated.
              </span>
            </div>
          ) : (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="h-3.5 w-3.5" /> Not enough evidence to change pricing yet.
            </p>
          )}

          {!dbConfigured && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
              Set <span className="font-mono">DATABASE_URL</span> to store model versions.
            </p>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {versions.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <History className="h-3.5 w-3.5" /> Version history
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-400">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Version</th>
                    <th className="py-2 pr-4 font-medium">Note</th>
                    <th className="py-2 pr-4 font-medium">Based on</th>
                    <th className="py-2 pr-4 font-medium">Created</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="py-2 pr-4 font-medium">v{v.version}</td>
                      <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{v.note ?? '—'}</td>
                      <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">
                        {v.basedOnSamples ? `${v.basedOnSamples} jobs` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">{new Date(v.createdAt).toLocaleDateString()}</td>
                      <td className="py-2 text-right">
                        {v.active ? (
                          <span className="text-xs font-medium text-emerald-600">active</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => activate(v.id)}
                            disabled={busy}
                            className="text-xs font-medium text-brand-600 underline disabled:opacity-50"
                          >
                            activate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
