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

export function defineWorkerTestConfig(test: {
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
}) {
  return defineConfig({
    plugins: [
      cloudflareTest({
        main: 'worker/src/index.test-entry.ts',
        miniflare: {
          compatibilityDate: '2026-08-22',
          durableObjects: {
            AUTONOMY: { className: 'TestAutonomyEngine', useSQLite: true },
            GOOGLE_OAUTH: { className: 'TestGoogleOAuthVault', useSQLite: true },
            CLICKUP_OAUTH: { className: 'TestClickUpOAuthVault', useSQLite: true },
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
            CLICKUP_OAUTH_CLIENT_ID: 'test-clickup-client-id',
            CLICKUP_OAUTH_CLIENT_SECRET: 'unit-test-clickup-client-secret-value',
            CLICKUP_PERSONAL_TOKEN: 'pk_unit_test_clickup_personal_token_please_ignore',
            CLICKUP_OAUTH_VAULT_KEY: 'unit-test-clickup-oauth-vault-key-material-please-ignore',
            C1_MODEL_STUB: '{"disposition":"noop","reason":"test stub"}',
          },
        },
        runInBackground: true,
        isolatedStorage: true,
      }),
    ],
    test: {
      include: [...test.include],
      ...(test.exclude ? { exclude: [...test.exclude] } : {}),
    },
  });
}

export default defineWorkerTestConfig({
  include: ['worker/test/**/*.test.ts'],
  // Legacy suites still use cloudflare:test reset(), which deletes every DO in
  // the pool. ClickUp's reentrant/race suites run in a separate workerd process
  // so unrelated global resets cannot destroy their live vault requests.
  exclude: ['worker/test/clickup-*.test.ts'],
});
