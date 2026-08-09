/**
 * Frame input validation, shared by the first-party route and the public API
 * so the two can't drift apart into different security postures.
 */

/** ~1.2MB per frame ceiling; clients downscale before upload. */
export const MAX_FRAME_CHARS = 1_600_000;

const ALLOWED_PREFIXES = ['data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,'];

/**
 * Accepts inline images and https URLs only.
 *
 * The https case is what keeps this from being a server-side request forgery
 * hole: without the scheme check a caller could pass `file://` or an internal
 * address and have our server fetch it for them.
 */
export function framesAreSafe(frames: string[]): boolean {
  return frames.every(
    (f) => f.length <= MAX_FRAME_CHARS && (ALLOWED_PREFIXES.some((p) => f.startsWith(p)) || f.startsWith('https://')),
  );
}

export const FRAME_ERROR = 'Frames must be JPEG, PNG or WebP images, inline or as https URLs.';
