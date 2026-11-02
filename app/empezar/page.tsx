import type { Metadata } from 'next';
import { SignupForm } from '@/components/tenants/SignupForm';
import { engine } from '@/lib/config/engine';
import { isDbConfigured } from '@/lib/db';

/**
 * Where a cleaning company signs itself up.
 *
 * Carries none of the cleaning business's branding, by design — see
 * lib/config/engine.ts. The person reading this may be a competitor of it,
 * and is being sold software, not a cleaning service.
 */

export const metadata: Metadata = {
  title: `Presupuestos al instante para tu empresa de limpieza | ${engine.name}`,
  description:
    'Tu cliente graba su casa con el teléfono y ve tu precio al momento, con tu nombre y tus tarifas. Sin visitas y sin esperar.',
};

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-lg px-5 py-10">
        <p className="text-sm font-medium text-brand-700 dark:text-brand-300">{engine.name}</p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">
          Deja de perder dos horas para cotizar un trabajo de $200
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Tu cliente abre tu link, graba su casa con el teléfono y ve{' '}
          <strong>tu precio</strong> al momento. Tú recibes sus datos por correo. Sin ir a
          verlo, sin presupuestos por la noche.
        </p>

        <ul className="mt-6 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>· Sale con tu nombre, no con el nuestro.</li>
          <li>· Tus tarifas, tus precios.</li>
          <li>· Tu cliente no se descarga nada.</li>
        </ul>

        {/* Without a database a slug cannot be held, so the form would hand
            out links that another signup can silently take over. Saying so
            beats letting someone fill in six fields to reach a 503. */}
        {isDbConfigured ? (
          <div className="mt-8 rounded-2xl border p-5 dark:border-white/10">
            <SignupForm origin={engine.url} />
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/30">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              El registro automático está cerrado por ahora
            </p>
            <p className="mt-1.5 text-sm text-amber-900/80 dark:text-amber-200/80">
              Escríbenos y te abrimos la cuenta a mano el mismo día.
            </p>
          </div>
        )}

        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
          Las fotos del recorrido se usan solo para calcular el presupuesto.
        </p>
      </div>
    </main>
  );
}
