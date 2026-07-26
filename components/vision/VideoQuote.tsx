'use client';

import { useRef, useState } from 'react';
import { Upload, Loader2, Sparkles, ArrowRight, AlertTriangle, Clock, Users, ShoppingBag } from 'lucide-react';
import { extractFrames, readImages, DEFAULT_FRAME_COUNT } from '@/lib/vision/frames';
import { formatDuration } from '@/lib/vision/estimate';
import { formatCurrency } from '@/lib/utils';
import { CONDITION_LABELS, SOIL_DIMENSIONS, type PropertyAnalysis } from '@/lib/vision/types';
import type { VisionQuote } from '@/lib/vision/pricing';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';
import { Button } from '@/components/ui/Button';

type Stage = 'idle' | 'extracting' | 'analyzing' | 'done' | 'error';

const CONDITION_STYLES: Record<string, string> = {
  excellent: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  fair: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  poor: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  very_poor: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300',
};

export function VideoQuote() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState({ done: 0, total: DEFAULT_FRAME_COUNT });
  const [error, setError] = useState('');
  const [serviceSlug, setServiceSlug] = useState('deep-cleaning');
  const [city, setCity] = useState(cities[0].name);
  const [frames, setFrames] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<PropertyAnalysis | null>(null);
  const [quote, setQuote] = useState<VisionQuote | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setError('');
    setAnalysis(null);
    setQuote(null);

    try {
      let extracted: string[];
      if (files[0].type.startsWith('video/')) {
        setStage('extracting');
        setProgress({ done: 0, total: DEFAULT_FRAME_COUNT });
        extracted = await extractFrames(files[0], {
          onProgress: (done, total) => setProgress({ done, total }),
        });
      } else if (files[0].type.startsWith('image/')) {
        setStage('extracting');
        extracted = await readImages(files);
      } else {
        throw new Error('Please choose a video or photos of the space.');
      }

      setFrames(extracted);
      setStage('analyzing');

      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: extracted, serviceSlug, city }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'We could not analyze that footage.');
        setStage('error');
        return;
      }

      setAnalysis(data.analysis);
      setQuote(data.quote);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStage('error');
    }
  }

  const busy = stage === 'extracting' || stage === 'analyzing';

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        {/* Setup */}
        <div className="rounded-3xl border bg-white p-6 shadow-soft dark:bg-white/[0.03]">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Service</label>
              <select
                value={serviceSlug}
                onChange={(e) => setServiceSlug(e.target.value)}
                disabled={busy}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
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
                disabled={busy}
                className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
              >
                {cities.map((c) => (
                  <option key={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Upload */}
        <div className="rounded-3xl border-2 border-dashed bg-white p-8 text-center dark:bg-white/[0.03]">
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
            <div className="py-6">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
              <p className="mt-4 font-medium">
                {stage === 'extracting' ? 'Reading your walkthrough…' : 'Analyzing the space…'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {stage === 'extracting'
                  ? `Capturing frame ${progress.done} of ${progress.total}`
                  : 'Identifying rooms, objects and soil levels'}
              </p>
            </div>
          ) : (
            <>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/50">
                <Upload className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">Record or upload a walkthrough</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                Walk slowly through each room with good lighting. 30–90 seconds is plenty. Photos work too.
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand-600 px-7 text-sm font-medium text-white transition-all hover:bg-brand-700"
              >
                <Sparkles className="h-4 w-4" /> {analysis ? 'Try another video' : 'Choose video or photos'}
              </button>
              <p className="mt-3 text-xs text-slate-400">
                Frames are read on your device — the full video is never uploaded.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Frames preview */}
        {frames.length > 0 && stage !== 'extracting' && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Frames analyzed</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {frames.map((f, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={f} alt={`Frame ${i + 1}`} className="h-20 w-28 shrink-0 rounded-lg border object-cover" />
              ))}
            </div>
          </div>
        )}

        {/* Room breakdown */}
        {analysis && (
          <div className="space-y-4">
            {analysis.warnings.length > 0 && (
              <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <ul className="space-y-1">
                  {analysis.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}

            <h2 className="text-lg font-semibold">What we found</h2>
            {analysis.rooms.map((room) => (
              <div key={room.label} className="rounded-2xl border bg-white p-5 shadow-soft dark:bg-white/[0.03]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{room.label}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${CONDITION_STYLES[room.condition]}`}>
                      {CONDITION_LABELS[room.condition]}
                    </span>
                    <span className="text-sm font-medium">{formatDuration(room.estimatedMinutes)}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {SOIL_DIMENSIONS.filter((d) => room.soil[d] > 0).map((d) => (
                    <div key={d} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs capitalize text-slate-500 dark:text-slate-400">{d}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div className="h-full rounded-full bg-brand-600 dark:bg-brand-500" style={{ width: `${room.soil[d]}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-400">{room.soil[d]}</span>
                    </div>
                  ))}
                </div>

                {room.objects.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {room.objects.slice(0, 10).map((o) => (
                      <span key={o.name} className="rounded-full border px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {o.name}{o.count > 1 ? ` ×${o.count}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {room.notes && <p className="mt-3 text-xs text-slate-400">{room.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quote panel */}
      <aside className="h-fit rounded-3xl border bg-white p-6 shadow-soft lg:sticky lg:top-24 dark:bg-white/[0.03]">
        {quote && analysis ? (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400">Your AI quote</p>
            <p className="mt-1 text-3xl font-semibold">
              {formatCurrency(quote.totalLow)}–{formatCurrency(quote.totalHigh)}
            </p>
            {quote.taxRate > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Includes {(quote.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')}% sales tax
              </p>
            )}

            <div className="mt-5 space-y-3 border-t pt-4 text-sm">
              <Row icon={<Clock className="h-4 w-4" />} label="Estimated time" value={formatDuration(quote.minutes)} />
              <Row icon={<Users className="h-4 w-4" />} label="Crew" value={`${quote.recommendedPros} pro${quote.recommendedPros > 1 ? 's' : ''}`} />
              <Row
                icon={<Sparkles className="h-4 w-4" />}
                label="Overall condition"
                value={CONDITION_LABELS[analysis.condition]}
              />
              <Row label="Rooms analyzed" value={String(analysis.rooms.length)} />
              <Row label="AI confidence" value={`${Math.round(analysis.confidence * 100)}%`} />
            </div>

            {analysis.suppliesNeeded.length > 0 && (
              <div className="mt-5 border-t pt-4">
                <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
                  <ShoppingBag className="h-3.5 w-3.5" /> Supplies needed
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  {analysis.suppliesNeeded.map((s) => <li key={s}>· {s}</li>)}
                </ul>
              </div>
            )}

            <Button href={`/book?service=${serviceSlug}`} className="mt-6 w-full">
              Book this clean <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="mt-3 text-xs text-slate-400">
              Your pro confirms the scope on arrival. If the space differs from the video, we agree any change with you first — never a surprise charge.
            </p>
          </>
        ) : (
          <div className="py-4 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Your quote appears here once we’ve analyzed the walkthrough.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon} {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
