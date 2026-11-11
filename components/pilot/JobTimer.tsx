'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square, Pause, Check } from 'lucide-react';
import { readJson } from '@/lib/http';
import type { Session, Segment, SessionSpan } from '@/lib/activity/store';

/**
 * The job timer, as it is actually used: one hand, often a glove, in a
 * stranger's apartment, with the phone going back in a pocket between rooms.
 *
 * Three decisions follow from that and none of them are cosmetic.
 *
 * Arriving is its own button, before any room. The gap between arriving and
 * finishing the first room is the overhead the whole time model is missing,
 * and it can only be measured if somebody marks the door separately. A screen
 * that started the clock on the first room would look tidier and would record
 * the one number this exists to find as zero, every time.
 *
 * Tapping a room closes whatever was running. Nobody walks out of a kitchen,
 * stops, closes the kitchen, then opens the bathroom — they walk into the
 * bathroom. A logger that demanded the extra tap gets abandoned by the third
 * job and the dataset stops growing.
 *
 * And "parar" exists so that carrying equipment back to the van is not billed
 * to whichever room happened to be open. Without it, overhead hides inside
 * room times and corrupts the very constants being measured.
 */

const ROOMS: { type: string; label: string; icon: string }[] = [
  { type: 'kitchen', label: 'Cocina', icon: '🍳' },
  { type: 'bathroom', label: 'Baño', icon: '🚿' },
  { type: 'bedroom', label: 'Habitación', icon: '🛏️' },
  { type: 'living_room', label: 'Sala', icon: '🛋️' },
  { type: 'dining_room', label: 'Comedor', icon: '🍽️' },
  { type: 'laundry', label: 'Lavadero', icon: '🧺' },
  { type: 'office', label: 'Oficina', icon: '💻' },
  { type: 'hallway', label: 'Pasillo', icon: '🚪' },
  { type: 'stairs', label: 'Escaleras', icon: '🪜' },
  { type: 'garage', label: 'Garaje', icon: '🚗' },
  { type: 'patio', label: 'Patio', icon: '🌿' },
  { type: 'other', label: 'Otro', icon: '📦' },
];

const LABEL_OF = new Map(ROOMS.map((r) => [r.type, r.label]));

interface State {
  session: Session | null;
  openSegment: Segment | null;
  span: SessionSpan | null;
  finished?: { session: Session; span: SessionSpan } | null;
}

function elapsedMinutes(since: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
}

