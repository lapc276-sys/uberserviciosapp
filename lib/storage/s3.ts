import { createHash, createHmac } from 'node:crypto';

/**
 * Presigned uploads to any S3-compatible bucket — Cloudflare R2, AWS S3,
 * Backblaze B2 — without an SDK.
 *
 * The phone uploads video straight to the bucket with a URL this signs; the
 * bytes never pass through the app server. That matters on Replit: a job's
 * video is hundreds of megabytes, and pushing it through the web container
 * would cost bandwidth, time and the request-size limits that already shape
 * how frames are sent (lib/vision/frames.ts).
 *
 * Off without its four variables, like every integration here: recording
 * still works, and the video stays on the phone.
 *
 * Signature Version 4, query-string form, as documented by AWS; tested
 * against AWS's own published example in tests/recordings.test.ts.
 */

export interface StorageConfig {
  /** e.g. https://<account>.r2.cloudflarestorage.com — no bucket, no slash. */
  endpoint: string;
  bucket: string;
  /** "auto" for R2. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function storageConfig(env: Record<string, string | undefined> = process.env): StorageConfig | null {
  const endpoint = env.STORAGE_S3_ENDPOINT?.trim().replace(/\/+$/, '');
  const bucket = env.STORAGE_S3_BUCKET?.trim();
  const accessKeyId = env.STORAGE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.STORAGE_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (!/^https:\/\//.test(endpoint)) return null;
  return { endpoint, bucket, region: env.STORAGE_S3_REGION?.trim() || 'auto', accessKeyId, secretAccessKey };
}

export function isStorageConfigured(): boolean {
  return storageConfig() !== null;
}

/** RFC 3986 encoding, as SigV4 requires — stricter than encodeURIComponent. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(at: Date): { stamp: string; day: string } {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, day: stamp.slice(0, 8) };
}

/**
 * The low-level signer: one URL for one method, host and path. Only the host
 * header is signed, so the uploader may send any Content-Type.
 */
export function presign({
  method,
  host,
  path,
  region,
  accessKeyId,
  secretAccessKey,
  expiresSeconds,
  now = new Date(),
}: {
  method: 'GET' | 'PUT';
  host: string;
  /** Already starting with "/", segments not yet encoded. */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  now?: Date;
}): string {
  const { stamp, day } = amzDate(now);
  const scope = `${day}/${region}/s3/aws4_request`;
  const canonicalPath = path
    .split('/')
    .map((segment) => encode(segment))
    .join('/');

  const query: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = query
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .sort()
    .join('&');

  const canonicalRequest = [method, canonicalPath, canonicalQuery, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex');

  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** A URL the phone can PUT one object to, valid for `expiresSeconds`. */
export function uploadUrl(key: string, config: StorageConfig, expiresSeconds = 900, now = new Date()): string {
  const url = new URL(config.endpoint);
  // Path-style (endpoint/bucket/key): what R2 documents, and what works
  // without per-bucket DNS.
  return presign({
    method: 'PUT',
    host: url.host,
    path: `${url.pathname.replace(/\/+$/, '')}/${config.bucket}/${key}`,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds,
    now,
  });
}
