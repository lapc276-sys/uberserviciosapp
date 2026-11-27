import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Hands-free recording, end to end, with the server as it runs by default:
 * no bucket, so the video stays on the phone and leaves as a ZIP.
 *
 * What it pins down is what cannot be seen on screen: that nothing is filmed
 * before the customer box is ticked, that a privacy pause cuts the film into
 * two independent pieces and says so in the log, and that the ZIP holds
 * exactly the bytes the phone hashed — the same unit the pipeline ingests
 * (pipeline/klaudy_pipeline/ingest.py).
 *
 * Needs the admin login (ADMIN_EMAIL / ADMIN_PASSWORD, from the environment
 * or .env.local); skipped without it.
 */

function adminLogin(): { email: string; password: string } | null {
  const env: Record<string, string | undefined> = { ...process.env };
  if ((!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) && existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^(ADMIN_EMAIL|ADMIN_PASSWORD)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env.ADMIN_EMAIL && env.ADMIN_PASSWORD ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } : null;
}

/** Reads a stored (uncompressed) ZIP the way any unzip does: through its central directory. */
function unzipStored(zip: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString();
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.set(name, zip.subarray(start, start + size));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

async function say(page: Page, text: string) {
  await page.evaluate((t) => (window as unknown as { __say: (t: string) => void }).__say(t), text);
}

test.use({ permissions: ['camera', 'microphone', 'accelerometer', 'gyroscope', 'magnetometer'] });

test('hands-free: consent first, a privacy pause splits the film, and the ZIP holds what the phone hashed', async ({ page }) => {
  test.setTimeout(120_000);
  const login = adminLogin();
  test.skip(!login, 'needs ADMIN_EMAIL and ADMIN_PASSWORD');

  // Speech recognition does not exist headless: a stand-in fed by __say().
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const live: { started?: boolean; onresult?: (e: unknown) => void; onend?: () => void }[] = [];
    w.SpeechRecognition = class {
      started = false;
      onresult?: (e: unknown) => void;
      onend?: () => void;
      constructor() {
        live.push(this);
      }
      start() {
        this.started = true;
      }
      stop() {
        this.started = false;
      }
      abort() {
        this.started = false;
      }
    };
    w.__say = (text: string) => {
      const r = live.filter((x) => x.started).pop();
      const result = Object.assign([{ transcript: text }], { isFinal: true });
      r?.onresult?.({ resultIndex: 0, results: [result] });
    };
  });
  page.on('dialog', (d) => d.accept());

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const analysisId = await page.evaluate(async ({ email, password }) => {
    const frames = Array.from({ length: 4 }, (_, i) => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      const g = c.getContext('2d')!;
      g.fillStyle = `hsl(${i * 70},60%,50%)`;
      g.fillRect(0, 0, 64, 48);
      return c.toDataURL('image/jpeg', 0.7);
    });
    const quote = await (await fetch('/api/vision/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames, serviceSlug: 'house-cleaning' }) })).json();
    await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return quote.id as string;
  }, login!);

  await page.goto(`/pilot/tiempo?analysis=${analysisId}`, { waitUntil: 'networkidle' });
  const other = page.getByRole('button', { name: /Cerrar ese y empezar este/ });
  if (await other.isVisible().catch(() => false)) await other.click();
  await expect(page.getByRole('heading', { name: 'Este trabajo' })).toBeVisible();

  // Nothing is filmed until the customer box is ticked.
  await page.getByRole('button', { name: /Manos libres/ }).click();
  const consent = page.getByTestId('hands-free-consent');
  const go = consent.getByRole('button', { name: /Acepto y activo|Activar manos libres/ });
  await expect(go).toBeDisabled();
  await consent.getByRole('checkbox').check();
  await go.click();

  await page.getByRole('button', { name: /Llegué/ }).click();
  await expect(page.getByText(/Grabando/)).toBeVisible({ timeout: 20_000 });
  await say(page, 'cocina');
  await expect(page.getByTestId('heard')).toContainText('Cocina');
  await page.waitForTimeout(3000);

  await page.getByTestId('privacy-pause').click();
  await expect(page.getByText('Cámara en pausa: no se graba nada')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId('privacy-pause').click();
  await expect(page.getByText(/Grabando/)).toBeVisible();
  await page.waitForTimeout(3000);

  await page.getByRole('button', { name: 'Me voy' }).click();
  await page.getByRole('button', { name: 'No, todo bien' }).click();
  await expect(page.getByText('Trabajo guardado')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('recording-summary')).toContainText('El video está en este teléfono');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Guardar el video en el teléfono/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzipStored(readFileSync((await download.path())!));
  const manifest = JSON.parse(files.get('manifest.json')!.toString()) as {
    format: string;
    pieces: { file: string; kind: string; sha256: string; bytes: number; monoStartMs: number; monoEndMs: number }[];
    events: { seq: number; kind: string }[];
  };
  expect(manifest.format).toBe('klaudy-recording/1');

  // Two films — before and after the pause — each its own complete file.
  const video = manifest.pieces.filter((p) => p.kind === 'video');
  expect(video.map((p) => p.file.replace(/\.(mp4|webm)$/, ''))).toEqual(['video/00001', 'video/00002']);
  expect(video[1].monoStartMs - video[0].monoEndMs).toBeGreaterThan(1000);
  for (const p of manifest.pieces) {
    const bytes = files.get(p.file)!;
    expect(bytes.length).toBe(p.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.sha256);
  }
  // The pause is in the log, so the hole is never mistaken for lost film.
  const kinds = manifest.events.map((e) => e.kind);
  expect(kinds).toEqual(expect.arrayContaining(['recorder_started', 'voice_marker', 'privacy_pause', 'privacy_resume']));
  expect(manifest.events.map((e) => e.seq)).toEqual([...manifest.events.map((e) => e.seq)].sort((a, b) => a - b));

  // Freed once saved.
  await page.getByRole('button', { name: 'Liberar espacio' }).click();
  await expect(page.getByTestId('recording-summary')).toContainText('espacio liberado');
});
