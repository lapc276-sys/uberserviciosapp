import { AlertTriangle, Droplets, ListChecks, Sparkles } from 'lucide-react';
import type { CrewPlan } from '@/lib/vision/plan';

/**
 * The work plan, as the person about to do the job reads it.
 *
 * On a phone, standing in a doorway, with gloves going on. So: one step per
 * block, the room and the clock first, the actions as short lines, and the
 * things that ruin a surface in amber where they cannot be skimmed past.
 */

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `0:${String(m).padStart(2, '0')}`;
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function CrewPlanView({ plan }: { plan: CrewPlan }) {
  if (plan.steps.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-brand-600" /> Plan del trabajo
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {duration(plan.handsOnMinutes)} con las manos
          {plan.overlappedMinutes > 0 &&
            ` · los productos trabajan ${duration(plan.overlappedMinutes)} mientras haces otra cosa`}
        </p>
        {plan.idleMinutes > 0 && (
          // Said plainly rather than absorbed: a wait the crew knows about is
          // one they can fill, or avoid by spraying before unloading the van.
          <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Vas a esperar unos {plan.idleMinutes} min a que actúe un producto. Si puedes, rocía antes de
            descargar todo.
          </p>
        )}
      </div>

      <ol className="space-y-2">
        {plan.steps.map((step, i) => (
          <li
            key={`${step.kind}-${step.room}-${i}`}
            className={`rounded-xl border p-3 dark:border-white/10 ${
              step.kind === 'pretreat' ? 'border-sky-200 bg-sky-50/60 dark:bg-sky-950/20' : ''
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {step.kind === 'pretreat' ? (
                  <Droplets className="h-4 w-4 text-sky-600" />
                ) : (
                  <Sparkles className="h-4 w-4 text-brand-600" />
                )}
                {step.kind === 'pretreat' ? 'Rocía' : 'Limpia'} · {step.room}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {clock(step.startsAt)} · {duration(step.minutes)}
              </span>
            </div>

            <ul className="mt-1.5 space-y-1">
              {step.actions.map((action) => (
                <li key={action} className="text-sm leading-snug text-slate-700 dark:text-slate-300">
                  {action}
                </li>
              ))}
            </ul>

            {step.cautions.map((caution) => (
              <p
                key={caution}
                className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{caution}</span>
              </p>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
