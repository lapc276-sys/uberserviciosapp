/**
 * Client-side frame extraction.
 *
 * Sampling frames in the browser and uploading only those images avoids
 * shipping a multi-hundred-megabyte video to the server, avoids ffmpeg in a
 * serverless runtime entirely, and gives the customer instant feedback. The
 * model only ever needs stills.
 *
 * Everything here has to survive whatever phone the person in the field
 * happens to own, which is the hard part: browsers disagree about codecs,
 * Android frequently reports a video's duration as Infinity, and a seek that
 * never completes will hang forever unless it is given a deadline. Each of
 * those is handled explicitly below rather than left to fail as "something
 * went wrong", because a cleaner standing in a stranger's kitchen cannot
 * debug a silent failure.
 */

export const DEFAULT_FRAME_COUNT = 8;

/**
 * Sized to what the model actually looks at, not to what the camera can give.
 *
 * The analyzer sends every frame with `detail: 'low'`, and low detail is a
 * fixed 512×512 representation — the provider downsamples anything larger
 * before the model sees a pixel of it. Encoding at 768 was therefore paying
 * upload bandwidth, and a hosting proxy's body limit, for detail that was
 * discarded on arrival.
 *
 * This is coupled to that setting on purpose: if the analyzer ever moves to
 * `detail: 'high'`, raise this with it, or the model starts working from a
 * genuinely worse image.
 */
export const MAX_EDGE_PX = 512;
const JPEG_QUALITY = 0.72;

/**
 * The client must never produce a frame the API will refuse.
 *
 * Encoding at a fixed quality does not bound the output: a cluttered, heavily
 * textured room — exactly the kind we most want photographed — compresses far
 * worse than an empty one, and the same settings that yield 11KB for a plain
 * wall can yield several hundred for a full shelf. Since the server enforces
 * a per-frame and a whole-request ceiling, the encoder has to target a budget
 * rather than a quality, or a customer's dirtiest property becomes the one
 * that fails to upload.
 */
export const FRAME_BUDGET_CHARS = 380_000;

/**
 * Well under the 4MB the API accepts, on purpose.
 *
 * The API limit describes what our route will parse. It says nothing about
 * what the hosting platform in front of it will forward, and that layer
 * rejects an oversized body without ever reaching our code — the browser gets
 * an empty response and an error that names neither the size nor the fix.
 *
 * Two different platforms are in play (Vercel's ~4.5MB, Replit's own proxy),
 * so the client aims at a figure comfortably below the lower plausible bound
 * rather than at whichever ceiling is nearest. An eighteen-frame walkthrough
 * lands near 1.4MB at this budget.
 */
export const TOTAL_BUDGET_CHARS = 2_000_000;
const QUALITY_LADDER = [JPEG_QUALITY, 0.6, 0.5, 0.4, 0.3];

/** A seek that hasn't landed in this long is not going to. */
const SEEK_TIMEOUT_MS = 8000;
/** Metadata should arrive quickly; a long stall means the file is unreadable. */
const LOAD_TIMEOUT_MS = 20000;

export class UnsupportedVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedVideoError';
  }
}

/**
 * Recorded in a format this browser cannot decode.
 *
 * In practice this is almost always an iPhone left on "High Efficiency",
 * which records HEVC/H.265. Safari decodes it; most other browsers do not, so
 * the same file works when the owner tests it and fails for everyone else.
 */
export const CODEC_HELP =
  'This phone recorded the video in a format this browser can’t open. ' +
  'On iPhone: Settings → Camera → Formats → "Most Compatible". ' +
  'On Android: open the Camera app settings and turn off HEVC / "high efficiency" video. ' +
  'Then record again.';

export interface ExtractOptions {
  frameCount?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function once(el: HTMLVideoElement, events: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      for (const e of events) el.removeEventListener(e, onEvent);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onEvent = (ev: Event) => {
      cleanup();
      resolve(ev.type);
    };
    const onError = () => {
      cleanup();
      reject(new UnsupportedVideoError(CODEC_HELP));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);

    for (const e of events) el.addEventListener(e, onEvent);
    el.addEventListener('error', onError);
  });
}

/**
 * Gets a usable duration, working around the Android bug where a
 * camera-recorded MP4 reports `Infinity` until it has been seeked.
 *
 * The fix is the documented one: seek far past any real end, which forces the
 * browser to resolve the actual duration, then rewind.
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  try {
    video.currentTime = 1e101;
    await once(video, ['durationchange', 'timeupdate', 'seeked'], SEEK_TIMEOUT_MS);
  } catch {
    // Fall through — the duration check below produces the useful message.
  }

  if (Number.isFinite(video.duration) && video.duration > 0) {
    try {
      video.currentTime = 0;
      await once(video, ['seeked', 'timeupdate'], SEEK_TIMEOUT_MS);
    } catch {
      // A failed rewind is harmless; sampling starts from wherever we are.
    }
    return video.duration;
  }

  return 0;
}

/**
 * Encodes whatever is currently on a canvas into a JPEG data URL that fits
 * `budget`, stepping down quality and then resolution until it does.
 *
 * Shared by both capture paths — sampling a file and sampling a live camera —
 * so a frame produced either way lands under the same server limit. Two
 * encoders would drift, and the one that drifted would only fail in the field.
 */
