'use client';

import { useRef, useState } from 'react';
import {
  Upload, Loader2, Check, ArrowRight, ArrowLeft, ShieldCheck,
  Clock, AlertTriangle, Plus, Trash2, Sparkles, Mic,
} from 'lucide-react';
import { extractFrames, readImages, thumbnailsFor, DEFAULT_FRAME_COUNT } from '@/lib/vision/frames';
import { formatDuration } from '@/lib/vision/estimate';
import {
  SOIL_DIMENSIONS, ROOM_TYPES, ROOM_LABELS, EMPTY_SOIL,
  type PropertyAnalysis, type RoomAnalysis, type RoomType,
} from '@/lib/vision/types';
import { VoiceControl } from '@/components/pilot/VoiceControl';
import { LiveCapture } from '@/components/capture/LiveCapture';
import { GuidedCapture } from '@/components/capture/GuidedCapture';
import { readJson } from '@/lib/http';
import { THUMBNAIL_EDGE_PX } from '@/lib/vision/archive';
import { RoomSize } from '@/components/pilot/RoomSize';
import { appaLevelFor } from '@/lib/vision/appa';
import type { VoiceCommand } from '@/lib/vision/voice-commands';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';

/**
 * Field capture tool for real jobs.
 *
 * The point is not to collect footage — it's to collect *corrections*. The
 * model makes a guess, the person standing in the room fixes it, and that pair
 * is what makes the engine better. Built phone-first because it's used
 * one-handed, standing in someone's kitchen.
 */

type Step = 'setup' | 'consent' | 'capture' | 'correct' | 'after' | 'wrap' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'setup', label: 'Job' },
  { id: 'consent', label: 'Consent' },
  { id: 'capture', label: 'Scan' },
  { id: 'correct', label: 'Correct' },
  { id: 'after', label: 'After' },
  { id: 'wrap', label: 'Wrap' },
];

