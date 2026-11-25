'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square, Pause, Check, Undo2 } from 'lucide-react';
import { readJson } from '@/lib/http';
import type { Session, Segment, SessionSpan } from '@/lib/activity/store';
import type { JobRoom } from '@/lib/workers/job';
import type { DurationEstimate } from '@/lib/workers/pace';
import type { JobVoiceAction } from '@/lib/workers/voice';
import { HandsFree, unlockAudio, type HandsFreeHandle, type RecordingSummary } from './HandsFree';
import { downloadRecording, forgetRecording } from './recordingStore';

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
 *
 * Opened from a job (?analysis=…), the buttons are that job's rooms — "Baño
 * 1", "Baño 2" — and its paid extras, so every minute lands against the
 * prediction for that very room. The per-room predictions are deliberately
 * not shown while working: a target on screen is a target people work to,
 * and the point is to measure how long the room takes, not how long the app
 * said it would.
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
const ICON_OF = new Map(ROOMS.map((r) => [r.type, r.icon]));

interface JobView {
  analysisId: string;
  serviceSlug: string;
  region: string | null;
  rooms: JobRoom[];
}

interface State {
  session: Session | null;
  openSegment: Segment | null;
  span: SessionSpan | null;
  job?: JobView | null;
  estimate?: DurationEstimate | null;
  /** The job a link pointed at, when a different one is still open. */
  otherJob?: JobView | null;
  finished?: { session: Session; span: SessionSpan } | null;
}

const FEELINGS: { value: 'good' | 'normal' | 'tired'; label: string }[] = [
  { value: 'good', label: 'Bien' },
  { value: 'normal', label: 'Normal' },
  { value: 'tired', label: 'Cansado' },
];

const CONFIDENCE_LABEL: Record<DurationEstimate['confidence'], string> = {
  provisional: 'estimación inicial, todavía no aprendida',
  low: 'pocos datos todavía',
  medium: 'historial en crecimiento',
  high: 'fiable',
};

const BASIS_LABEL: Record<DurationEstimate['basis'], string> = {
  reference: 'del motor',
  global: 'de la media de la región',
  company: 'del equipo',
  worker: 'para ti',
};

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

/** What a segment was, in the words of this job when there is one. */
function segmentLabel(seg: Segment, job: JobView | null | undefined): string {
  const room = seg.roomKey ? job?.rooms.find((r) => r.key === seg.roomKey) : undefined;
  return room?.label ?? LABEL_OF.get(seg.roomType) ?? seg.roomType;
}