export function encodeToBudget(
  canvas: HTMLCanvasElement,
  draw: (ctx: CanvasRenderingContext2D, edge: number) => void,
  budget: number,
): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  let edge = MAX_EDGE_PX;
  let best = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    draw(ctx, edge);
    for (const quality of QUALITY_LADDER) {
      best = canvas.toDataURL('image/jpeg', quality);
      if (best.length <= budget) return best;
    }
    edge = Math.round(edge * 0.75);
  }
  return best;
}

/**
 * Draws one frame at `time` seconds and returns it as a JPEG data URL sized to
 * fit `budget`, dropping quality and then resolution until it does.
 */
async function captureAt(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  time: number,
  budget: number,
): Promise<string> {
  video.currentTime = time;
  await once(video, ['seeked'], SEEK_TIMEOUT_MS);
  return encodeToBudget(
    canvas,
    (ctx, edge) => {
      const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    },
    budget,
  );
}

export async function extractFrames(file: File, options: ExtractOptions = {}): Promise<string[]> {
  const { frameCount = DEFAULT_FRAME_COUNT, onProgress, signal } = options;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  // Some Android builds refuse to decode for an element that was never in the
  // document, so it is attached offscreen rather than left detached.
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  video.src = url;

  try {
    document.body.appendChild(video);

    try {
      await once(video, ['loadeddata', 'loadedmetadata'], LOAD_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof UnsupportedVideoError) throw err;
      throw new UnsupportedVideoError(CODEC_HELP);
    }

    // A decoded video always has pixel dimensions. Zero means the container
    // was parsed but the codec inside it isn't supported — the HEVC case.
    if (!video.videoWidth || !video.videoHeight) {
      throw new UnsupportedVideoError(CODEC_HELP);
    }

    const duration = await resolveDuration(video);
    if (duration === 0) {
      throw new UnsupportedVideoError(
        'The length of that video couldn’t be read. Try recording a new clip of at least 10 seconds.',
      );
    }

    const canvas = document.createElement('canvas');
    const frames: string[] = [];
    let failures = 0;

    // Share the request budget across however many frames were asked for, so
    // twelve frames can't individually pass and collectively fail.
    const budget = Math.min(FRAME_BUDGET_CHARS, Math.floor(TOTAL_BUDGET_CHARS / Math.max(1, frameCount)));

    // Sample evenly, skipping the very first and last moments where the camera
    // is usually still moving or pointed at the floor.
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new Error('Cancelled');
      const t = duration * ((i + 0.5) / frameCount);

      try {
        frames.push(await captureAt(video, canvas, Math.min(t, Math.max(0, duration - 0.05)), budget));
      } catch (err) {
        if (err instanceof UnsupportedVideoError) throw err;
        // One bad seek shouldn't throw away a walkthrough that is otherwise
        // fine — the estimate degrades gracefully with fewer frames, and a
        // pro who has already left the property cannot reshoot it.
        failures += 1;
        if (failures > frameCount / 2) break;
      }
      onProgress?.(frames.length, frameCount);
    }

    if (frames.length === 0) {
      throw new UnsupportedVideoError(
        'No frames could be read from that video. Recording a fresh clip in the Camera app usually fixes it.',
      );
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

/**
 * A small copy of each frame, for the training archive.
 *
 * Made here rather than on the server because the browser has already decoded
 * the image and has a canvas; doing it again server-side would mean an image
 * library inside a serverless runtime to redo work that was free on the phone.
 *
 * The size is chosen to keep what a model can learn from — grease sheen,
 * clutter density, the texture of a dirty grout line — while dropping what a
 * person could read: a letter on a counter, a face across a room, a screen.
 * That is a reduction in identifiability, not anonymisation, and the storage
 * layer treats it as personal data regardless.
 */
export function thumbnailsFor(frames: string[], edge: number): Promise<string[]> {
  return Promise.all(
    frames.map(
      (src) =>
        new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, edge / Math.max(img.width, img.height));
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve('');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
          };
          // A frame that won't reload is not worth failing an estimate over.
          img.onerror = () => resolve('');
          img.src = src;
        }),
    ),
  ).then((list) => list.filter(Boolean));
}

/** Reads still photos (fallback path when someone uploads images instead). */
export function readImages(files: File[]): Promise<string[]> {
  return Promise.all(
    files.slice(0, 12).map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read that image.'));
          reader.readAsDataURL(file);
        }),
    ),
  );
}
