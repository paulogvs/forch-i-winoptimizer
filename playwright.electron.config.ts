import { defineConfig } from '@playwright/test';

/**
 * Dedicated config for the real-Electron E2E (v0.6.0).
 *
 * The browser suite (`playwright.config.ts`) mocks `window.electronAPI`, so the
 * main process is never exercised. This config launches the ACTUAL Electron app
 * (main + preload + renderer) so the security scanner is validated against the
 * real machine.
 *
 * It needs a production build (`dist/`), hence the npm script builds first:
 *   npm run test:e2e:electron
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /security-real-electron\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
