import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// ---------------------------------------------------------------------------
// Real Cloudflare Worker / Durable Object / alarm testing (design §15).
// The main worker (worker/src/index.ts) runs in workerd with REAL alarms,
// REAL DO SQL storage, and the same bindings the deployed worker receives.
// These tests run separately from the jsdom pool (`npm test`) via
// `npm run test:workers`. Per-test storage isolation is provided by
// `reset()` from 'cloudflare:test' in each suite's beforeEach.
//
// NOTE: the bundled workerd test binary supports compatibility dates up to
// 2026-08-22; the deployed wrangler.toml date (2026-09-03) targets the newer
// production runtime. Nothing in the worker depends on flags newer than that.
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: 'worker/src/index.test-entry.ts',
      miniflare: {
        compatibilityDate: '2026-08-22',
        durableObjects: {
          AUTONOMY: { className: 'TestAutonomyEngine', useSQLite: true },
          GOOGLE_OAUTH: { className: 'TestGoogleOAuthVault', useSQLite: true },
        },
        workflows: {
          ROUTINE_RUN: { name: 'elara-routine-run', className: 'RoutineRunWorkflow' },
        },
        bindings: {
          GEMINI_API_KEY: 'test-gemini-key',
          ALLOWED_ORIGINS: 'https://cryogenized-spec.github.io',
          ELARA_INSTALLATION_TOKEN: 'test-installation-token-please-ignore',
          GOOGLE_OAUTH_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
          GOOGLE_OAUTH_CLIENT_SECRET: 'unit-test-google-client-secret-value',
          GOOGLE_OAUTH_VAULT_KEY: 'unit-test-google-oauth-vault-key-material-please-ignore',
          C1_MODEL_STUB: '{"disposition":"noop","reason":"test stub"}',
        },
      },
      runInBackground: true, // alarms may fire while tests await
      isolatedStorage: true, // fresh DO storage per test
    }),
  ],
  test: {
    include: ['worker/test/**/*.test.ts'],
  },
});
