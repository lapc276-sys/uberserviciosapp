'use client';

import { useState } from 'react';
import { Check, X, AlertTriangle, Loader2, Video } from 'lucide-react';
import { extractFrames, UnsupportedVideoError } from '@/lib/vision/frames';

/**
 * Thirty-second device readiness check.
 *
 * The pilot runs on whatever phone the person in the field owns, and the ways
 * a phone fails are not obvious from the outside — a browser that can't decode
 * HEVC, a browser with no speech engine. Finding that out mid-job, in someone
 * else's kitchen, is the expensive way. Finding it out here is free.
 *
 * The capability probes are informative; the real verdict comes from actually
 * pulling frames out of a video this phone recorded, because that is the only
 * test that exercises the same path the job will.
 */

type Status = 'pass' | 'warn' | 'fail';

interface Row {
  label: string;
  status: Status;
  detail: string;
}

const ICON: Record<Status, React.ReactNode> = {
  pass: <Check className="h-4 w-4 text-emerald-600" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  fail: <X className="h-4 w-4 text-red-600" />,
};

function probe(): Row[] {
  const rows: Row[] = [];
  const ua = navigator.userAgent;

  const isSamsungInternet = /SamsungBrowser/i.test(ua);
  const isChrome = /Chrome/i.test(ua) && !isSamsungInternet;
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|SamsungBrowser/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  rows.push({
    label: 'Browser',
    status: isSamsungInternet ? 'warn' : 'pass',
    detail: isSamsungInternet
      ? 'Samsung Internet — voice control does not work here. Open this page in Chrome instead.'
      : isChrome
        ? 'Chrome'
        : isSafari
          ? 'Safari'
          : 'Recognised',
  });

  const video = document.createElement('video');
  const h264 = video.canPlayType('video/mp4; codecs="avc1.42E01E"');
  const hevc = video.canPlayType('video/mp4; codecs="hvc1"') || video.canPlayType('video/mp4; codecs="hev1"');

  // `canPlayType` is a hint, never a verdict. It returns "", "maybe" or
  // "probably", and browsers that decode a format perfectly well still answer
  // "" for it. Reporting a bare "" as "this phone cannot run the pilot" would
  // stop someone whose phone works fine, so these stay advisory and step 2
  // below is what actually decides.
  rows.push({
    label: 'H.264 video (standard)',
    status: h264 ? 'pass' : 'warn',
    detail: h264
      ? 'Reports support — this is the format we want'
      : 'This browser reports no H.264 support. That is often wrong, so run the video test below before believing it.',
  });

  rows.push({
    label: 'HEVC / H.265 video',
    status: hevc ? 'pass' : 'warn',
    detail: hevc
      ? 'Reports support'
      : isIOS
        ? 'Not reported. Set Settings → Camera → Formats → "Most Compatible" before recording.'
        : 'Not reported. If your camera records HEVC, turn that off in the Camera app settings.',
  });

  const hasSpeech =
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  rows.push({
    label: 'Voice control',
    status: hasSpeech ? 'pass' : 'warn',
    detail: hasSpeech
      ? 'Available — you can correct scores hands-free'
      : isAndroid
        ? 'Not available. Use Chrome on Android.'
        : 'Not available. The sliders still work.',
  });

  rows.push({
    label: 'Camera access',
    status: typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'pass' : 'warn',
    detail:
      typeof navigator.mediaDevices?.getUserMedia === 'function'
        ? 'Available'
        : 'Not detected — recording through the Camera app and picking the file still works.',
  });

  rows.push({
    label: 'Vibration feedback',
    status: 'vibrate' in navigator ? 'pass' : 'warn',
    detail: 'vibrate' in navigator ? 'Available' : 'Not available — voice commands confirm on screen instead.',
  });

  return rows;
}

export function DeviceCheck() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: Status; message: string; frames?: string[] } | null>(null);

  async function runVideoTest(file: File) {
    setBusy(true);
    setResult(null);
    const started = Date.now();

    try {
      const frames = await extractFrames(file, { frameCount: 4 });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      setResult({
        status: frames.length === 4 ? 'pass' : 'warn',
        message:
          frames.length === 4
            ? `Read all 4 frames in ${seconds}s from a ${(file.size / 1_000_000).toFixed(1)} MB file. This phone is ready.`
            : `Only ${frames.length} of 4 frames could be read. It will work, but the estimate will be less confident.`,
        frames,
      });
    } catch (err) {
      setResult({
        status: 'fail',
        message: err instanceof UnsupportedVideoError ? err.message : 'That video could not be read.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-white p-5 dark:bg-white/[0.03]">
        <h2 className="font-semibold">1. What this phone reports</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          What the browser claims it can do. Treat it as a hint — step&nbsp;2 is the one that decides.
        </p>
        {rows === null ? (
          <button
            type="button"
            onClick={() => setRows(probe())}
            className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
          >
            Check this phone
          </button>
        ) : (
          <ul className="mt-3 divide-y">
            {rows.map((r) => (
              <li key={r.label} className="flex gap-3 py-3">
                <span className="mt-0.5 shrink-0">{ICON[r.status]}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{r.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5 dark:bg-white/[0.03]">
        <h2 className="font-semibold">2. The real test</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Record about 10 seconds of any room and pick it here. This runs the exact same code the job will,
          so if it passes here it will work on a real property — <strong>even if step 1 showed warnings</strong>.
        </p>

        <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-sm font-medium">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Video className="h-5 w-5" />}
          {busy ? 'Reading the video…' : 'Record or choose a video'}
          <input
            type="file"
            accept="video/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) runVideoTest(file);
              e.target.value = '';
            }}
          />
        </label>

        {result && (
          <div
            className={`mt-4 rounded-xl p-4 text-sm ${
              result.status === 'pass'
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                : result.status === 'warn'
                  ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{ICON[result.status]}</span>
              <p>{result.message}</p>
            </div>

            {result.frames && result.frames.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {result.frames.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`Frame ${i + 1}`} className="aspect-square rounded-lg object-cover" />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
