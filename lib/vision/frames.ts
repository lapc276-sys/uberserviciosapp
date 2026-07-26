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