function clock(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function JobTimer() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ session: Session; span: SessionSpan } | null>(null);
  // Re-renders the running clocks without touching the server.
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const send = useCallback(async (body: Record<string, unknown> | null) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/activity', {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const { data, failure } = await readJson<State>(res);
      if (failure || !data || !res.ok) {
        setError(failure ?? 'No se pudo guardar. Revisa la señal y prueba otra vez.');
        return;
      }
      if (data.finished) setDone(data.finished);
      setState(data);
    } catch {
      // The minutes are the asset, so a dropped request has to be visible —
      // silently losing a room is worse than an error nobody likes seeing.
      setError('Sin conexión. No se guardó — vuelve a tocar cuando haya señal.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send(null);
  }, [send]);

  if (!state) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand-600" />
      </div>
    );
  }

  // ── After a job, the two numbers it was all for ──────────────────────────
  if (done && !state.session) {
    const { span, session } = done;
    const share = span.overheadShare !== null ? Math.round(span.overheadShare * 100) : null;

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <Check className="h-4 w-4" /> Trabajo guardado
          </p>

          <dl className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-emerald-900/70 dark:text-emerald-200/70">Puerta a puerta</dt>
              <dd className="text-2xl font-semibold text-emerald-900 dark:text-emerald-100">
                {span.doorToDoorMinutes !== null ? minutesLabel(span.doorToDoorMinutes) : '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-emerald-900/70 dark:text-emerald-200/70">Con las manos en los cuartos</dt>
              <dd className="text-lg font-medium text-emerald-900 dark:text-emerald-100">
                {minutesLabel(span.taskMinutes)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-emerald-200 pt-3 dark:border-emerald-900/40">
              <dt className="text-sm text-emerald-900/70 dark:text-emerald-200/70">
                Lo demás <span className="text-xs">(traslado, montaje, recogida)</span>
              </dt>
              <dd className="text-lg font-medium text-emerald-900 dark:text-emerald-100">
                {span.overheadMinutes !== null ? minutesLabel(span.overheadMinutes) : '—'}
                {share !== null && <span className="ml-1.5 text-sm">· {share}%</span>}
              </dd>
            </div>
          </dl>
        </div>

        {session.segments.length > 0 && (
          <div className="rounded-2xl border p-4 dark:border-white/10">
            <p className="mb-2 text-sm font-medium">Por cuarto</p>
            <ul className="space-y-1.5">
              {session.segments.map((s) => (
                <li key={s.id} className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300">
                    {LABEL_OF.get(s.roomType) ?? s.roomType}
                    {s.task && <span className="text-slate-400"> · {s.task}</span>}
                  </span>
                  <span className="font-medium tabular-nums">
                    {typeof s.minutes === 'number' ? `${s.minutes}m` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => setDone(null)}
          className="min-h-[56px] w-full rounded-xl border-2 text-base font-semibold dark:border-white/20"
        >
          Empezar otro trabajo
        </button>
      </div>
    );
  }

  // ── Before arriving ──────────────────────────────────────────────────────
  if (!state.session) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border p-5 dark:border-white/10">
          <h2 className="font-semibold">Antes de entrar</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Toca <strong>Llegué</strong> en la puerta, antes de sacar nada del coche. Lo que pasa
            entre eso y el primer cuarto es justo lo que no sabemos medir.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => send({ action: 'start' })}
          className="inline-flex min-h-[72px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6" />}
          Llegué
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // ── On the job ───────────────────────────────────────────────────────────
  const open = state.openSegment;
  const sinceArrival = elapsedMinutes(state.session.startedAt, now);
  const taskSoFar =
    state.span!.taskMinutes + (open ? elapsedMinutes(open.startedAt, now) : 0);
  const overheadSoFar = Math.max(0, sinceArrival - taskSoFar);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border p-4 dark:border-white/10">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-500 dark:text-slate-400">Desde que llegaste</span>
          <span className="text-2xl font-semibold tabular-nums">
            {clock(state.session.startedAt, now)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Cuartos {minutesLabel(taskSoFar)}</span>
          <span>Lo demás {minutesLabel(overheadSoFar)}</span>
        </div>
      </div>

      {open ? (
        <div className="rounded-2xl border-2 border-brand-500 bg-brand-50 p-4 dark:bg-brand-950/30">
          <p className="text-sm text-brand-800 dark:text-brand-300">Ahora mismo</p>
          <div className="mt-0.5 flex items-baseline justify-between gap-3">
            <span className="text-xl font-semibold">
              {LABEL_OF.get(open.roomType) ?? open.roomType}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {clock(open.startedAt, now)}
            </span>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
          Ningún cuarto en marcha. Toca uno cuando empieces.
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">¿Qué estás limpiando?</p>
        <div className="grid grid-cols-2 gap-2">
          {ROOMS.map((room) => {
            const current = open?.roomType === room.type;
            return (
              <button
                key={room.type}
                type="button"
                disabled={busy}
                onClick={() => send({ action: 'room', roomType: room.type })}
                className={`flex min-h-[64px] items-center gap-2 rounded-xl border-2 px-3 text-left text-base font-medium transition-colors disabled:opacity-60 ${
                  current
                    ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                    : 'dark:border-white/15'
                }`}
              >
                <span aria-hidden className="text-xl">
                  {room.icon}
                </span>
                {room.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || !open}
          onClick={() => send({ action: 'pause' })}
          className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold disabled:opacity-40 dark:border-white/20"
        >
          <Pause className="h-5 w-5" /> Parar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ action: 'end' })}
          className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
        >
          <Square className="h-5 w-5" /> Me voy
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <strong>Parar</strong> es para cuando no estás en ningún cuarto — llevando cosas al coche,
        moviendo muebles. Ese tiempo cuenta igual, pero no es de un cuarto.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (confirm('¿Borrar este trabajo? No se guarda nada.')) void send({ action: 'cancel' });
        }}
        className="min-h-[44px] w-full text-sm text-slate-500 underline dark:text-slate-400"
      >
        Borrar este trabajo
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
