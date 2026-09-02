import { test, expect, type Page } from '@playwright/test';

/**
 * The guided walkthrough, driven through a real browser with a fake camera.
 *
 * Chromium can synthesise a getUserMedia stream, so the whole capture path —
 * permission, preview, sampling, encoding, upload — runs headless with no
 * hardware. That is the only way to check the things this flow gets wrong
 * quietly: a frame that never encodes, a step that never advances, a retake
 * that appends instead of replacing.
 *
 * The analyze endpoint is stubbed. What is under test is what the browser
 * SENDS, which is exactly the part a server test cannot see.
 */

interface Payload {
  frames: string[];
  captions?: string[];
  serviceSlug: string;
}

/** Stubs the analyzer and captures the request the page actually made. */
async function interceptAnalyze(page: Page): Promise<() => Payload | null> {
  let seen: Payload | null = null;

  await page.route('**/api/vision/analyze', async (route) => {
    seen = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test',
        analysis: {
          rooms: [], totalMinutes: 0, recommendedPros: 1, suppliesNeeded: [],
          condition: 'fair', confidence: 0.5, source: 'heuristic', warnings: [],
        },
        quote: { currency: 'USD', low: 100, high: 140 },
      }),
    });
  });

  return () => seen;
}

/** The step counter, e.g. "Cocina · 3 de 9" -> 3. */
async function currentStep(page: Page): Promise<number> {
  const text = await page.locator('p.uppercase').first().innerText();
  return Number(text.match(/(\d+)\s+de\s+\d+/i)?.[1] ?? 0);
}

/**
 * Shoots until the review screen appears.
 *
 * Deliberately not "click N times". A step also advances on its own nine-second
 * safety timeout, so a click count and a step count are not the same number
 * once the machine is loaded enough for clicks to be slow — which is exactly
 * what happens with several browser tests in flight. Driving to a state
 * instead of counting actions tests the flow rather than the wall clock.
 */
async function shootUntilReview(page: Page, { letPanFinish = false, deadlineMs = 200_000 } = {}) {
  const until = Date.now() + deadlineMs;

  // Step 1 of every space is a pan, which samples across a seven-second sweep
  // and keeps the most different frames. Pressing the shutter during one is a
  // deliberate override that takes a single shot instead — correct behaviour,
  // and fatal to any test that wants to see what a pan actually produces.
  if (letPanFinish) {
    await expect.poll(() => currentStep(page), { timeout: 30_000 }).toBeGreaterThan(1);
  }

  while (Date.now() < until) {
    if (await page.getByText('¿Está todo?').isVisible().catch(() => false)) return;
    const shoot = page.getByRole('button', { name: /Tomar ya/ });
    if (await shoot.isVisible().catch(() => false)) {
      await shoot.click({ timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(300);
  }
  throw new Error('never reached the review screen');
}

/** Reduces the plan to a single kitchen, so a test isn't a five-minute walk. */
async function kitchenOnly(page: Page) {
  for (const label of ['Baño', 'Sala']) {
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: `Quitar ${label}` }).click({ timeout: 2000 }).catch(() => {});
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/quote/video', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('¿Qué espacios vamos a ver?')).toBeVisible();
});

test('the walkthrough is offered before any file picker', async ({ page }) => {
  // The whole point of the guided flow: nobody is sent to their gallery. A
  // regression here is a silent return to "record, save, come back, find it".
  await expect(page.getByRole('button', { name: /Empezar el recorrido/ })).toBeVisible();
  await expect(page.getByText(/la cámara dispara sola/)).toBeVisible();
});

test('captures every step and sends one caption per frame', async ({ page }) => {
  const payload = await interceptAnalyze(page);
  await kitchenOnly(page);
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();

  await shootUntilReview(page, { letPanFinish: true });

  await expect(page.getByText('¿Está todo?')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect.poll(() => payload()?.frames.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);

  const sent = payload()!;

  // Captions are positional — caption i describes frame i — so a length
  // mismatch silently relabels every frame after the gap, and the prompt tells
  // the model to trust captions over the pixels.
  expect(sent.captions?.length).toBe(sent.frames.length);

  // Every caption carries the space id that tells the model these frames are
  // one room. Without it four angles of a bathroom read as two bathrooms.
  for (const caption of sent.captions!) expect(caption).toMatch(/^\[kitchen-1\]/);

  // The overview is a pan and must contribute more than one frame, or a sweep
  // across a kitchen has been reduced to one photo of one cupboard.
  const overview = sent.captions!.filter((c) => c.includes('Vista general'));
  expect(overview.length).toBeGreaterThan(1);
});

test('stays inside the upload budget', async ({ page }) => {
  const payload = await interceptAnalyze(page);
  await kitchenOnly(page);
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();

  await shootUntilReview(page);
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect.poll(() => payload()?.frames.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);

  const sent = payload()!;
  const total = sent.frames.reduce((sum, f) => sum + f.length, 0);
  const largest = Math.max(...sent.frames.map((f) => f.length));

  // The server rejects above these, and a hosting proxy rejects sooner and
  // more rudely — an empty response the browser cannot explain.
  expect(largest).toBeLessThan(400_000);
  expect(total).toBeLessThan(4_000_000);
});

test('goes back a step and discards what it caught', async ({ page }) => {
  await kitchenOnly(page);
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();

  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Tomar ya/ }).click();
    await page.waitForTimeout(400);
  }

  // Read where we actually are rather than assuming three clicks means step
  // four: the safety timeout advances steps too, and racing it would make this
  // test fail for a reason that has nothing to do with going back.
  const before = await currentStep(page);
  expect(before).toBeGreaterThan(1);

  // The control names the step it will redo — "Atrás" alone would leave
  // someone guessing whether they are about to lose the oven or the sink.
  const back = page.getByRole('button', { name: /Atrás — repetir/ });
  await expect(back).toBeVisible();
  await back.click();

  await expect.poll(() => currentStep(page)).toBe(before - 1);
});

test('retaking one frame replaces it instead of adding another', async ({ page }) => {
  await kitchenOnly(page);
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();

  await shootUntilReview(page);

  await expect(page.getByText('¿Está todo?')).toBeVisible();
  const before = await page.locator('button img').count();
  expect(before).toBeGreaterThan(3);

  await page.locator('button img').nth(2).click();
  await expect(page.getByRole('button', { name: /Repetir esta foto/ })).toBeVisible();
  await page.getByRole('button', { name: /Repetir esta foto/ }).click();

  await expect(page.getByText('¿Está todo?')).toBeVisible();
  // Appending instead of replacing would quietly double a step's frames and
  // push a long walkthrough over the upload budget.
  expect(await page.locator('button img').count()).toBe(before);
});

test('runs to the end with no button pressed at all', async ({ page }) => {
  test.setTimeout(240_000);
  const payload = await interceptAnalyze(page);
  await kitchenOnly(page);
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();

  // Nothing is clicked from here. With a synthetic camera the scene never
  // changes enough to trigger a settle, so this is the nine-second safety
  // timeout doing its job — which is the case worth protecting: someone who
  // holds the phone steady must never be stranded mid-kitchen.
  await expect(page.getByText('¿Está todo?')).toBeVisible({ timeout: 200_000 });
  expect(await page.locator('button img').count()).toBeGreaterThan(3);

  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect.poll(() => payload()?.frames.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
});
