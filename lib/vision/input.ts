/**
 * Frame input validation, shared by the first-party route and the public API
 * so the two can't drift apart into different security postures.
 */

/**
 * Per-frame and whole-request ceilings.
 *
 * These are sized against the deployment target, not against what feels
 * generous. Serverless platforms cap a request body around 4.5MB, so a limit
 * of 20 frames at 1.2MB each described an API that could never actually be
 * used at its documented capacity: the caller would hit a platform error we
 * neither raise nor can explain. Rejecting it ourselves, with a message that
 * says what to do, is the difference between a bug report and a fix.
 *
 * A 768px-edge JPEG at quality 0.72 — what lib/vision/frames.ts produces — is
 * roughly 60–120KB, so ~160KB of base64. 400KB per frame is generous for that,
 * and 4MB total leaves room for the rest of the envelope.
 */
export const MAX_FRAME_CHARS = 400_000;
export const MAX_TOTAL_CHARS = 4_000_000;

const ALLOWED_PREFIXES = ['data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,'];

/**
 * Hostnames that only ever mean "somewhere inside the perimeter".
 *
 * The cloud metadata endpoints are the reason this list exists: they hand out
 * instance credentials to anything that can make an HTTP request from inside,
 * which makes them the standard target for server-side request forgery.
 */
const BLOCKED_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata',
]);

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/** Matches a bare IPv4 literal; hex/octal/decimal forms are caught separately. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Accepts an https URL only when it clearly points at the public internet.
 *
 * The frames a caller sends are handed to a vision backend that fetches them.
 * Today that backend is a hosted provider, so the fetch happens on their
 * infrastructure — but the analyzer interface exists precisely so it can be
 * swapped for a self-hosted one later, and on that day an unvalidated URL
 * becomes a request originating inside our own network. Validating now costs
 * nothing; validating after the swap means remembering to.
 *
 * IP literals are refused outright rather than range-checked. Legitimate
 * frame URLs come from a CDN with a hostname, and range-checking invites a
 * long tail of encodings — octal, hex, IPv6-mapped, integer — each of which
 * is a bypass waiting to be found.
 */
function isSafeRemoteUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  // Credentials in a URL are never right here and confuse downstream fetchers.
  if (url.username || url.password) return false;
  // A non-standard port is a strong signal of an internal service.
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(host)) return false;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
  // Bracketed IPv6, or any host with a colon.
  if (host.includes(':') || host.startsWith('[')) return false;
  if (IPV4.test(host)) return false;
  // A public host is always dotted; a bare label is internal DNS.
  if (!host.includes('.')) return false;
  // Purely numeric hosts are integer-encoded IPs (https://2130706433/).
  if (/^\d+$/.test(host.replace(/\./g, ''))) return false;

  return true;
}

/**
 * Accepts inline images and public https URLs only.
 *
 * Note the residual risk this cannot close: a hostname that passes every check
 * here can still resolve to a private address, and the DNS answer is not ours
 * to inspect. That is only exploitable once something we control does the
 * fetching, and the mitigation then is to resolve and check at fetch time.
 */
export function framesAreSafe(frames: string[]): boolean {
  return validateFrames(frames) === null;
}

/**
 * Returns a caller-facing reason, or null when the frames are acceptable.
 *
 * Distinct messages matter more here than anywhere else in the API: the person
 * reading them is integrating against us for the first time, and "invalid
 * frames" for four different causes is what turns a five-minute fix into a
 * support thread.
 */
export function validateFrames(frames: string[]): string | null {
  let total = 0;

  for (const f of frames) {
    total += f.length;

    if (f.length > MAX_FRAME_CHARS) {
      return `Each frame must be under ${Math.round(MAX_FRAME_CHARS / 1000)}KB. Downscale to 768px on the long edge and re-encode as JPEG at ~0.7 quality.`;
    }

    if (ALLOWED_PREFIXES.some((p) => f.startsWith(p))) continue;

    if (!f.startsWith('https://')) {
      return 'Frames must be JPEG, PNG or WebP images, sent inline as data: URIs or as public https URLs.';
    }

    if (!isSafeRemoteUrl(f)) {
      return 'That https URL was rejected. Frame URLs must point at a public hostname on port 443 — raw IP addresses, private or internal hosts, non-standard ports and embedded credentials are not accepted.';
    }
  }

  if (total > MAX_TOTAL_CHARS) {
    return `The whole request must stay under ${Math.round(MAX_TOTAL_CHARS / 1_000_000)}MB. Send fewer frames, or host them and pass https URLs instead.`;
  }

  return null;
}

/**
 * The most frames one request may carry.
 *
 * Set by the guided walkthrough, which plans a fixed number of deliberate
 * shots and encodes each to `MAX_TOTAL_CHARS / frameCount`. More frames than
 * this means each one is compressed past the point where grout, film on a
 * countertop, or the inside of an oven is still legible — and an unreadable
 * frame costs a model call without improving the estimate.
 */
export const MAX_FRAMES = 24;

/** Long enough for "[bathroom-2] bathroom — Ducha o bañera (Baño 2)". */
export const MAX_CAPTION_CHARS = 160;

/**
 * Checks the per-frame captions a guided walkthrough sends.
 *
 * Captions are positional — caption `i` describes frame `i` — so a mismatched
 * length is not a cosmetic problem: it silently relabels every frame after the
 * gap, and the model is explicitly told to trust captions over the pixels.
 * Rejecting is the only safe answer.
 */
export function validateCaptions(frames: string[], captions?: string[]): string | null {
  if (!captions) return null;
  if (captions.length !== frames.length) {
    return 'When captions are sent there must be exactly one per frame, in the same order.';
  }
  if (captions.some((c) => c.length > MAX_CAPTION_CHARS)) {
    return `Each caption must be under ${MAX_CAPTION_CHARS} characters.`;
  }
  return null;
}

/** Generic fallback for callers that don't surface the specific reason. */
export const FRAME_ERROR =
  'Frames must be JPEG, PNG or WebP images, sent inline or as public https URLs, ' +
  'each under 400KB and under 4MB in total.';
