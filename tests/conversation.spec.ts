import { test, expect, type Page } from '@playwright/test';

/**
 * The talking parts of the walkthrough, end to end, on the customer's page.
 *
 * What is under test is what reaches the company: a yes to the oven has to
 * reach the price, a yes to "¿te contactamos para arreglarlo?" has to reach
 * the message, and the closing chat — day, products, vacuum — has to arrive
 * with the lead instead of costing a phone call. Each of those is a place
 * where an answer can be asked for, shown as recorded, and then silently
 * dropped on the way out, which is exactly what happened to the room answers
 * on the hosted page.
 *
 * The scout is stubbed with one broken cabinet and one oven, so the questions
 * do not depend on a model; the analyzer is stubbed so the price does not.
 */

const REMARK = 'La cocina está bastante bien. Lo que más trabajo va a dar es la campana, que tiene grasa; ahí vamos a poner énfasis.';

const SCOUT = {
  remark: REMARK,
  questions: [
    {
      id: 'kitchen:repair',
      kind: 'repair',
      damage: ['cabinet'],
      roomType: 'kitchen',
      prompt: 'Veo un gabinete o un cajón roto. ¿Quieres que te contactemos para arreglar eso también?',
      extraMinutes: 0,
      yes: 'surface',
    },
    {
      id: 'kitchen:oven',
      kind: 'depth',
      object: 'oven',
      roomType: 'kitchen',
      prompt: '¿Quieres que limpiemos el horno por dentro?',
      extraMinutes: 14,
      yes: 'deep',
    },
  ],
};

let scoutLang: string | undefined;

async function stubModel(page: Page): Promise<() => Record<string, any> | null> {
  let seen: Record<string, any> | null = null;
  await page.route('**/api/vision/scout', (route) => {
    scoutLang = JSON.parse(route.request().postData() ?? '{}').lang;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCOUT) });
  });
  await page.route('**/api/vision/analyze', async (route) => {
    seen = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test',
        analysis: {
          rooms: [], totalMinutes: 120, recommendedPros: 1, suppliesNeeded: [],
          condition: 'fair', confidence: 0.5, source: 'heuristic', warnings: [],
        },
        quote: { currency: 'USD', low: 100, high: 140, totalLow: 109, totalHigh: 152 },
      }),
    });
  });
  return () => seen;
}

test('answers in the rooms and the closing chat reach the price and the message', async ({ page }) => {
  test.setTimeout(240_000);
  const payload = await stubModel(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Usa la cámara|Use your camera/ }).click();
  await expect(page.getByText('¿Qué espacios vamos a ver?')).toBeVisible();

  // One kitchen, so the walk is short.
  for (const label of ['Baño', 'Sala']) {
    await page.getByRole('button', { name: `Quitar ${label}` }).click();
  }
  await page.getByRole('button', { name: /Empezar el recorrido/ }).click();

  // Shoot until the room's questions come up as the kitchen is left.
  const questions = page.getByText(/Antes de seguir/);
  const deadline = Date.now() + 200_000;
  while (!(await questions.isVisible().catch(() => false))) {
    if (Date.now() > deadline) throw new Error('the room questions never appeared');
    const shoot = page.getByRole('button', { name: /Tomar ya/ });
    if (await shoot.isVisible().catch(() => false)) await shoot.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // The room's remark is on the card — the bot says it before the first question.
  await expect(page.getByText(REMARK)).toBeVisible();
  // The scout was asked in the walkthrough's language.
  expect(scoutLang).toBe('es');

  // The repair question comes first, and neither is pre-answered.
  await expect(page.getByText(/gabinete o un cajón roto/)).toBeVisible();
  await expect(page.getByText(/horno por dentro/)).toBeVisible();
  await page.getByRole('button', { name: 'Sí', exact: true }).nth(0).click();
  await page.getByRole('button', { name: 'Sí', exact: true }).nth(1).click();
  await page.getByRole('button', { name: /^Seguir/ }).click();

  await expect(page.getByText('¿Está todo?')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();

  // The closing chat.
  await expect(page.getByText('Ya casi está')).toBeVisible();
  await page.getByRole('button', { name: 'Esta semana', exact: true }).click();
  await page.getByRole('button', { name: 'Por la mañana', exact: true }).click();
  await page.getByRole('button', { name: 'Ecológicos', exact: true }).click();
  await page.getByRole('button', { name: /Tengo, pueden usarlos/ }).click();
  await page.getByRole('button', { name: /^Seguir/ }).click();

  await expect(page.getByText('¿Qué tan a fondo lo quieres?')).toBeVisible();
  await page.getByRole('button', { name: /A fondo/ }).click();

  await expect.poll(() => payload()?.serviceSlug, { timeout: 20_000 }).toBe('deep-cleaning');
  const sent = payload()!;

  // The yes to the oven reaches the price; the yes to the cabinet does not —
  // a repair is a lead, never minutes.
  expect(sent.depthChoices).toEqual({ 'kitchen:oven': 'deep' });
  // "Ecológicos" reaches the crew plan.
  expect(sent.products).toBe('eco');

  // And everything said reaches the owner, when there is a WhatsApp to send to.
  // The booking button specifically — the page header has WhatsApp links too.
  const book = page.getByRole('link', { name: /Agendar por WhatsApp|Book on WhatsApp/ });
  if (await book.count()) {
    const message = decodeURIComponent((await book.getAttribute('href')) ?? '');
    expect(message).toContain('Cocina');
    expect(message).toContain('esta semana, por la mañana');
    expect(message).toContain('ecológicos');
    expect(message).toContain('gabinete o cajón roto (Cocina)');
    // The questionnaire's untouched defaults must not describe a filmed home.
    expect(message).not.toContain('1 hab y 1 baño');
  }
});
