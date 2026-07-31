'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Camera, Loader2, Check, ArrowRight, ArrowLeft, Lightbulb,
  Sparkles, Clock, Users, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { extractFrames, readImages, assessFrames, DEFAULT_FRAME_COUNT } from '@/lib/vision/frames';
import { formatDuration } from '@/lib/vision/estimate';
import { formatCurrency } from '@/lib/utils';
import {
  DEFAULT_HOME_SHAPE, startSession, progress, completeRoom, collapseToRoom,
  adviseOnQuality, inferFromObjects, DARK_FRAME_THRESHOLD,
  type HomeShape, type WalkSession,
} from '@/lib/vision/walk-session';
import { FLOOR_TYPES, FLOOR_TYPE_LABELS, PET_KINDS, PET_LABELS, type FloorType, type PetKind } from '@/lib/vision/tasks';
import type { WalkthroughPrompt } from '@/lib/vision/walkthrough';
import type { PropertyAnalysis, RoomAnalysis } from '@/lib/vision/types';
import type { VisionQuote } from '@/lib/vision/pricing';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';

/**
 * The guided walkthrough, on a phone, in someone's home.
 *
 * Everything here is subordinate to one goal: that a person standing in their
 * kitchen with one hand free finishes the walk. A screen that asks too much,
 * explains too little, or leaves them unsure what to point at gets abandoned
 * halfway down the hall — and a half-walked home produces a confident quote
 * built on a third of the work.
 *
 * Spanish leads and English follows underneath, because most people using this
 * read the first line and ignore the second.
 */

type Stage = 'intro' | 'shape' | 'property' | 'room' | 'offers' | 'quote';

type RoomObservation = ReturnType<typeof collapseToRoom>;

