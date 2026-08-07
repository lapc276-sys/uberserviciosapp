import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { deliveryOverview } from '@/lib/delivery/orders';
import { TARGET_DOLLARS_PER_MINUTE } from '@/lib/delivery/complexity';

export const metadata: Metadata = buildMetadata({ title: 'Delivery engine | Homigo Admin', path: '/admin/delivery', noindex: true });
export const dynamic = 'force-dynamic';

/**
 * The delivery engine, exposed.
 *
 * Three questions, in the order they matter: is the fleet's time being wasted
 * (idle gap), is the model telling the truth (calibration), and what has the
 * operation learned that nobody could have bought (buildings and merchants)?
 */
export default async function DeliveryAdminPage() {
  const { orders, buildings, merchants, idleGap, calibration } = await deliveryOverview();

  const learnedBuildings = buildings.filter((b) => b.samples > 0).length;

  const tiles = [
    { label: 'Live orders', value: String(orders.length), sub: 'in the last 50' },
    {
      label: 'Idle gap (median)',
      value: idleGap.jobs ? `${idleGap.p50Minutes} min` : '—',
      sub: idleGap.jobs ? `p90 ${idleGap.p90Minutes} min · ${idleGap.idleSharePct}% of engaged time` : 'no completed jobs yet',
    },
    {
      label: 'Minutes lost between jobs',
      value: idleGap.jobs ? String(idleGap.lostMinutes) : '—',
      sub: 'the number the engine exists to shrink',
    },
    {
      label: 'Model bias',
      value: calibration.jobs
        ? calibration.biasMinutes > 0
          ? `+${calibration.biasMinutes} min over`
          : calibration.biasMinutes < 0
            ? `${Math.abs(calibration.biasMinutes)} min under`
            : 'on target'
        : '—',
      sub: calibration.jobs ? `${calibration.within20Pct}% within 20%` : 'no ground truth yet',
    },
    {
      label: 'Buildings learned',
      value: `${learnedBuildings}/${buildings.length}`,
      sub: 'with at least one measured access time',
    },
  ];

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Delivery engine</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Time decomposition, building access, batching and idle gap — the whole job, not the distance
        </p>
      </div>

      {calibration.jobs === 0 && (
        <div className="mb-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">The model is still a hypothesis</p>
          <p className="mt-1">
            Every constant in <span className="font-mono text-xs">lib/delivery/</span> — stair time, elevator wait, parking,
            prep — is an estimate until deliveries report back through{' '}
            <span className="font-mono text-xs">POST /api/delivery/orders/[ref]/events</span>. Treat ETAs and complexity
            scores as provisional until this page shows real accuracy.
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

      {/* ── Buildings: the asset that can't be bought ─────────────────────── */}
      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Buildings</h2>
          <p className="text-xs text-slate-400">
            Access score is the expected door-to-door cost averaged over every floor, 0–100, higher is easier. A maps API
            can tell you the distance to any of these addresses; only deliveries tell you what happens after the front door.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">Building</th>
                <th className="px-5 py-3 font-medium">Floors</th>
                <th className="px-5 py-3 font-medium">Elevator</th>
                <th className="px-5 py-3 font-medium">Access score</th>
                <th className="px-5 py-3 font-medium">Measured</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium">{b.label}</div>
                    {b.inference && (
                      <div className="text-xs text-brand-600">
                        engine infers elevator: {b.inference.elevator} — {b.inference.reason}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{b.floors ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        b.elevator === 'yes'
                          ? 'text-emerald-600'
                          : b.elevator === 'no'
                            ? 'text-rose-600'
                            : 'text-slate-400'
                      }
                    >
                      {b.elevator}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div
                          className={`h-full rounded-full ${b.accessScore >= 70 ? 'bg-emerald-500' : b.accessScore >= 45 ? 'bg-amber-500' : 'bg-rose-500'}`}
                          style={{ width: `${b.accessScore}%` }}
                        />
                      </div>
                      <span className="tabular-nums">{b.accessScore}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {b.samples === 0 ? (
                      <span className="text-slate-400">no data — using the prior</span>
                    ) : (
                      <>
                        p50 {b.p50Minutes} min · p90 {b.p90Minutes} min
                        <span className="ml-2 text-xs text-slate-400">({b.samples} drops)</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Merchants ─────────────────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Merchants</h2>
          <p className="text-xs text-slate-400">
            What they promise vs. what they do. Reliability gates batching — a merchant that can&apos;t hold a schedule
            makes every double order late.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">Merchant</th>
                <th className="px-5 py-3 font-medium">Quoted prep</th>
                <th className="px-5 py-3 font-medium">Measured prep</th>
                <th className="px-5 py-3 font-medium">Reliability</th>
                <th className="px-5 py-3 font-medium">Slowest hour</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">{m.name}</td>
                  <td className="px-5 py-3 text-slate-500">{m.quotedPrepMinutes} min</td>
                  <td className="px-5 py-3 text-slate-500">
                    {m.measuredPrepMinutes != null ? (
                      <>
                        {m.measuredPrepMinutes} min
                        <span className="ml-2 text-xs text-slate-400">({m.prepSamples} orders)</span>
                      </>
                    ) : (
                      <span className="text-slate-400">unmeasured</span>
                    )}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{m.reliability}/100</td>
                  <td className="px-5 py-3 text-slate-500">
                    {m.busiestHour ? `${m.busiestHour.hour}:00 — ${m.busiestHour.minutes} min` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Component calibration ─────────────────────────────────────────── */}
      {calibration.components.length > 0 && (
        <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
          <div className="border-b p-5">
            <h2 className="font-semibold">Where the model is wrong</h2>
            <p className="text-xs text-slate-400">
              Per component, because &ldquo;we&apos;re six minutes over&rdquo; is not actionable and &ldquo;five of those
              six are prep wait at one merchant&rdquo; is.
            </p>
          </div>
          <div className="divide-y">
            {calibration.components.map((c) => (
              <div key={c.component} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <span className="font-medium">{c.label}</span>
                  <span className="ml-2 text-xs text-slate-400">{c.samples} samples</span>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <span className="text-slate-500">
                    predicted {c.predictedMean} → actual {c.actualMean} min
                  </span>
                  <span className={Math.abs(c.biasMinutes) >= 1 ? 'font-medium text-amber-600' : 'text-slate-400'}>
                    {c.biasMinutes > 0 ? `+${c.biasMinutes}` : c.biasMinutes} min
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Orders ────────────────────────────────────────────────────────── */}
      <div className="mt-8 rounded-2xl border bg-white shadow-soft dark:bg-white/[0.03]">
        <div className="border-b p-5">
          <h2 className="font-semibold">Orders</h2>
          <p className="text-xs text-slate-400">
            Priced by weight after pickup. The card is saved at intake and charged after the weigh-in — anything that
            outruns the estimate goes back to the customer for approval instead of being charged.
          </p>
        </div>
        {orders.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No delivery orders yet. Point a Twilio messaging webhook at{' '}
            <span className="font-mono text-xs">/api/delivery/sms</span> and text it a pickup request.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Ref</th>
                  <th className="px-5 py-3 font-medium">Address</th>
                  <th className="px-5 py-3 font-medium">Floor</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Payment</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.ref} className="border-b last:border-0">
                    <td className="px-5 py-3 font-mono text-xs">{o.ref}</td>
                    <td className="px-5 py-3">{o.addressLine}</td>
                    <td className="px-5 py-3 text-slate-500">{o.floor ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{o.status}</td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          o.paymentState === 'PAID'
                            ? 'text-emerald-600'
                            : o.paymentState === 'FAILED'
                              ? 'text-rose-600'
                              : 'text-slate-500'
                        }
                      >
                        {o.paymentState.toLowerCase().replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      {o.finalTotal != null
                        ? `$${o.finalTotal.toFixed(2)}`
                        : o.estimateLow != null
                          ? `~$${o.estimateLow.toFixed(2)}–$${o.estimateHigh?.toFixed(2)}`
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Courier pay is derived from modeled minutes at a target of ${TARGET_DOLLARS_PER_MINUTE.toFixed(2)}/min of engaged
        time. Check this against local minimum-pay rules before launching a market — several cities regulate it.
      </p>
    </section>
  );
}