export function PilotCapture({ capturedBy }: { capturedBy: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('setup');
  const [serviceSlug, setServiceSlug] = useState('deep-cleaning');
  const [city, setCity] = useState(cities[0].name);
  const [propertyType, setPropertyType] = useState('residential');

  const [consentName, setConsentName] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentTraining, setConsentTraining] = useState(false);

  const [busy, setBusy] = useState<'frames' | 'analyzing' | 'saving' | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: DEFAULT_FRAME_COUNT });
  const [error, setError] = useState('');

  const [frameCount, setFrameCount] = useState(0);
  const [predicted, setPredicted] = useState<PropertyAnalysis | null>(null);
  const [rooms, setRooms] = useState<RoomAnalysis[]>([]);
  const [activeRoom, setActiveRoom] = useState(0);
  /** Which slider was last moved, so only its rubric wording is shown. */
  const [touched, setTouched] = useState<{ room: number; dim: string } | null>(null);
  const [afterAnalysis, setAfterAnalysis] = useState<PropertyAnalysis | null>(null);
  const [quality, setQuality] = useState<{ score: number; verdict: string; summary: string } | null>(null);
  const [actualMinutes, setActualMinutes] = useState('');
  const [jobSequence, setJobSequence] = useState('1');
  const [hoursWorkedToday, setHoursWorkedToday] = useState('0');
  const [crewSize, setCrewSize] = useState('1');
  const [notes, setNotes] = useState('');
  const [savedId, setSavedId] = useState('');

  async function handleFiles(files: FileList | null, phase: 'before' | 'after' = 'before') {
    if (!files?.length) return;
    setError('');
    try {
      const list = Array.from(files);
      setBusy('frames');
      const frames = list[0].type.startsWith('video/')
        ? await extractFrames(list[0], { onProgress: (done, total) => setProgress({ done, total }) })
        : await readImages(list);
      await analyzeFrames(frames, phase);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  }

  /** Shared by the guided walkthrough, the live camera and the file picker. */
  async function analyzeFrames(
    frames: string[],
    phase: 'before' | 'after' = 'before',
    captions?: string[],
  ) {
    setError('');
    try {
      if (phase === 'before') setFrameCount(frames.length);
      setBusy('analyzing');

      // Only built when the customer actually agreed. Generating them anyway
      // and letting the server decide would put images the customer refused
      // onto the wire, which is the wrong side of the decision to be on.
      const archive = consentTraining ? await thumbnailsFor(frames, THUMBNAIL_EDGE_PX) : undefined;

      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          captions,
          archiveFrames: archive,
          consentTraining,
          serviceSlug,
          city,
        }),
      });
      const { data, failure } = await readJson<any>(res);
      if (failure || !data) {
        setError(failure ?? 'Analysis failed.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'Analysis failed.');
        return;
      }
      if (phase === 'after') {
        setAfterAnalysis(data.analysis);
        setStep('wrap');
      } else {
        setPredicted(data.analysis);
        // Deep copy so corrections never mutate the prediction we compare against.
        setRooms(JSON.parse(JSON.stringify(data.analysis.rooms)));
        setActiveRoom(0);
        setStep('correct');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  function updateSoil(roomIndex: number, dim: string, value: number) {
    setTouched({ room: roomIndex, dim });
    setRooms((prev) =>
      prev.map((r, i) => (i === roomIndex ? { ...r, soil: { ...r.soil, [dim]: value } } : r)),
    );
  }

  /** Undefined clears the measurement, which is different from a zero area. */
  function updateArea(roomIndex: number, sqft: number | undefined) {
    setRooms((prev) => prev.map((r, i) => (i === roomIndex ? { ...r, areaSqft: sqft } : r)));
  }

  function updateRoomType(roomIndex: number, type: RoomType) {
    setRooms((prev) =>
      prev.map((r, i) => (i === roomIndex ? { ...r, type, label: ROOM_LABELS[type] } : r)),
    );
  }

  function addRoom() {
    setRooms((prev) => [
      ...prev,
      {
        type: 'bedroom',
        label: 'Bedroom (added)',
        confidence: 1,
        objects: [],
        soil: { ...EMPTY_SOIL },
        condition: 'good',
        estimatedMinutes: 0,
      },
    ]);
  }

  function removeRoom(index: number) {
    setRooms((prev) => prev.filter((_, i) => i !== index));
    setActiveRoom((a) => Math.max(0, a >= index ? a - 1 : a));
  }

  /**
   * Applies a spoken command. Commands with no room named act on the room
   * currently in focus, so you can walk through a house saying levels without
   * naming the room every time.
   */
  function handleVoice(command: VoiceCommand) {
    setRooms((prev) => {
      const targetIndex =
        'roomType' in command && command.roomType
          ? prev.findIndex((r) => r.type === command.roomType)
          : activeRoom;
      const index = targetIndex >= 0 ? targetIndex : activeRoom;

      if (command.kind === 'set') {
        if (index !== activeRoom) setActiveRoom(index);
        return prev.map((r, i) =>
          i === index ? { ...r, soil: { ...r.soil, [command.dimension]: command.value } } : r,
        );
      }
      if (command.kind === 'measure') {
        if (index !== activeRoom) setActiveRoom(index);
        return prev.map((r, i) => (i === index ? { ...r, areaSqft: command.sqft } : r));
      }
      if (command.kind === 'clearRoom') {
        if (index !== activeRoom) setActiveRoom(index);
        return prev.map((r, i) => (i === index ? { ...r, soil: { ...EMPTY_SOIL } } : r));
      }
      if (command.kind === 'remove') {
        setActiveRoom((a) => Math.max(0, Math.min(a, prev.length - 2)));
        return prev.filter((_, i) => i !== index);
      }
      return prev;
    });

    if (command.kind === 'next') setActiveRoom((a) => Math.min(a + 1, rooms.length - 1));
    if (command.kind === 'prev') setActiveRoom((a) => Math.max(a - 1, 0));
    if (command.kind === 'done' && rooms.length > 0) setStep('after');
  }

  async function submit() {
    const minutes = Number(actualMinutes);
    if (!minutes || minutes < 1) {
      setError('Enter how many minutes the job actually took.');
      return;
    }
    setBusy('saving');
    setError('');
    try {
      const res = await fetch('/api/pilot/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceSlug,
          city,
          propertyType,
          consentName,
          consentTraining,
          frameCount,
          predicted,
          corrected: { ...predicted, rooms },
          afterAnalysis: afterAnalysis ?? undefined,
          actualMinutes: minutes,
          jobSequence: Number(jobSequence) || undefined,
          hoursWorkedToday: Number(hoursWorkedToday) || undefined,
          crewSize: Number(crewSize) || 1,
          startHour: new Date().getHours(),
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not save the sample.');
        return;
      }
      setSavedId(data.id);
      if (data.quality) setQuality(data.quality);
      setStep('done');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function resetForNextJob() {
    setStep('setup');
    setConsentName('');
    setConsentGiven(false);
    setConsentTraining(false);
    setPredicted(null);
    setRooms([]);
    setActiveRoom(0);
    setAfterAnalysis(null);
    setQuality(null);
    setActualMinutes('');
    setNotes('');
    setSavedId('');
    setFrameCount(0);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === 'done') {
    const magnitude =
      predicted && rooms.length
        ? Math.round(
            rooms.reduce((sum, r, i) => {
              const p = predicted.rooms[i];
              if (!p) return sum;
              return sum + SOIL_DIMENSIONS.reduce((s, d) => s + Math.abs((p.soil[d] ?? 0) - (r.soil[d] ?? 0)), 0);
            }, 0) / (rooms.length * SOIL_DIMENSIONS.length),
          )
        : 0;

    return (
      <div className="rounded-3xl border bg-white p-7 text-center shadow-lift dark:bg-ink-soft">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
          <Check className="h-7 w-7" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold">Sample saved</h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          The engine just learned from this job.
        </p>
        <div className="mt-6 space-y-2 rounded-2xl bg-slate-50 p-4 text-left text-sm dark:bg-white/5">
          <Row label="Predicted time" value={formatDuration(predicted?.totalMinutes ?? 0)} />
          <Row label="Actual time" value={formatDuration(Number(actualMinutes))} />
          <Row
            label="Time miss"
            value={`${Math.abs((predicted?.totalMinutes ?? 0) - Number(actualMinutes))} min`}
          />
          <Row label="Your corrections" value={`${magnitude} pts avg`} />
          {quality && <Row label="Quality score" value={`${quality.score}/100`} />}
          <Row label="Sample" value={savedId} />
        </div>
        {quality && (
          <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-left text-sm text-brand-900 dark:bg-brand-950/30 dark:text-brand-200">
            {quality.summary}
          </p>
        )}
        <button
          onClick={resetForNextJob}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white hover:bg-brand-700"
        >
          Capture next job
        </button>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div>
      {/* Progress */}
      <div className="mb-6 flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex flex-1 items-center gap-1.5">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                i <= stepIndex ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400 dark:bg-white/5'
              }`}
            >
              {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            {i < STEPS.length - 1 && (
              <span className={`h-px flex-1 ${i < stepIndex ? 'bg-brand-600' : 'bg-slate-200 dark:bg-white/10'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="rounded-3xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
        {/* ── Setup ─────────────────────────────────────────────────────── */}
        {step === 'setup' && (
          <div className="space-y-5">
            <h2 className="text-xl font-semibold">What job is this?</h2>
            <div>
              <label className="text-sm font-medium">Service</label>
              <select
                value={serviceSlug}
                onChange={(e) => setServiceSlug(e.target.value)}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-brand-400 dark:bg-white/5"
              >
                {services.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">City</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-brand-400 dark:bg-white/5"
              >
                {cities.map((c) => <option key={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Property</label>
              <div className="mt-2 flex gap-2">
                {['residential', 'commercial'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setPropertyType(t)}
                    className={`flex-1 rounded-xl border py-3 text-sm capitalize transition-all ${
                      propertyType === t ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/20' : ''
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <NextButton onClick={() => setStep('consent')} />
          </div>
        )}

        {/* ── Consent ───────────────────────────────────────────────────── */}
        {step === 'consent' && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <p>
                Ask the customer before recording. Footage of someone’s home without permission can’t be used —
                not for the model, not for anything.
              </p>
            </div>
            <h2 className="text-xl font-semibold">Customer permission</h2>
            <div>
              <label className="text-sm font-medium">Who gave permission?</label>
              <input
                value={consentName}
                onChange={(e) => setConsentName(e.target.value)}
                placeholder="Customer name"
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-brand-400 dark:bg-white/5"
              />
            </div>
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
              />
              <span>The customer agreed to a video walkthrough for this quote.</span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
              <input
                type="checkbox"
                checked={consentTraining}
                onChange={(e) => setConsentTraining(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
              />
              <span>
                They also agreed it may be used to improve our estimating system.
                <span className="mt-0.5 block text-xs text-slate-400">
                  Optional. Without this the sample is used for this job only.
                </span>
              </span>
            </label>
            <div className="flex gap-3">
              <BackButton onClick={() => setStep('setup')} />
              <NextButton onClick={() => setStep('capture')} disabled={!consentGiven || consentName.trim().length < 2} />
            </div>
          </div>
        )}

        {/* ── Capture ───────────────────────────────────────────────────── */}
        {step === 'capture' && (
          <div className="space-y-5">
            <h2 className="text-xl font-semibold">Scan the space</h2>
            <input
              ref={inputRef}
              type="file"
              accept="video/*,image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {busy ? (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
                <p className="mt-4 font-medium">
                  {busy === 'frames' ? `Reading frame ${progress.done} of ${progress.total}` : 'Analyzing…'}
                </p>
              </div>
            ) : (
              <>
                <GuidedCapture
                  serviceSlug={serviceSlug}
                  onComplete={({ frames, captions }) => analyzeFrames(frames, 'before', captions)}
                  fallback={
                    <button
                      onClick={() => inputRef.current?.click()}
                      className="w-full rounded-2xl border-2 border-dashed p-6 text-center text-sm"
                    >
                      <Upload className="mx-auto h-6 w-6 text-brand-600" />
                      <span className="mt-2 block font-medium">Elegir un vídeo guardado</span>
                    </button>
                  }
                />
                {/* The free-form pass stays available: a pro who already knows
                    the property does not need to be walked through it. */}
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Grabar libre, sin guía
                  </summary>
                  <div className="mt-3">
                    <LiveCapture
                      label="Grabar recorrido libre"
                      onFrames={(frames) => analyzeFrames(frames, 'before')}
                    />
                  </div>
                </details>
                <BackButton onClick={() => setStep('consent')} />
              </>
            )}
          </div>
        )}

        {/* ── Correct ───────────────────────────────────────────────────── */}
        {step === 'correct' && predicted && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold">Fix what the AI got wrong</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This is the part that matters. Your corrections are what train the engine — be honest, not kind.
              </p>
            </div>

            {predicted.warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{predicted.warnings.join(' · ')}</span>
              </div>
            )}

            <VoiceControl onCommand={handleVoice} currentRoomLabel={rooms[activeRoom]?.label} />

            {rooms.map((room, i) => {
              const original = predicted.rooms[i];
              const isActive = i === activeRoom;
              return (
                <div
                  key={i}
                  onClick={() => setActiveRoom(i)}
                  className={`rounded-2xl border p-4 transition-colors ${
                    isActive ? 'border-brand-400 bg-brand-50/30 dark:bg-brand-950/10' : ''
                  }`}
                >
                  {isActive && (
                    <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                      <Mic className="h-3 w-3" /> Voice targets this room
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <select
                      value={room.type}
                      onChange={(e) => updateRoomType(i, e.target.value as RoomType)}
                      className="flex-1 rounded-lg border bg-white px-3 py-2 text-sm font-medium outline-none focus:border-brand-400 dark:bg-white/5"
                    >
                      {ROOM_TYPES.map((t) => (
                        <option key={t} value={t}>{ROOM_LABELS[t]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeRoom(i)}
                      title="Remove — the AI saw a room that isn't there"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <RoomSize value={room.areaSqft} onChange={(sqft) => updateArea(i, sqft)} />

                  <div className="mt-4 space-y-3">
                    {SOIL_DIMENSIONS.map((dim) => {
                      const value = room.soil[dim] ?? 0;
                      const predictedValue = original?.soil[dim] ?? 0;
                      const changed = value !== predictedValue;
                      const level = appaLevelFor(value);
                      return (
                        <div key={dim}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="capitalize text-slate-600 dark:text-slate-300">
                              {dim}
                              {value > 0 && (
                                <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/10 dark:text-slate-400">
                                  APPA {level.level}
                                </span>
                              )}
                            </span>
                            <span className={changed ? 'font-semibold text-brand-600' : 'text-slate-400'}>
                              {value}
                              {changed && <span className="ml-1 text-slate-400">(AI: {predictedValue})</span>}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={value}
                            onChange={(e) => updateSoil(i, dim, Number(e.target.value))}
                            className="mt-1 w-full accent-brand-600"
                          />
                          {/* The number alone means nothing, so the rubric has to
                              be reachable — but printing it under all 28 sliders
                              turned the page into a 20,000px scroll. It shows for
                              the slider being moved, which is the only one whose
                              wording the rater is actually weighing. */}
                          {touched?.room === i && touched.dim === dim && value > 0 && (
                            <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                              <span className="font-medium">{level.name}</span> — {level.observableEs}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <button
              onClick={addRoom}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600"
            >
              <Plus className="h-4 w-4" /> Add a room the AI missed
            </button>

            <div className="flex gap-3">
              <BackButton onClick={() => setStep('capture')} />
              <NextButton onClick={() => setStep('after')} disabled={rooms.length === 0} />
            </div>
          </div>
        )}

        {/* ── After ─────────────────────────────────────────────────────── */}
        {step === 'after' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold">Scan the finished job</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Same rooms, same order if you can. This measures how much actually improved — proof for the
                customer, and a quality score you can’t fake.
              </p>
            </div>

            <input
              ref={afterInputRef}
              type="file"
              accept="video/*,image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files, 'after')}
            />

            {busy ? (
              <div className="py-10 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
                <p className="mt-4 font-medium">
                  {busy === 'frames' ? `Reading frame ${progress.done} of ${progress.total}` : 'Analyzing…'}
                </p>
              </div>
            ) : (
              <>
                <button
                  onClick={() => afterInputRef.current?.click()}
                  className="w-full rounded-2xl border-2 border-dashed p-10 text-center transition-colors hover:border-brand-400"
                >
                  <Upload className="mx-auto h-8 w-8 text-brand-600" />
                  <span className="mt-3 block font-medium">Record the after</span>
                  <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                    Walk the same route once you’re done
                  </span>
                </button>
                <div className="flex gap-3">
                  <BackButton onClick={() => setStep('correct')} />
                  <button
                    onClick={() => setStep('wrap')}
                    className="inline-flex h-12 flex-1 items-center justify-center rounded-full border text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
                  >
                    Skip for now
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Wrap up ───────────────────────────────────────────────────── */}
        {step === 'wrap' && (
          <div className="space-y-5">
            <h2 className="text-xl font-semibold">How long did it take?</h2>

            {afterAnalysis && (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                After-walkthrough captured — quality score will be calculated on save.
              </p>
            )}
            <div className="rounded-2xl bg-slate-50 p-4 text-sm dark:bg-white/5">
              <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Sparkles className="h-4 w-4" /> The AI predicted
              </span>
              <p className="mt-1 text-xl font-semibold">{formatDuration(predicted?.totalMinutes ?? 0)}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Actual minutes worked</label>
              <div className="mt-2 flex items-center gap-2">
                <Clock className="h-5 w-5 text-slate-400" />
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={actualMinutes}
                  onChange={(e) => setActualMinutes(e.target.value)}
                  placeholder="e.g. 145"
                  className="flex-1 rounded-xl border bg-white px-4 py-3 text-base outline-none focus:border-brand-400 dark:bg-white/5"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Total person-minutes. Two cleaners for an hour is 120.
              </p>
            </div>

            {/*
              Operator context. Cheap to answer, and it captures variance that
              no amount of looking at the room can explain — the same bathroom
              is a different job on your fourth stop of the day.
            */}
            <div className="rounded-2xl border p-4">
              <p className="text-sm font-medium">About this shift</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Takes five seconds and explains a lot of the timing difference.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <SmallField label="Job # today" value={jobSequence} onChange={setJobSequence} min={1} max={20} />
                <SmallField label="Hrs worked" value={hoursWorkedToday} onChange={setHoursWorkedToday} min={0} max={16} step="0.5" />
                <SmallField label="Cleaners" value={crewSize} onChange={setCrewSize} min={1} max={10} />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Anything unusual — pets, hoarding, construction dust…"
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
              />
            </div>
            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}
            <div className="flex gap-3">
              <BackButton onClick={() => setStep('after')} />
              <button
                onClick={submit}
                disabled={busy === 'saving'}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save sample
              </button>
            </div>
          </div>
        )}

        {error && step !== 'wrap' && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">Capturing as {capturedBy}</p>
    </div>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
    >
      Continue <ArrowRight className="h-4 w-4" />
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}

function SmallField({
  label, value, onChange, min, max, step,
}: {
  label: string; value: string; onChange: (v: string) => void; min: number; max: number; step?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-500 dark:text-slate-400">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:border-brand-400 dark:bg-white/5"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
