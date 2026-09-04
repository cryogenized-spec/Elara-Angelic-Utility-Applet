import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      testIgnore: /mobile-reliability\.spec\.ts/,
    },
    {
      name: 'android-portrait',
      testMatch: /(?:mobile-reliability|vtt)\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173/Elara-Angelic-Utility-Applet/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/Elara-Angelic-Utility-Applet/',
    reuseExistingServer: true,
  },
});
