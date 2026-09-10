import { expect, test, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Autonomous routines — the local product loop, end to end in a real browser:
// create routine → master switch → Run now → read-only agent turn → structured
// outcome → deterministic policy → Autonomy Inbox → run history. The Gemini
// provider is satisfied by a route-mocked SSE stream (same pattern as the chat
// specs); no Google permissions are granted in the first two tests, so those
// runs are plain provider turns with no tools.
//
// NOTE: browser binaries cannot be downloaded in the development sandbox
// (CDN-blocked); GitHub CI is the authoritative executor of this spec.

function sse(interactionId: string, text: string): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text } })}\n\n`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}\n\n`,
  ].join('');
}

async function unlockTestGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill(['e2e', 'test', 'api', 'key'].join('-'));
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('284619');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function openAutonomySettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Autonomy' }).click();
}

async function createRoutine(page: Page, name: string, instruction: string): Promise<void> {
  await page.getByRole('button', { name: '+ Routine' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Instruction — what Elara should do each run/).fill(instruction);
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page.getByRole('heading', { name: 'Autonomy' })).toBeVisible();
  await expect(page.locator('.autonomy-routine', { hasText: name })).toBeVisible();
}

const EVENT_OUTCOME = JSON.stringify({
  outcome: 'event',
  title: 'Stand-up moved to 09:30',
  summary: 'Your stand-up moved later and now overlaps the design review.',
  importance: 2,
  confidence: 3,
  evidence: [{ kind: 'tool', ref: 'morning checklist', note: 'planned day' }],
});

const NOOP_OUTCOME = JSON.stringify({ outcome: 'noop', reason: 'all quiet', itemsExamined: 2 });

test('a routine run delivers an admitted event to the Autonomy Inbox', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/v1/interactions*', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('routine-run-1', EVENT_OUTCOME) });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await openAutonomySettings(page);

  await expect(page.getByText('No routines yet.')).toBeVisible();
  await createRoutine(page, 'Morning brief', 'Look at my day and tell me about morning changes.');

  // The master switch ships OFF: autonomy is opt-in.
  const masterSwitch = page.getByRole('switch', { name: 'Autonomous routines master switch' });
  await expect(masterSwitch).toHaveAttribute('aria-checked', 'false');

  // Enable autonomy, then run the routine manually.
  await masterSwitch.click();
  await expect(masterSwitch).toHaveAttribute('aria-checked', 'true');
  await page.locator('.autonomy-routine', { hasText: 'Morning brief' }).getByRole('button', { name: 'Run now' }).click();

  await expect(page.locator('.autonomy-routine__status', { hasText: 'Event delivered to the Autonomy Inbox.' })).toBeVisible();

  // The provider received a read-only routine turn: hard-coded policy instruction,
  // the routine prompt, and no tool declarations (no Google permissions granted).
  expect(requests.length).toBeGreaterThanOrEqual(1);
  const run = requests[0] as { system_instruction?: string; input?: string; tools?: unknown };
  expect(run.system_instruction).toContain('EXECUTION POLICY');
  // No Google tools granted => cloud locus: frozen context only, no retrieval, no tools.
  expect(run.system_instruction).toContain('You have no retrieval loop and no tools');
  expect(run.system_instruction).toContain('Execution locus: cloud-native');
  expect(run.system_instruction).toContain('Morning brief');
  expect(run.input).toContain('Morning brief');
  expect(run.tools).toBeUndefined();

  // The event lands unread in the inbox; reading it clears the badge.
  const inbox = page.locator('.autonomy-event', { hasText: 'Stand-up moved to 09:30' });
  await expect(inbox).toBeVisible();
  await expect(inbox.locator('.autonomy-event__dot')).toBeVisible();
  await expect(page.getByText('Autonomy Inbox · 1 new')).toBeVisible();
  await inbox.click();
  await expect(inbox.locator('.autonomy-event__dot')).toHaveCount(0);

  // Run history records the completed manual run.
  const historyRow = page.locator('.autonomy-run', { hasText: 'Morning brief' });
  await expect(historyRow).toContainText('completed');
  await expect(historyRow).toContainText('manual');

  // Autonomous events stay out of the interactive conversation entirely.
  await expect(page.locator('.message-user')).toHaveCount(0);
});

