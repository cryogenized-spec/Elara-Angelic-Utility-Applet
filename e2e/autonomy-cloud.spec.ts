import { expect, test, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Cloud scheduler (Phase B, DRY RUN) — end to end in a real browser with the
// worker boundary NETWORK-MOCKED (the real DO/alarm behavior is covered by
// the workers-pool tests; Playwright validates the application state machine:
// pairing → config sync → scheduler-visible state → dry-run history → context
// lifecycle). E2E cannot validate real Cloudflare production behavior and
// does not pretend to.
//
// NOTE: browser binaries cannot be downloaded in the development sandbox
// (CDN-blocked); GitHub CI is the authoritative executor of this spec.

const WORKER = 'https://autonomy-worker.test';
const TOKEN = 'e2e-installation-token';

interface CapturedConfig {
  generation: number;
  enabled: boolean;
  maxEventsPerDay: number;
  routines: Array<{ id: string; name: string }>;
}

// Faithful to the real engine's /autonomy/state and /autonomy/context GET
// responses (engine contextSummary(now)): the card renders this summary.
const staleContextSummary = { contentHash: 'h'.repeat(64), syncedAt: 1_700_000_000_000, generation: 2, recordCount: 1, byteSize: 100, stale: true };

function corsJson(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}

async function mockWorker(page: Page, options: { contextStale?: boolean } = {}): Promise<{ configs: CapturedConfig[]; contextPosts: Array<Record<string, unknown>> }> {
  const configs: CapturedConfig[] = [];
  const contextPosts: Array<Record<string, unknown>> = [];
  await page.route(`${WORKER}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    if (path === '/autonomy/health') return route.fulfill(corsJson({ service: 'elara-gemini', autonomy: { configured: true, version: '1.0.0-phase-b', schemaVersion: 1, capabilities: ['config-sync', 'context-sync', 'scheduler-dry-run'], cron: '0 * * * *', dryRun: true } }));
    if (path === '/autonomy/pair') return route.fulfill(corsJson({ installationId: 'a'.repeat(32), service: 'elara-gemini', version: '1.0.0-phase-b', schemaVersion: 1, capabilities: ['config-sync', 'context-sync', 'scheduler-dry-run'], cron: '0 * * * *', dryRun: true }));
    if (path === '/autonomy/config') {
      configs.push(JSON.parse(route.request().postData() ?? '{}') as CapturedConfig);
      return route.fulfill(corsJson({ accepted: true, generation: configs.at(-1)!.generation, stateGeneration: 1, processed: 0, nextAlarmAt: 1_789_000_000_000 }));
    }
    if (path === '/autonomy/context' && method === 'POST') {
      contextPosts.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      return route.fulfill(corsJson({ accepted: true, metadata: { contentHash: 'h'.repeat(64), syncedAt: 1_789_000_000_000, generation: 2, recordCount: 0, byteSize: 2, stale: false } }));
    }
    if (path === '/autonomy/context') {
      return route.fulfill(corsJson({ context: options.contextStale ? staleContextSummary : null }));
    }
    if (path === '/autonomy/state') {
      return route.fulfill(corsJson({
        paired: true, dryRun: true, generation: 1, stateGeneration: 2, autonomyEnabled: true, maxEventsPerDay: 10,
        lastHeartbeatAt: 1_788_900_000_000, lastSyncedAt: 1_788_900_000_000, nextAlarmAt: 1_789_000_000_000,
        routines: [{ id: 'routine-cloud-1', name: 'Cloud brief', enabled: true, locus: 'cloud', schedule: { kind: 'daily', time: '09:00', days: 'every' }, timezone: 'UTC', nextDueAt: 1_789_000_000_000 }],
        // The card renders the context summary from the STATE response (the
        // real engine returns contextSummary(now) here), so the stale pack
        // must be carried on this route — the /autonomy/context GET alone is
        // never what the UI renders from.
        context: options.contextStale ? staleContextSummary : null,
        journal: [
          { at: 1_788_900_000_000, kind: 'heartbeat', generation: 2 },
          { at: 1_788_900_000_000, kind: 'registered', generation: 2, routineId: 'routine-cloud-1', occurrence: 1_789_000_000_000 },
        ],
      }));
    }
    if (path === '/autonomy/runs') {
      return route.fulfill(corsJson({ runs: [{
        id: 'cloud-run-1', runKey: 'routine-cloud-1:scheduled:1789000000000', routineId: 'routine-cloud-1', routineName: 'Cloud brief',
        executionMode: 'scheduled', scheduledFor: 1_789_000_000_000, startedAt: 1_789_000_000_100, completedAt: 1_789_000_000_100,
        state: 'skipped', outcome: 'skipped', errorCode: 'SCHEDULER_DRY_RUN',
      }] }));
    }
    return route.fulfill(corsJson({ code: 'not_found', message: 'No mock for this route.' }, 404));
  });
  return { configs, contextPosts };
}

async function openAutonomySettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Autonomy' }).click();
}

async function pair(page: Page): Promise<void> {
  await page.getByLabel('Worker URL').fill(WORKER);
  await page.getByLabel(/Installation token/).fill(TOKEN);
  await page.getByRole('button', { name: 'Verify & pair' }).click();
  await expect(page.getByText('dry run').first()).toBeVisible();
}

test('pairing, configuration sync, scheduler visibility, and dry-run history', async ({ page }) => {
  const { configs } = await mockWorker(page);
  await page.goto('');
  await openAutonomySettings(page);

  // Honest not-connected state first — never a fake "connected".
  await expect(page.getByText('Cloud scheduler — not connected')).toBeVisible();

  await pair(page);

  // The paired card shows truthful scheduler state (never "executing").
  await expect(page.getByText('Cloud scheduler', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.autonomy-cloud__schedule', { hasText: 'Cloud brief' })).toContainText('Next due:');
  await expect(page.locator('.autonomy-cloud__schedule', { hasText: 'Cloud brief' })).toContainText('execution: next phase');
  await page.locator('.autonomy-cloud__journal summary').click(); // expand the collapsed decision journal
  await expect(page.locator('.autonomy-cloud__journal')).toContainText('registered');
  await expect(page.locator('.autonomy-cloud__journal')).toContainText('heartbeat');

  // The initial sync pushed the (empty) configuration, signed.
  await expect.poll(() => configs.length).toBeGreaterThanOrEqual(1);
  expect(configs[0]!.enabled).toBe(false); // master switch ships OFF
  expect(configs[0]!.routines).toEqual([]);

  // Enabling the master switch syncs the change (generation-advancing).
  await page.getByRole('switch', { name: 'Autonomous routines master switch' }).click();
  await expect.poll(() => configs.some((config) => config.enabled === true)).toBe(true);

  // Cloud dry-run observations land in the LOCAL run history, honestly labeled.
  // (The pull is async — poll for the row, then assert its labels.)
  await expect(page.locator('.autonomy-run', { hasText: 'Cloud brief' })).toHaveCount(1, { timeout: 10_000 });
  const historyRow = page.locator('.autonomy-run', { hasText: 'Cloud brief' });
  await expect(historyRow).toContainText('skipped');
  await expect(historyRow).toContainText('cloud dry run');
});

test('the Autonomy Context lifecycle: replace on sync, manual clear, stale warning', async ({ page }) => {
  const { contextPosts } = await mockWorker(page, { contextStale: true });
  await page.goto('');
  await openAutonomySettings(page);
  await pair(page);

  // The empty local projection still syncs (a bounded, hash-stable empty pack).
  // Poll: the sync is async.
  await expect.poll(() => contextPosts.length).toBeGreaterThanOrEqual(1);
  const first = contextPosts[0]!;
  expect(Array.isArray(first.records)).toBe(true);

  // Staleness from the worker is surfaced (14-day threshold, UI-only by design).
  await expect(page.getByText('Context is stale (over 14 days old) — refresh it.')).toBeVisible();

  // Inspect shows the honest empty state (nothing consented in a fresh profile).
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByText(/Nothing is eligible yet/)).toBeVisible();

  // Manual clear wipes the worker-side pack immediately.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => contextPosts.some((post) => post.clear === true)).toBe(true);
  await expect(page.getByText('The worker-side Autonomy Context was cleared.')).toBeVisible();
});

test('routine authoring drives the mirrored configuration', async ({ page }) => {
  const { configs } = await mockWorker(page);
  await page.goto('');
  await openAutonomySettings(page);
  await pair(page);

  await page.getByRole('button', { name: '+ Routine' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Cloud brief');
  await page.getByLabel(/Instruction — what Elara should do each run/).fill('Summarize anything that changed overnight.');
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page.locator('.autonomy-routine', { hasText: 'Cloud brief' })).toBeVisible();

  // The saved routine reached the worker mirror with a fresh generation.
  await expect.poll(() => configs.some((config) => config.routines.some((routine) => routine.name === 'Cloud brief'))).toBe(true);
  const withRoutine = configs.filter((config) => config.routines.some((routine) => routine.name === 'Cloud brief'));
  expect(withRoutine.at(-1)!.generation).toBeGreaterThan(configs[0]!.generation);

  // Disabling the routine syncs the change too.
  await page.locator('.autonomy-routine', { hasText: 'Cloud brief' }).getByRole('switch', { name: 'Enable Cloud brief' }).click();
  await expect.poll(() => configs.some((config) => config.routines.some((routine) => routine.name === 'Cloud brief' && routine.enabled === false))).toBe(true);
});
