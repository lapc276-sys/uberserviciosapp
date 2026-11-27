import { test, expect, type Page } from '@playwright/test';

/**
 * "Ya vi el microondas" — said in a car.
 *
 * The scout is stubbed, so these do not test whether the model recognises a
 * car (that is the prompt's job, lib/vision/scout.ts). They test what the
 * walkthrough does with the answer: that a room which is not there can be
 * dropped and then never reaches the price, that it can be re-filmed, that
 * something the customer points at reaches the analysis captioned as such,
 * and that a demo price or a "not a home" answer is said plainly on the page.
 */

type Body = { roomType: string; pointed?: boolean };

async function stubScout(page: Page, reply: (body: Body, call: number) => unknown): Promise<() => Body[]> {
  const calls: Body[] = [];
  await page.route('**/api/vision/scout', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Body;
    calls.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply(body, calls.length)) });
  });
  return () => calls;
}

const SILENT = { questions: [], objects: [], clutter: 0, remark: null, scouted: true };

async function stubAnalyze(page: Page, response: { status: number; body: unknown }): Promise<() => Record<string, any> | null> {
  let seen: Record<string, any> | null = null;
  await page.route('**/api/vision/analyze', async (route) => {
    seen = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  return () => seen;
}

const PRICED = {
  status: 200,
  body: {
    id: 'test',
    analysis: { rooms: [], totalMinutes: 90, recommendedPros: 1, suppliesNeeded: [], condition: 'fair', confidence: 0.5, source: 'heuristic', warnings: [] },
    quote: { currency: 'USD', low: 100, high: 140 },
  },
};

async function openWalk(page: Page, remove: string[]) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Usa la cámara|Use your camera/ }).click();
  await expect(page.getByText('¿Qué espacios vamos a ver?')).toBeVisible();
  for (const label of remove) await page.getByRole('button', { name: `Quitar ${label}` }).click();
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();
}

/** Presses "Tomar ya" until `until` shows up. */
async function shootUntil(page: Page, until: ReturnType<Page['getByText']>, what: string) {
  const deadline = Date.now() + 200_000;
  while (!(await until.isVisible().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`${what} never appeared`);
    const shoot = page.getByRole('button', { name: /Tomar ya|Repetir esta/ });
    if (await shoot.isVisible().catch(() => false)) await shoot.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function finishWalk(page: Page) {
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByText('Ya casi está')).toBeVisible();
  await page.getByRole('button', { name: /^Seguir/ }).click();
  await page.getByRole('button', { name: /A fondo/ }).click();
}

test('a kitchen that is not there is dropped, and never reaches the price', async ({ page }) => {
  test.setTimeout(240_000);
  await stubScout(page, (body) => (body.roomType === 'kitchen' ? { ...SILENT, mismatch: { saw: 'none' } } : SILENT));
  const payload = await stubAnalyze(page, PRICED);
  await openWalk(page, ['Sala']);

  // Leaving the kitchen: the card says what it looked like, instead of
  // questions about a microwave.
  const card = page.getByTestId('room-mismatch');
  await shootUntil(page, card, 'the mismatch card');
  await expect(card).toContainText('Esto parece estar fuera de una casa');
  await expect(card).toContainText('Buscaba la cocina');
  await card.getByRole('button', { name: 'Quitar cocina' }).click();

  // On to the bathroom, and to the end.
  await shootUntil(page, page.getByText('¿Está todo?'), 'the review');
  // Dropped means gone: no kitchen photos, and no kitchen listed as skipped.
  await expect(page.getByText(/Te saltaste/)).toHaveCount(0);
  await finishWalk(page);

  await expect.poll(() => payload()?.captions?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  const captions = payload()!.captions as string[];
  expect(captions.some((c) => c.startsWith('[kitchen-1]'))).toBe(false);
  expect(captions.every((c) => c.startsWith('[bathroom-1]'))).toBe(true);

  // A price from the stand-in says so, in words.
  await expect(page.getByTestId('demo-quote')).toContainText('Demostración');
});

test('a kitchen filmed from the wrong place can be filmed again', async ({ page }) => {
  test.setTimeout(240_000);
  // Wrong the first time, right the second.
  const calls = await stubScout(page, (body, n) =>
    body.roomType === 'kitchen' && n === 1 ? { ...SILENT, mismatch: { saw: 'office' } } : SILENT,
  );
  const payload = await stubAnalyze(page, PRICED);
  await openWalk(page, ['Baño', 'Sala']);

  const card = page.getByTestId('room-mismatch');
  await shootUntil(page, card, 'the mismatch card');
  await expect(card).toContainText('Esto parece una oficina');
  await card.getByRole('button', { name: 'Repetir cocina' }).click();

  // Back at the kitchen's first step, filming it again.
  await expect(page.getByText(/Cocina · 1 de/)).toBeVisible();
  await shootUntil(page, page.getByText('¿Está todo?'), 'the review');
  expect(calls().filter((c) => c.roomType === 'kitchen' && !c.pointed).length).toBe(2);
  await expect(page.getByTestId('late-mismatch')).toHaveCount(0);

  await finishWalk(page);
  await expect.poll(() => payload()?.captions?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((payload()!.captions as string[]).every((c) => c.startsWith('[kitchen-1]'))).toBe(true);
});

test('something the customer points at is named back and reaches the analysis', async ({ page }) => {
  test.setTimeout(240_000);
  const calls = await stubScout(page, (body) =>
    body.pointed ? { ...SILENT, found: [{ name: 'washing machine', label: 'la lavadora' }] } : SILENT,
  );
  // And the analysis answers that this was not a home at all.
  const payload = await stubAnalyze(page, { status: 422, body: { reason: 'no_home', error: 'not a home' } });
  await openWalk(page, ['Baño', 'Sala']);
  await shootUntil(page, page.getByText('¿Está todo?'), 'the review');

  await page.getByRole('button', { name: /¿Me salté algo\? Enséñamelo/ }).click();
  await expect(page.getByText('¿En qué espacio está?')).toBeVisible();
  await page.getByRole('button', { name: 'Cocina', exact: true }).click();

  // One step, then straight back to the review.
  await expect(page.getByText('Apunta a lo que me faltó y quédate quieto.')).toBeVisible();
  await shootUntil(page, page.getByText('¿Está todo?'), 'the review after pointing');
  await expect(page.getByTestId('pointed-result')).toHaveText('Señalado: la lavadora');
  expect(calls().filter((c) => c.pointed).map((c) => c.roomType)).toEqual(['kitchen']);

  await finishWalk(page);
  await expect.poll(() => payload()?.captions?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(payload()!.captions).toContain('[kitchen-1] kitchen — Algo que faltaba, señalado por el cliente (Cocina)');

  // "Not a home" is said where the camera was, in Spanish — not swallowed.
  await expect(page.getByTestId('camera-error')).toContainText('no vi el interior de una casa');
});
