import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presign, storageConfig, uploadUrl } from '../lib/storage/s3';

/**
 * The video upload signer. A wrong signature does not fail loudly here — it
 * fails on a cleaner's phone in a basement, as an upload that never lands,
 * with the video quietly kept nowhere. So it is pinned to AWS's own example.
 */

test("matches AWS's published presigned-URL example", () => {
  // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expiresSeconds: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(
    new URL(url).searchParams.get('X-Amz-Signature'),
    'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
});

test('off without its variables, and only over https', () => {
  assert.equal(storageConfig({}), null);
  const base = {
    STORAGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
    STORAGE_S3_BUCKET: 'jobs',
    STORAGE_S3_ACCESS_KEY_ID: 'id',
    STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
  };
  assert.equal(storageConfig({ ...base, STORAGE_S3_ENDPOINT: 'http://insecure.example' }), null);
  const config = storageConfig(base)!;
  assert.equal(config.region, 'auto');
  assert.equal(config.endpoint, 'https://acct.r2.cloudflarestorage.com');

  const url = new URL(uploadUrl('recordings/as_1/rec_1/00001.webm', config, 900, new Date('2026-11-25T12:00:00Z')));
  assert.equal(url.host, 'acct.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/jobs/recordings/as_1/rec_1/00001.webm');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.match(url.searchParams.get('X-Amz-Credential')!, /^id\/20261125\/auto\/s3\/aws4_request$/);
});
