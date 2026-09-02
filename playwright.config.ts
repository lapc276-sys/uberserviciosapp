import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * End-to-end tests for the guided walkthrough.
 *
 * These cover the part of the product that cannot be checked by reading: that
 * the camera fires by itself, that going back actually goes back, that
 * retaking a frame replaces it instead of duplicating it. A regression there
 * does not show up on screen — it shows up in a customer's kitchen.
 *
 * The fake camera flags are what make this possible at all. Chromium can
 * synthesise a getUserMedia stream, so the whole capture flow runs headless
 * with no hardware and no permission prompt.
 */

/** Some sandboxes ship a prebuilt Chromium instead of Playwright's download. */
const SYSTEM_CHROMIUM = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './tests',
  // The walkthrough has real waits in it — a nine-second settle timeout per
  // step is deliberate behaviour, not slowness to be tuned away.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    permissions: ['camera'],
    launchOptions: {
      ...(existsSync(SYSTEM_CHROMIUM) ? { executablePath: SYSTEM_CHROMIUM } : {}),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },

  projects: [
    // A phone, because that is the only device this flow ever runs on.
    { name: 'android', use: { ...devices['Galaxy S9+'] } },
  ],

  // Reuses an already-running server so a dev loop doesn't rebuild each time.
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
