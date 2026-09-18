import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // list for humans, github annotations (check-run summaries) for CI
  // diagnosis, html report for the failure artifact upload.
  reporter: [['list'], ['github'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      testIgnore: /mobile-reliability\.spec\.ts|onboarding\.spec\.ts/,
    },
    {
      name: 'android-portrait',
      // Phone-specific reliability, media handoff/delivery, Workspace Drive,
      // and Generation Activity behaviour run against the canonical 9:16-ish
      // Android canvas with reduced motion.
      testMatch: /(?:mobile-reliability|vtt|media-handoff|media-delivery\.phase3|media-lifecycle\.acceptance|generation-activity|google-drive)\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
      },
    },
    {
      name: 'onboarding',
      testMatch: /onboarding\.spec\.ts/,
      use: {
        browserName: 'chromium',
        storageState: { cookies: [], origins: [] },
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173/Elara-Angelic-Utility-Applet/',
    storageState: 'e2e/.auth/legacy.json',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/Elara-Angelic-Utility-Applet/',
    // Local iteration may reuse a deliberate dev server; CI must always boot
    // the server from the checked-out head so stale code cannot satisfy E2E.
    reuseExistingServer: !process.env.CI,
    // The Google settings E2E drives the real OAuth authority, which refuses
    // to run without a configured client id. Client IDs are public browser
    // configuration (see .env.example); this value exists only for tests.
    env: { ...process.env, VITE_GOOGLE_CLIENT_ID: 'e2e-public-client-id.apps.googleusercontent.com' },
  },
});
