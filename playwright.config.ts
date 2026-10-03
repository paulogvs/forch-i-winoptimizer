import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The real-Electron spec needs `dist/` and has its own config/timeout:
  // run it with `npm run test:e2e:electron` (playwright.electron.config.ts).
  testIgnore: /security-real-electron\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Launch Vite DIRECTLY instead of `npm run dev`. `npm run dev` triggers the
    // `predev` hook, which shells out to the ecosystem heartbeat client; when the
    // heartbeat stalls (a sibling session holds the ecosystem lock) Vite never
    // starts and the whole suite dies with ERR_CONNECTION_REFUSED mid-run.
    // Invoking the Vite binary keeps test startup deterministic, fast and
    // hermetic (no writes to the ecosystem) and avoids that failure mode.
    command: 'node ./node_modules/vite/bin/vite.js --port 5173 --strictPort',
    url: 'http://localhost:5173',
    // Local runs reuse an already-running server; CI always starts a clean one.
    // `--strictPort` makes a port clash fail fast instead of silently serving
    // the wrong app.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
