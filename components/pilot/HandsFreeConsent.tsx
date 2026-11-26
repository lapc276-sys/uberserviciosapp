'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { CaptureConfig } from '@/lib/activity/recordings';
import { unlockAudio, type HandsFreeSetup } from './HandsFree';
import { unlockSensors } from './capture';

/**
 * The one screen before the camera turns on.
 *
 * Two yeses, and both are needed before a single frame is kept: the
 * cleaner's own, once per version of the wording, and the customer's, every
 * job — attested by the cleaner at the door, because the customer is the one
 * whose home is on film. The server refuses a recording without them
 * (app/api/recordings), so this screen is a convenience, not the lock.
 *
 * The tap on the button is also what lets the phone beep and read its
 * motion sensors later: browsers only allow either after a tap.
 */

interface Status {
  config: CaptureConfig;
  uploads: boolean;
  consent: { version: string; worker: string; customer: string; given: boolean };
}

export function HandsFreeConsent({ onReady, onCancel }: { onReady: (setup: HandsFreeSetup) => void; onCancel: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [customer, setCustomer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recordings', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-2xl border-2 border-red-300 p-4 dark:border-red-900/60" data-testid="hands-free-consent">
      <p className="font-semibold">Antes de grabar</p>
      {failed && (
        <p className="mt-1.5 text-sm text-amber-700 dark:text-amber-400">No pude preparar la grabación. Revisa la señal e inténtalo otra vez.</p>
      )}
      {!status && !failed && <Loader2 className="mt-2 h-5 w-5 animate-spin text-slate-400" />}
      {status && (
        <>
          {!status.consent.given && (
            <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300" data-testid="worker-consent">
              {status.consent.worker}
            </p>
          )}
          <label className="mt-3 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={customer}
              onChange={(e) => setCustomer(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>{status.consent.customer}</span>
          </label>
          {!status.uploads && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Sin almacenamiento en la nube: el video se queda en este teléfono y al final lo guardas como archivo.
            </p>
          )}
          <button
            type="button"
            disabled={!customer}
            onClick={() => {
              unlockAudio();
              unlockSensors();
              onReady({
                config: status.config,
                uploads: status.uploads,
                consent: { worker: status.consent.given ? undefined : status.consent.version, customer: true },
              });
            }}
            className="mt-3 min-h-[52px] w-full rounded-xl bg-red-600 text-base font-semibold text-white disabled:opacity-40"
          >
            {status.consent.given ? 'Activar manos libres' : 'Acepto y activo'}
          </button>
        </>
      )}
      <button type="button" onClick={onCancel} className="mt-1 min-h-[44px] w-full text-sm text-slate-500 underline dark:text-slate-400">
        Ahora no
      </button>
    </div>
  );
}