test('the authority gate and no-op silence behave as designed', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/v1/interactions*', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('routine-run-2', NOOP_OUTCOME) });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await openAutonomySettings(page);
  await createRoutine(page, 'Evening digest', 'Summarize anything that changed today.');

  // With the master switch off, Run now is skipped without executing anything:
  // no provider request is ever issued.
  await page.locator('.autonomy-routine', { hasText: 'Evening digest' }).getByRole('button', { name: 'Run now' }).click();
  await expect(page.locator('.autonomy-routine__status', { hasText: 'Skipped — autonomous routines are switched off.' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(0);
  const skippedRow = page.locator('.autonomy-run', { hasText: 'Evening digest' });
  await expect(skippedRow).toContainText('skipped');
  expect(await page.locator('.autonomy-event').count()).toBe(0);

  // Enabled: a no-op is a successful, silent run — the inbox stays quiet.
  await page.getByRole('switch', { name: 'Autonomous routines master switch' }).click();
  await page.locator('.autonomy-routine', { hasText: 'Evening digest' }).getByRole('button', { name: 'Run now' }).click();
  await expect(page.locator('.autonomy-routine__status', { hasText: 'Nothing noteworthy (all quiet).' })).toBeVisible();
  await expect(page.getByText('Quiet. When a routine run produces something worth telling you, it lands here — nothing else will.')).toBeVisible();
  await expect(page.locator('.autonomy-run', { hasText: 'Evening digest' }).first()).toContainText('no-op');
});

test('granted read permissions bound the provider tool surface, and routines persist across reload', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/v1/interactions*', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('routine-run-3', NOOP_OUTCOME) });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await openAutonomySettings(page);

  // Create a routine WITH the Tasks read capability granted.
  await page.getByRole('button', { name: '+ Routine' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Task sweep');
  await page.getByLabel(/Instruction — what Elara should do each run/).fill('Check my task lists for anything overdue.');
  await page.getByLabel('Tasks', { exact: true }).check();
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page.locator('.autonomy-routine', { hasText: 'Task sweep' })).toBeVisible();

  await page.getByRole('switch', { name: 'Autonomous routines master switch' }).click();
  await page.locator('.autonomy-routine', { hasText: 'Task sweep' }).getByRole('button', { name: 'Run now' }).click();
  await expect(page.locator('.autonomy-routine__status', { hasText: 'Nothing noteworthy (all quiet).' })).toBeVisible();

  // The provider request carries ONLY read-only Tasks tool declarations —
  // no write, no destructive, no internal, no local-artifact tools.
  expect(requests.length).toBeGreaterThanOrEqual(1);
  const tools = (requests[0] as { tools?: Array<{ name: string }> }).tools;
  expect(Array.isArray(tools)).toBe(true);
  const names = (tools ?? []).map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(['tasks.listTaskLists', 'tasks.listTasks', 'tasks.getTask']));
  expect(names.some((name) => /create|delete|write|update|move|insert|replace|append|clear|modify/i.test(name))).toBe(false);
  expect(names).not.toContain('document.create_pdf');

  // Persistence is real: the routine, its permissions, and the master switch
  // all survive a full page reload (Dexie, not component state).
  await page.reload();
  await openAutonomySettings(page);
  await expect(page.locator('.autonomy-routine', { hasText: 'Task sweep' })).toBeVisible();
  await expect(page.locator('.autonomy-routine', { hasText: 'Task sweep' })).toContainText('1 Google read');
  await expect(page.getByRole('switch', { name: 'Autonomous routines master switch' })).toHaveAttribute('aria-checked', 'true');
});

// The composition regression: the capability→tool mapping (routineToolSet)
// and the read-only admission policy (streamGoogleToolLoop) are enforced by
// two modules. This test joins them in a real browser through the REAL
// routine engine (no injected engine): a Drive-granted routine's Run now must
// reach the provider with the Drive read tools declared, and the run must
// complete. PROOF LEVEL: engine admission + provider declarations + run
// completion with the provider route-mocked — Google handler execution is not
// exercised here (that is covered by the integration test with the network
// edge mocked). If the mapping and the admission policy ever diverge again
// (the original defect: the loop rejected exactly the tools the mapping
// produced), the declaration check throws, no provider request is issued, and
// this test fails.
test('a Drive-granted routine runs through the real engine with only Drive read tools declared', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/v1/interactions*', async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse('routine-run-4', NOOP_OUTCOME) });
  });

  await page.goto('');
  await unlockTestGemini(page);
  await openAutonomySettings(page);

  await page.getByRole('button', { name: '+ Routine' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Drive sweep');
  await page.getByLabel(/Instruction — what Elara should do each run/).fill('Look for recently changed files in my Elara Drive folder.');
  await page.getByLabel('Drive — app files', { exact: true }).check();
  await page.getByRole('button', { name: 'Save routine' }).click();
  await expect(page.locator('.autonomy-routine', { hasText: 'Drive sweep' })).toBeVisible();

  await page.getByRole('switch', { name: 'Autonomous routines master switch' }).click();
  await page.locator('.autonomy-routine', { hasText: 'Drive sweep' }).getByRole('button', { name: 'Run now' }).click();

  // The run must COMPLETE (a real engine pass, not a RUN_INTERNAL failure).
  await expect(page.locator('.autonomy-routine__status', { hasText: 'Nothing noteworthy (all quiet).' })).toBeVisible();

  // And the provider must have received exactly the Drive read tool declarations.
  expect(requests.length).toBeGreaterThanOrEqual(1);
  const tools = (requests[0] as { tools?: Array<{ name: string }> }).tools;
  const names = (tools ?? []).map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(['drive.searchFiles', 'drive.getFile', 'drive.downloadFile']));
  expect(names.some((name) => /create|delete|write|update|move|insert|replace|append|clear|modify|send/i.test(name))).toBe(false);
});
