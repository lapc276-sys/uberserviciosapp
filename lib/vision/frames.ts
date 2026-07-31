/**
 * Client-side frame extraction.
 *
 * Sampling frames in the browser and uploading only those images avoids
 * shipping a multi-hundred-megabyte video to the server, avoids ffmpeg in a
 * serverless runtime entirely, and gives the customer instant feedback. The
 * model only ever needs stills.
 */

export const DEFAULT_FRAME_COUNT = 8;
const MAX_EDGE_PX = 768;
const JPEG_QUALITY = 0.72;

export interface ExtractOptions {
  frameCount?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Draws one frame at `time` seconds and returns it as a JPEG data URL. */
function captureAt(video: HTMLVideoElement, canvas: HTMLCanvasElement, time: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      const scale = Math.min(1, MAX_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not read that point in the video'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = time;
  });
}

export async function extractFrames(file: File, options: ExtractOptions = {}): Promise<string[]> {
  const { frameCount = DEFAULT_FRAME_COUNT, onProgress, signal } = options;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => resolve();
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('error', () => reject(new Error('That file could not be read as a video.')), {
        once: true,
      });
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration === 0) throw new Error('That video has no readable duration.');

    const canvas = document.createElement('canvas');
    const frames: string[] = [];

    // Sample evenly, skipping the very first and last moments where the camera
    // is usually still moving or pointed at the floor.
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new Error('Cancelled');
      const t = duration * ((i + 0.5) / frameCount);
      frames.push(await captureAt(video, canvas, Math.min(t, Math.max(0, duration - 0.05))));
      onProgress?.(i + 1, frameCount);
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
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

/**
 * Mean luminance of a JPEG data URL, 0–255.
 *
 * Run in the browser before uploading: a frame too dark to read is worth
 * catching while the customer is still standing in the room and can turn a
 * light on. Sending it costs money and comes back as a confidently clean
 * reading, because a vision model asked to grade a shadow reports what it can
 * see rather than admitting it cannot see.
 *
 * Samples a grid rather than every pixel — a hundredth of the work for an
 * answer that only needs to be roughly right.
 */
export async function frameBrightness(dataUrl: string): Promise<number> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not read that frame.'));
  });

  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 255;

  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma: the eye weights green far above blue, and an unweighted
    // average calls a dim green-lit room brighter than it looks.
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return total / (data.length / 4);
}

/** Brightness across a set of frames, and whether the room needs more light. */
export async function assessFrames(
  dataUrls: string[],
  darkThreshold = 62,
): Promise<{ meanBrightness: number; tooDark: boolean; darkShare: number }> {
  if (dataUrls.length === 0) return { meanBrightness: 0, tooDark: true, darkShare: 1 };

  const values = await Promise.all(dataUrls.map((url) => frameBrightness(url).catch(() => 255)));
  const meanBrightness = values.reduce((a, b) => a + b, 0) / values.length;
  const darkFrames = values.filter((v) => v < darkThreshold).length;
  const darkShare = darkFrames / values.length;

  // One dark frame in a bright sweep is a shadowed corner, not a dark room.
  // Half of them is a room that needs a light switch.
  return { meanBrightness, tooDark: darkShare >= 0.5, darkShare };
}
