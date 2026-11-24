import { test, expect } from '@playwright/test';

/**
 * The walkthrough on an English phone, and the language switch on a Spanish one.
 *
 * What can go wrong here is quiet: a screen that is half translated, a scout
 * asked in Spanish by an English walkthrough (so its questions come back in
 * Spanish), or a switch that changes the buttons and not the bot. None of
 * that throws; all of it tells a customer nobody checked.
 */

test.describe('on an English phone', () => {
  test.use({ locale: 'en-US' });

  test('the whole walkthrough speaks English, and asks the scout in English', async ({ page }) => {
    test.setTimeout(240_000);
    let scoutLang: string | undefined;
    let analyzed: Record<string, unknown> | null = null;

    await page.route('**/api/vision/scout', (route) => {
      scoutLang = JSON.parse(route.request().postData() ?? '{}').lang;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          remark: 'The kitchen looks really nice. Just a few small details on the microwave; we will pay attention there.',
          questions: [
            {
              id: 'kitchen:oven',
              kind: 'depth',
              object: 'oven',
              roomType: 'kitchen',
              prompt: 'Would you like us to clean the inside of the oven?',
              extraMinutes: 14,
              yes: 'deep',
            },
          ],
        }),
      });
    });
    await page.route('**/api/vision/analyze', async (route) => {
      analyzed = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test',
          analysis: {
            rooms: [], totalMinutes: 90, recommendedPros: 1, suppliesNeeded: [],
            condition: 'fair', confidence: 0.5, source: 'heuristic', warnings: [],
          },
          quote: { currency: 'USD', low: 100, high: 140 },
        }),
      });
    });

    await page.goto('/quote/video', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Which spaces are we looking at?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

    for (const label of ['Bathroom', 'Living room']) {
      await page.getByRole('button', { name: `Remove ${label}` }).click();
    }
    await page.getByRole('button', { name: /Start the walkthrough/ }).click();
    await expect(page.getByText(/Stand in the doorway and slowly sweep across the kitchen/)).toBeVisible();

    // Shoot until the kitchen's question comes up.
    const card = page.getByText(/Before we move on/);
    const deadline = Date.now() + 200_000;
    while (!(await card.isVisible().catch(() => false))) {
      if (Date.now() > deadline) throw new Error('the room question never appeared');
      const shoot = page.getByRole('button', { name: /Take it now/ });
      if (await shoot.isVisible().catch(() => false)) await shoot.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    expect(scoutLang).toBe('en');
    await expect(page.getByText(/The kitchen looks really nice/)).toBeVisible();
    await expect(page.getByText('Adds about 14 min to the job')).toBeVisible();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();

    await expect(page.getByText('Is that everything?')).toBeVisible();
    // Captions stay Spanish for the model, whatever the walk was in.
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect.poll(() => (analyzed?.captions as string[] | undefined)?.[0] ?? '', { timeout: 20_000 }).toContain(
      'Vista general',
    );
    expect(analyzed?.depthChoices).toEqual({ 'kitchen:oven': 'deep' });
  });
});

test('a Spanish phone can switch the walkthrough to English', async ({ page }) => {
  await page.goto('/quote/video', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('¿Qué espacios vamos a ver?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Which spaces are we looking at?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Kitchen' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start the walkthrough/ })).toBeVisible();
});