export function GuidedWalkthrough() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('intro');
  const [serviceSlug, setServiceSlug] = useState('house-cleaning');
  const [city, setCity] = useState(cities[0].name);

  const [shape, setShape] = useState<HomeShape>(DEFAULT_HOME_SHAPE);
  const [session, setSession] = useState<WalkSession>(() => startSession(DEFAULT_HOME_SHAPE));

  const [floorTypes, setFloorTypes] = useState<FloorType[]>([]);
  const [pets, setPets] = useState<PetKind[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [declined, setDeclined] = useState<string[]>([]);

  /** Observations kept per room so the final price costs no extra model call. */
  const [observations, setObservations] = useState<RoomObservation[]>([]);
  /**
   * The Spanish names used during the walk, in capture order.
   *
   * The estimator labels rooms from its own English table, which is right for
   * the admin and wrong here: someone who was just asked to film "el baño 2"
   * should not be shown "Bathroom 2" in their own quote.
   */
  const [roomLabels, setRoomLabels] = useState<string[]>([]);
  const [offers, setOffers] = useState<WalkthroughPrompt[]>([]);
  const [lastRead, setLastRead] = useState<{ es: string; en: string } | null>(null);
  const [inferred, setInferred] = useState<string[]>([]);

  const [busy, setBusy] = useState<'frames' | 'analyzing' | 'pricing' | null>(null);
  const [frameProgress, setFrameProgress] = useState({ done: 0, total: DEFAULT_FRAME_COUNT });
  const [darkWarning, setDarkWarning] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [analysis, setAnalysis] = useState<PropertyAnalysis | null>(null);
  const [quote, setQuote] = useState<VisionQuote | null>(null);

  const walk = progress(session);

  /**
   * Bring the current step under the sticky header whenever it changes.
   *
   * Without this the room title sits behind the navbar on a phone: the customer
   * taps through to the next room and cannot see which room they were just
   * asked to film. `scroll-mt-24` below is what keeps the heading clear of the
   * header rather than flush against it.
   */
  const stepRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [stage, walk.done]);

  function beginWalk() {
    const fresh = startSession(shape);
    setSession(fresh);
    setObservations([]);
    setRoomLabels([]);
    setStage(fresh.queue.length > 0 ? 'room' : 'shape');
  }

  /** Films one room: frames out of the video, brightness check, then analysis. */
  async function captureRoom(files: FileList | null) {
    if (!files?.length || !walk.room) return;
    setError('');
    setDarkWarning(null);

    try {
      const list = Array.from(files);
      setBusy('frames');
      const frames = list[0].type.startsWith('video/')
        ? await extractFrames(list[0], { onProgress: (done, total) => setFrameProgress({ done, total }) })
        : await readImages(list);

      // Checked before upload: a frame too dark to read is worth catching while
      // the customer can still turn a light on, and before we pay to analyse it.
      const quality = await assessFrames(frames, DARK_FRAME_THRESHOLD);
      const advice = adviseOnQuality(quality);
      if (advice) {
        setDarkWarning(advice.messageEs);
        setBusy(null);
        return;
      }

      setBusy('analyzing');
      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, serviceSlug, city }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No pudimos analizar ese cuarto.');
        return;
      }

      const analysed: PropertyAnalysis = data.analysis;
      // The customer told us which room this is; the model's guess cannot tell a
      // spare bedroom from an office, and splitting an open-plan kitchen in two
      // would quote the home for more rooms than it has.
      const observation = collapseToRoom(analysed.rooms as RoomAnalysis[], walk.room.type);

      setObservations((prev) => [...prev, observation]);
      setRoomLabels((prev) => [...prev, walk.room!.labelEs]);
      setLastRead(readBack(analysed, walk.room.labelEs));

      const clues = inferFromObjects(observation.objects);
      if (clues.reasonsEs.length) setInferred((prev) => [...new Set([...prev, ...clues.reasonsEs])]);
      if (clues.pets.length) setPets((prev) => [...new Set([...prev, ...clues.pets])]);

      const advanced = completeRoom(session, {
        ...walk.room,
        frameCount: frames.length,
        analysis: analysed,
      });
      setSession(advanced);

      // Offers are asked once, at the end — interrupting every room to sell
      // something is how a walkthrough stops being finished.
      if (progress(advanced).stage === 'review') {
        setOffers((data.walkthrough?.offers ?? []) as WalkthroughPrompt[]);
        setStage('offers');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo salió mal.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Prices what was already analysed — no second trip to the model. */
  async function finish() {
    setBusy('pricing');
    setError('');
    try {
      const res = await fetch('/api/vision/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rooms: observations,
          serviceSlug,
          city,
          preferences: { requested, declined },
          property: { floorTypes, pets },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No pudimos calcular el precio.');
        return;
      }
      setAnalysis(data.analysis);
      setQuote(data.quote);
      setStage('quote');
    } catch {
      setError('No pudimos calcular el precio.');
    } finally {
      setBusy(null);
    }
  }

  function toggle<T>(list: T[], value: T, set: (next: T[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <div ref={stepRef} className="mx-auto max-w-lg scroll-mt-24">
      {/*
        Only shown once the walk has started. Rendering it during the setup
        questions meant filling the bar to 100% and then animating it back down
        to zero the moment the first room appeared — which reads as losing
        progress rather than starting it.
      */}
      {(stage === 'room' || stage === 'offers') && (
        <div className="mb-6">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${stage === 'room' ? walk.percent : 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {stage === 'room' ? `${walk.done} de ${walk.total} espacios` : 'Recorrido completo'}
          </p>
        </div>
      )}

      {/* ── Intro ──────────────────────────────────────────────────────── */}
      {stage === 'intro' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Empecemos</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Te voy guiando cuarto por cuarto. Solo tienes que grabar unos segundos en cada uno y responder un par
              de preguntas.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              I&apos;ll guide you room by room. A few seconds of video each, and a couple of questions.
            </p>
          </div>

          <Field label="¿Qué tipo de limpieza?" sub="What kind of cleaning?">
            <select
              value={serviceSlug}
              onChange={(e) => setServiceSlug(e.target.value)}
              className="w-full rounded-xl border bg-white px-4 py-3 text-base dark:bg-white/5"
            >
              {services.map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </select>
          </Field>

          <Field label="¿Dónde queda?" sub="Where is it?">
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-xl border bg-white px-4 py-3 text-base dark:bg-white/5"
            >
              {cities.map((c) => <option key={c.slug}>{c.name}</option>)}
            </select>
          </Field>

          <Primary onClick={() => setStage('shape')}>Empezar</Primary>
        </div>
      )}

      {/* ── Home shape ─────────────────────────────────────────────────── */}
      {stage === 'shape' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">¿Cómo es la casa?</h2>
            <p className="mt-1 text-sm text-slate-400">So I know how many rooms we&apos;re walking.</p>
          </div>

          <Counter
            label="¿Cuántos cuartos?"
            sub="Bedrooms"
            value={shape.bedrooms}
            onChange={(bedrooms) => setShape((s) => ({ ...s, bedrooms }))}
          />
          <Counter
            label="¿Cuántos baños?"
            sub="Bathrooms"
            value={shape.bathrooms}
            onChange={(bathrooms) => setShape((s) => ({ ...s, bathrooms }))}
          />

          <Field label="¿Qué más hay?" sub="What else is there?">
            <div className="flex flex-wrap gap-2">
              {([
                ['hasKitchen', 'Cocina'],
                ['hasLivingRoom', 'Sala'],
                ['hasDiningRoom', 'Comedor'],
                ['hasOffice', 'Oficina'],
                ['hasLaundry', 'Lavandería'],
                ['hasStairs', 'Escaleras'],
                ['hasGarage', 'Garaje'],
                ['hasPatio', 'Patio'],
              ] as const).map(([key, label]) => (
                <Chip
                  key={key}
                  active={shape[key]}
                  onClick={() => setShape((s) => ({ ...s, [key]: !s[key] }))}
                >
                  {label}
                </Chip>
              ))}
            </div>
          </Field>

          <div className="flex gap-3">
            <Secondary onClick={() => setStage('intro')}>Atrás</Secondary>
            <Primary onClick={() => setStage('property')}>Seguir</Primary>
          </div>
        </div>
      )}

      {/* ── Floors and pets ────────────────────────────────────────────── */}
      {stage === 'property' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Dos cosas que la cámara no ve bien</h2>
            <p className="mt-1 text-sm text-slate-400">Two things the camera reads badly.</p>
          </div>

          <Field label="¿Qué tipo de pisos hay?" sub="La alfombra toma bastante más tiempo que el piso duro.">
            <div className="flex flex-wrap gap-2">
              {FLOOR_TYPES.map((f) => (
                <Chip key={f} active={floorTypes.includes(f)} onClick={() => toggle(floorTypes, f, setFloorTypes)}>
                  {FLOOR_TYPE_LABELS[f].es}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="¿Hay mascotas?" sub="El pelo casi nunca se ve en video, y es la razón más común de que un trabajo se alargue.">
            <div className="flex flex-wrap gap-2">
              {PET_KINDS.map((p) => (
                <Chip key={p} active={pets.includes(p)} onClick={() => toggle(pets, p, setPets)}>
                  {PET_LABELS[p].es}
                </Chip>
              ))}
              <Chip active={pets.length === 0} onClick={() => setPets([])}>Ninguna</Chip>
            </div>
          </Field>

          <div className="flex gap-3">
            <Secondary onClick={() => setStage('shape')}>Atrás</Secondary>
            <Primary onClick={beginWalk}>Empezar el recorrido</Primary>
          </div>
        </div>
      )}

      {/* ── Room by room ───────────────────────────────────────────────── */}
      {stage === 'room' && walk.room && walk.instruction && (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{walk.instruction.titleEs}</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">{walk.instruction.bodyEs}</p>
            <p className="mt-1 text-sm text-slate-400">{walk.instruction.body}</p>
          </div>

          {lastRead && (
            <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <p className="inline-flex items-center gap-1.5 font-medium">
                <Check className="h-4 w-4" /> Listo
              </p>
              <p className="mt-1">{lastRead.es}</p>
            </div>
          )}

          {/* Inference is shown back, never applied silently. */}
          {inferred.length > 0 && (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-slate-500 dark:text-slate-400">
              {inferred.map((reason) => <p key={reason}>{reason}</p>)}
            </div>
          )}

          {darkWarning && (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <p className="inline-flex items-center gap-1.5 font-medium">
                <Lightbulb className="h-4 w-4" /> Está muy oscuro
              </p>
              <p className="mt-1">{darkWarning}</p>
              <p className="mt-1 text-xs opacity-80">
                Enciende la luz del cuarto o el flash de la cámara y grábalo otra vez.
              </p>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="video/*,image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => captureRoom(e.target.files)}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-4 text-base font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === 'frames' ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Leyendo el video… {frameProgress.done}/{frameProgress.total}</>
            ) : busy === 'analyzing' ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Mirando el cuarto…</>
            ) : (
              <><Camera className="h-5 w-5" /> {darkWarning ? 'Grabar otra vez' : `Grabar ${walk.instruction.titleEs.toLowerCase()}`}</>
            )}
          </button>

          <p className="text-center text-xs text-slate-400">
            {walk.nextUpEs} · Unos {walk.instruction.seconds} segundos bastan.
          </p>

          {error && <Problem>{error}</Problem>}
        </div>
      )}

      {/* ── Optional extras ────────────────────────────────────────────── */}
      {stage === 'offers' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">¿Algo más?</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Esto no viene incluido, pero lo podemos agregar. Toca lo que quieras.
            </p>
            <p className="mt-1 text-sm text-slate-400">Optional extras — tap anything you want included.</p>
          </div>

          {offers.length === 0 ? (
            <p className="text-sm text-slate-400">Nada extra que ofrecerte para este servicio.</p>
          ) : (
            <div className="space-y-2">
              {offers.map((offer) => {
                const on = requested.includes(offer.taskId!);
                return (
                  <button
                    key={offer.id}
                    type="button"
                    onClick={() => toggle(requested, offer.taskId!, setRequested)}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${
                      on ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                        on ? 'border-brand-600 bg-brand-600 text-white' : ''
                      }`}
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{offer.questionEs}</span>
                      {offer.helpEs && <span className="block text-xs text-slate-400">{offer.helpEs}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <Primary onClick={finish} disabled={busy !== null}>
            {busy === 'pricing' ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Calculando…</>
            ) : (
              <>Ver mi precio <ArrowRight className="h-5 w-5" /></>
            )}
          </Primary>

          {error && <Problem>{error}</Problem>}
        </div>
      )}

      {/* ── The price ──────────────────────────────────────────────────── */}
      {stage === 'quote' && analysis && quote && (
        <div className="space-y-6">
          <div className="rounded-3xl border bg-white p-6 text-center shadow-soft dark:bg-white/[0.03]">
            <p className="text-sm text-slate-500 dark:text-slate-400">Tu estimado</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight">
              {formatCurrency(quote.totalLow)} – {formatCurrency(quote.totalHigh)}
            </p>
            <div className="mt-4 flex items-center justify-center gap-5 text-sm text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" /> {formatDuration(analysis.totalMinutes)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4" /> {analysis.recommendedPros} {analysis.recommendedPros === 1 ? 'persona' : 'personas'}
              </span>
            </div>
            {quote.taxRate > 0 && (
              <p className="mt-3 text-xs text-slate-400">Incluye impuesto ({(quote.taxRate * 100).toFixed(2)}%).</p>
            )}
          </div>

          {analysis.warnings.length > 0 && (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {analysis.warnings.map((w) => (
                <p key={w} className="inline-flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          <div className="rounded-2xl border bg-white dark:bg-white/[0.03]">
            <p className="border-b p-4 font-medium">Lo que incluye</p>
            <div className="divide-y">
              {analysis.rooms.map((room, i) => (
                <details key={`${room.label}-${i}`} className="group p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                    <span className="font-medium">{roomLabels[i] ?? room.label}</span>
                    <span className="text-slate-400">
                      {formatDuration(room.estimatedMinutes)}
                      <span className="ml-2 transition-transform group-open:rotate-45 inline-block">+</span>
                    </span>
                  </summary>
                  <ul className="mt-3 space-y-1">
                    {room.tasks.map((task) => (
                      <li key={task.id} className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>{task.labelEs}</span>
                        <span className="shrink-0 pl-3">{Math.round(task.minutes)} min</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>

          {/* Stacked, and the booking button first: on a phone these two sat
              side by side with the chat bubble parked on top of the one that
              matters. */}
          <div className="flex flex-col gap-3">
            <a
              href={`/book?service=${serviceSlug}&city=${encodeURIComponent(city)}`}
              className="flex items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-base font-medium text-white transition hover:bg-brand-700"
            >
              <Sparkles className="h-5 w-5" /> Reservar
            </a>
            <Secondary
              onClick={() => {
                setStage('intro');
                setSession(startSession(DEFAULT_HOME_SHAPE));
                setObservations([]);
                setRoomLabels([]);
                setLastRead(null);
                setInferred([]);
                setRequested([]);
                setAnalysis(null);
                setQuote(null);
              }}
            >
              <RefreshCw className="h-4 w-4" /> Empezar de nuevo
            </Secondary>
          </div>

          <p className="text-center text-xs text-slate-400">
            Es un estimado a partir de lo que mostró el video. Tu profesional confirma el alcance al llegar, y
            cualquier cambio se acuerda contigo antes de empezar.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A one-line read of the room, in the words someone would use about their own
 * home. Never states minutes or a price — a number said here that disagrees
 * with the final quote is exactly the surprise this product exists to avoid.
 */
function readBack(analysis: PropertyAnalysis, label: string): { es: string; en: string } {
  const worst = analysis.rooms
    .flatMap((room) => Object.entries(room.soil) as [string, number][])
    .filter(([, score]) => score >= 35)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  const WORDS: Record<string, string> = {
    dust: 'polvo', grease: 'grasa', stains: 'manchas',
    clutter: 'desorden', hair: 'pelo', trash: 'basura', mold: 'moho',
  };

  if (worst.length === 0) return { es: `${label}: se ve en buen estado.`, en: `${label}: looks in good shape.` };

  const heavy = worst[0][1] >= 65;
  const named = worst.map(([dim]) => WORDS[dim] ?? dim).join(' y ');
  return {
    es: `${label}: ${heavy ? 'bastante' : 'algo de'} ${named}.`,
    en: `${label}: ${heavy ? 'a lot of' : 'some'} ${named}.`,
  };
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      {sub && <p className="mb-2 mt-0.5 text-xs text-slate-400">{sub}</p>}
      <div className={sub ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

function Counter({
  label, sub, value, onChange,
}: { label: string; sub: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Menos ${sub}`}
          className="grid h-11 w-11 place-items-center rounded-xl border text-lg"
        >
          −
        </button>
        <span className="w-6 text-center text-lg font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(10, value + 1))}
          aria-label={`Más ${sub}`}
          className="grid h-11 w-11 place-items-center rounded-xl border text-lg"
        >
          +
        </button>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-4 py-2 text-sm transition ${
        active ? 'border-brand-500 bg-brand-50/60 font-medium text-brand-700 dark:bg-brand-950/30 dark:text-brand-300' : ''
      }`}
    >
      {children}
    </button>
  );
}

function Primary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-base font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function Secondary({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-2xl border px-5 py-3.5 text-base transition hover:bg-slate-50 dark:hover:bg-white/5"
    >
      <ArrowLeft className="h-4 w-4" /> {children}
    </button>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{children}</p>
  );
}