export function JobTimer({ analysisId }: { analysisId?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ session: Session; span: SessionSpan } | null>(null);
  const [feeling, setFeeling] = useState<string | null>(null);
  // "Me voy" asks one question before it closes the job.
  const [leaving, setLeaving] = useState(false);
  const [redoRooms, setRedoRooms] = useState<string[] | null>(null);
  const [otherRooms, setOtherRooms] = useState(false);
  // Hands-free: the phone on the head or chest films, the voice marks.
  const [handsFree, setHandsFree] = useState(false);
  const [recording, setRecording] = useState<RecordingSummary | null>(null);
  const [savedNote, setSavedNote] = useState('');
  const hfRef = useRef<HandsFreeHandle>(null);
  // The job's names, kept for the summary after the job closes.
  const lastJob = useRef<JobView | null>(null);
  // Re-renders the running clocks without touching the server.
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const send = useCallback(
    async (body: Record<string, unknown> | null) => {
      setBusy(true);
      setError('');
      try {
        const url = body || !analysisId ? '/api/activity' : `/api/activity?analysis=${encodeURIComponent(analysisId)}`;
        const res = await fetch(url, {
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
        if (data.job) lastJob.current = data.job;
        // POST replies do not carry the estimate; keep the one already shown.
        setState((prev) => ({ ...data, estimate: data.estimate ?? (data.session ? prev?.estimate : null) }));
      } catch {
        // The minutes are the asset, so a dropped request has to be visible —
        // silently losing a room is worse than an error nobody likes seeing.
        setError('Sin conexión. No se guardó — vuelve a tocar cuando haya señal.');
      } finally {
        setBusy(false);
      }
    },
    [analysisId],
  );

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
                <li key={s.id} className={`flex justify-between text-sm ${s.excluded ? 'line-through opacity-50' : ''}`}>
                  <span className="text-slate-600 dark:text-slate-300">
                    {segmentLabel(s, lastJob.current)}
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

        {recording && (
          <div className="rounded-2xl border p-4 text-sm dark:border-white/10" data-testid="recording-summary">
            <p className="font-medium">Video del trabajo</p>
            {recording.onPhone === 0 ? (
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                {recording.uploads
                  ? `${recording.uploaded} ${recording.uploaded === 1 ? 'parte guardada' : 'partes guardadas'} en la nube.`
                  : 'Guardado en el teléfono, y espacio liberado.'}
              </p>
            ) : (
              <>
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  {recording.uploads
                    ? `${recording.onPhone} ${recording.onPhone === 1 ? 'parte sigue' : 'partes siguen'} en este teléfono: se subirán cuando lo guardes o haya señal.`
                    : `El video está en este teléfono (${recording.onPhone} ${recording.onPhone === 1 ? 'parte' : 'partes'}).`}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const n = await downloadRecording(recording.recordingId, `trabajo-${new Date().toISOString().slice(0, 10)}`);
                    setSavedNote(n ? 'Guardado. Cuando lo tengas a salvo, libera el espacio.' : 'No quedaba video en el teléfono.');
                  }}
                  className="mt-3 min-h-[48px] w-full rounded-xl border-2 font-semibold dark:border-white/20"
                >
                  Guardar el video en el teléfono
                </button>
                {savedNote && (
                  <>
                    <p className="mt-2 text-xs text-slate-500">{savedNote}</p>
                    <button
                      type="button"
                      onClick={async () => {
                        await forgetRecording(recording.recordingId);
                        setRecording({ ...recording, onPhone: 0 });
                        setSavedNote('');
                      }}
                      className="mt-1 min-h-[40px] text-xs text-slate-500 underline"
                    >
                      Liberar espacio
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setDone(null);
            setRecording(null);
            setSavedNote('');
            void send(null);
          }}
          className="min-h-[56px] w-full rounded-xl border-2 text-base font-semibold dark:border-white/20"
        >
          Empezar otro trabajo
        </button>
      </div>
    );
  }

  // ── Before arriving ──────────────────────────────────────────────────────
  if (!state.session) {
    const job = state.job;
    const estimate = state.estimate;
    return (
      <div className="space-y-5">
        {job && (
          <div className="rounded-2xl border p-5 dark:border-white/10">
            <h2 className="font-semibold">Este trabajo</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {job.rooms.map((r) => (
                <li key={r.key} className="rounded-full bg-slate-100 px-2.5 py-1 text-sm dark:bg-white/10">
                  {ICON_OF.get(r.type)} {r.label}
                  {r.extras.length > 0 && <span className="text-slate-500"> +{r.extras.length}</span>}
                </li>
              ))}
            </ul>
            {estimate && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" data-testid="estimate">
                Unas <strong>{minutesLabel(estimate.minutes)}</strong> {BASIS_LABEL[estimate.basis]}
                <span className="text-slate-400"> · {CONFIDENCE_LABEL[estimate.confidence]}</span>
              </p>
            )}
          </div>
        )}

        <div className="rounded-2xl border p-5 dark:border-white/10">
          <h2 className="font-semibold">Antes de entrar</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Toca <strong>Llegué</strong> en la puerta, antes de sacar nada del coche. Lo que pasa
            entre eso y el primer cuarto es justo lo que no sabemos medir.
          </p>
          {/* One optional question, never required: a screen that insists
              gets answered "bien" every time and the answer means nothing. */}
          <p className="mt-4 text-sm font-medium">¿Cómo llegas hoy? <span className="font-normal text-slate-400">(si quieres)</span></p>
          <div className="mt-2 flex gap-2">
            {FEELINGS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={feeling === f.value}
                onClick={() => setFeeling(feeling === f.value ? null : f.value)}
                className={`min-h-[44px] flex-1 rounded-xl border-2 text-sm font-medium ${
                  feeling === f.value ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200' : 'dark:border-white/15'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {job && (
          <button
            type="button"
            aria-pressed={handsFree}
            onClick={() => setHandsFree(!handsFree)}
            className={`w-full rounded-2xl border-2 p-4 text-left ${
              handsFree ? 'border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'dark:border-white/15'
            }`}
          >
            <span className="flex items-center justify-between gap-3 font-semibold">
              Manos libres
              <span className={`text-sm ${handsFree ? 'text-red-600' : 'text-slate-400'}`}>{handsFree ? 'Activado' : 'Apagado'}</span>
            </span>
            <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
              El teléfono en la cabeza o el pecho graba el trabajo, y tú marcas cada cosa diciendo su nombre:
              “horno”, “baño dos”, “termino”.
            </span>
          </button>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            // The tap is what lets the phone beep later, with no hand free.
            if (handsFree) unlockAudio();
            void send({
              action: 'start',
              ...(job ? { analysisId: job.analysisId } : {}),
              ...(feeling ? { arrivalFeeling: feeling } : {}),
            });
          }}
          className="inline-flex min-h-[72px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6" />}
          Llegué
        </button>

        {analysisId && !job && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            No encontré ese trabajo. Puedes medir igual, cuarto por cuarto.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // ── On the job ───────────────────────────────────────────────────────────
  const open = state.openSegment;
  const job = state.job;
  const sinceArrival = elapsedMinutes(state.session.startedAt, now);
  const taskSoFar =
    state.span!.taskMinutes + (open ? elapsedMinutes(open.startedAt, now) : 0);
  const overheadSoFar = Math.max(0, sinceArrival - taskSoFar);
  const closed = state.session.segments.filter((s) => s.endedAt);
  const visited = job ? job.rooms.filter((r) => state.session!.segments.some((s) => s.roomKey === r.key)) : [];

  const isOpen = (roomKey: string, taskKey?: string) =>
    open?.roomKey === roomKey && (open?.taskKey ?? undefined) === taskKey;

  const roomButton = (key: string, label: string, icon: string | undefined, current: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`flex min-h-[64px] w-full items-center gap-2 rounded-xl border-2 px-3 text-left text-base font-medium transition-colors disabled:opacity-60 ${
        current ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200' : 'dark:border-white/15'
      }`}
    >
      {icon && (
        <span aria-hidden className="text-xl">
          {icon}
        </span>
      )}
      {label}
    </button>
  );

  // What the voice asked for, as the buttons would have done it.
  const onVoice = (action: JobVoiceAction) => {
    if (action.kind === 'room') {
      // Saying the room she is already in must not split it in two.
      if (open?.roomKey === action.roomKey && (open?.taskKey ?? undefined) === action.taskKey) return;
      void send({ action: 'room', roomKey: action.roomKey, ...(action.taskKey ? { taskKey: action.taskKey } : {}) });
    } else if (action.kind === 'pause') {
      if (open) void send({ action: 'pause' });
    } else if (action.kind === 'leave') {
      if (open) void send({ action: 'pause' });
      setLeaving(true);
    }
  };

  // Rendered above both the working view and the leaving question, so the
  // camera keeps filming while she answers "¿hubo que repetir algo?".
  const handsFreeEl =
    handsFree && job ? <HandsFree ref={hfRef} rooms={job.rooms} current={open} onAction={onVoice} /> : null;

  const stopFilming = async () => {
    const summary = (await hfRef.current?.stop()) ?? null;
    if (summary) setRecording(summary);
    setHandsFree(false);
  };

  // ── Leaving: one question, so a fast room that was redone is not fast ────
  const leavingView = !leaving ? null : (() => {
    const finish = async (body: Record<string, unknown>) => {
      setBusy(true);
      await stopFilming();
      setLeaving(false);
      setRedoRooms(null);
      void send({ action: 'end', ...body });
    };
    return (
      <>
        <div className="rounded-2xl border p-5 dark:border-white/10">
          <h2 className="font-semibold">¿Hubo que repetir algo?</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Un cuarto rehecho tarda más y no dice nada de tu ritmo. Lo apartamos para que no cuente.
          </p>
        </div>

        {redoRooms === null ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => finish({ redo: false })}
              className="min-h-[64px] rounded-xl bg-brand-600 text-base font-semibold text-white disabled:opacity-60"
            >
              No, todo bien
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => (visited.length ? setRedoRooms([]) : finish({ redo: true }))}
              className="min-h-[64px] rounded-xl border-2 text-base font-semibold disabled:opacity-60 dark:border-white/20"
            >
              Sí
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">¿Cuál?</p>
            <div className="grid grid-cols-2 gap-2">
              {visited.map((r) =>
                roomButton(r.key, r.label, ICON_OF.get(r.type), redoRooms.includes(r.key), () =>
                  setRedoRooms(redoRooms.includes(r.key) ? redoRooms.filter((k) => k !== r.key) : [...redoRooms, r.key]),
                ),
              )}
            </div>
            <button
              type="button"
              disabled={busy || redoRooms.length === 0}
              onClick={() => finish({ redo: true, redoRooms })}
              className="min-h-[60px] w-full rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
            >
              Guardar y salir
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            setLeaving(false);
            setRedoRooms(null);
          }}
          className="min-h-[44px] w-full text-sm text-slate-500 underline dark:text-slate-400"
        >
          Volver, todavía no me voy
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </>
    );
  })();

  return (
    <div className="space-y-5">
      {handsFreeEl}
      {leavingView ?? (
      <>
      {state.otherJob && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {/* No closing period: the time already ends in "p.m." */}
            Tienes otro trabajo abierto desde las{' '}
            {new Date(state.session.startedAt).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Se cierra donde terminó su último cuarto, para que no cuente como una visita de horas.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              await send({ action: 'end', forgotten: true });
              setDone(null);
              await send(null);
            }}
            className="mt-3 min-h-[52px] w-full rounded-xl bg-amber-600 text-base font-semibold text-white disabled:opacity-60"
          >
            Cerrar ese y empezar este
          </button>
        </div>
      )}

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
              {open.taskKey ? open.task : segmentLabel(open, job)}
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
        {job ? (
          <div className="space-y-2">
            {job.rooms.map((room) => (
              <div key={room.key} className="space-y-1.5">
                {roomButton(room.key, room.label, ICON_OF.get(room.type), isOpen(room.key), () =>
                  send({ action: 'room', roomKey: room.key }),
                )}
                {room.extras.map((extra) => (
                  <button
                    key={extra.taskKey}
                    type="button"
                    disabled={busy}
                    onClick={() => send({ action: 'room', roomKey: room.key, taskKey: extra.taskKey })}
                    className={`ml-6 flex min-h-[48px] w-[calc(100%-1.5rem)] items-center rounded-xl border-2 px-3 text-left text-sm font-medium disabled:opacity-60 ${
                      isOpen(room.key, extra.taskKey)
                        ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                        : 'border-dashed dark:border-white/15'
                    }`}
                  >
                    {extra.label}
                  </button>
                ))}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOtherRooms(!otherRooms)}
              className="min-h-[44px] w-full text-sm text-slate-500 underline dark:text-slate-400"
            >
              {otherRooms ? 'Ocultar otros espacios' : 'Un espacio que no salió en el recorrido'}
            </button>
          </div>
        ) : null}
        {(!job || otherRooms) && (
          <div className="grid grid-cols-2 gap-2">
            {ROOMS.map((room) =>
              roomButton(room.type, room.label, room.icon, !open?.roomKey && open?.roomType === room.type, () =>
                send({ action: 'room', roomType: room.type }),
              ),
            )}
          </div>
        )}
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
          onClick={() => setLeaving(true)}
          className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-900"
        >
          <Square className="h-5 w-5" /> Me voy
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <strong>Parar</strong> es para cuando no estás en ningún cuarto — llevando cosas al coche,
        moviendo muebles. Ese tiempo cuenta igual, pero no es de un cuarto.
      </p>

      {job && (
        <button
          type="button"
          onClick={async () => {
            if (handsFree) {
              await stopFilming();
            } else {
              unlockAudio();
              setHandsFree(true);
            }
          }}
          className="min-h-[48px] w-full rounded-xl border-2 text-sm font-medium dark:border-white/15"
        >
          {handsFree ? 'Apagar manos libres' : 'Activar manos libres (cámara y voz)'}
        </button>
      )}

      {/* A wrong segment is marked, not deleted — see excludeSegment(). */}
      {closed.length > 0 && (
        <div className="rounded-2xl border p-4 dark:border-white/10">
          <p className="mb-2 text-sm font-medium">Hecho</p>
          <ul className="space-y-1">
            {closed.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span className={s.excluded ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}>
                  {s.taskKey ? s.task : segmentLabel(s, job)} · {s.minutes ?? 0}m
                </span>
                {!s.excluded && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt('¿Qué pasó? (por ejemplo: se me quedó el reloj corriendo)');
                      if (reason !== null) void send({ action: 'exclude', segmentId: s.id, reason });
                    }}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs text-slate-500 underline dark:text-slate-400"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Está mal
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
      </>
      )}
    </div>
  );
}
