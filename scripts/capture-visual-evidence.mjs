import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const VIEWPORT = Object.freeze({ width: 412, height: 915 });
const APP_BASE_PATH = '/Elara-Angelic-Utility-Applet/';

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function requiredArgument(name) {
  const value = argument(name).trim();
  if (!value) throw new Error(`Missing required --${name} argument.`);
  return value;
}

const targetDir = resolve(requiredArgument('target'));
const label = requiredArgument('label');
const outputRoot = resolve(requiredArgument('output'));
const sourceSha = requiredArgument('source-sha');
const baseSha = requiredArgument('base-sha');
const headSha = requiredArgument('head-sha');
const port = Number.parseInt(requiredArgument('port'), 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Visual evidence port must be a valid non-privileged TCP port.');

const origin = `http://127.0.0.1:${port}`;
const appUrl = `${origin}${APP_BASE_PATH}`;
const outputDir = join(outputRoot, label);
const serverLog = [];
let server;

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function rememberServerLog(chunk) {
  const text = String(chunk);
  serverLog.push(text);
  if (serverLog.length > 80) serverLog.splice(0, serverLog.length - 80);
  process.stdout.write(`[${label}:vite] ${text}`);
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready.\n${serverLog.join('')}`);
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || (response.status >= 300 && response.status < 500)) return;
    } catch {
      // The socket is not ready yet.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}.\n${serverLog.join('')}`);
}

function signalServerTree(child, signal) {
  if (!child || child.exitCode !== null) return;
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to the direct child when the process group is already gone.
    }
  }
  try { child.kill(signal); } catch { /* process already exited */ }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  signalServerTree(child, 'SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolveStopped) => child.once('exit', () => resolveStopped(true))),
    delay(5_000).then(() => false),
  ]);
  if (!stopped && child.exitCode === null) {
    signalServerTree(child, 'SIGKILL');
    await Promise.race([
      new Promise((resolveStopped) => child.once('exit', () => resolveStopped(true))),
      delay(2_000),
    ]);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function thoughtStep(index, text) {
  return [
    `event: step.start\ndata: ${JSON.stringify({ event_type: 'step.start', index, step: { index, type: 'thought' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', index, delta: { type: 'thought_summary', text } })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index })}\n\n`,
  ].join('');
}

function answerStep(index, text) {
  return [
    `event: step.start\ndata: ${JSON.stringify({ event_type: 'step.start', index, step: { index, type: 'model_output' } })}\n\n`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', index, delta: { type: 'text', text } })}\n\n`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: 'step.stop', index })}\n\n`,
  ].join('');
}

function completedTurn() {
  const thoughts = [
    'Reviewing the request.',
    'Checking the requested budget structure.',
    'Preparing the sheet layout.',
    'Writing the expense breakdown.',
    'Finalizing the response.',
  ];
  const created = `event: interaction.created\ndata: ${JSON.stringify({
    event_type: 'interaction.created',
    interaction: { id: 'visual-evidence-generation-activity', status: 'in_progress', model: 'gemini-3.8-flash' },
  })}\n\n`;
  const thoughtEvents = thoughts.map((thought, index) => thoughtStep(index, thought)).join('');
  const completed = `event: interaction.completed\ndata: ${JSON.stringify({
    event_type: 'interaction.completed',
    interaction: {
      id: 'visual-evidence-generation-activity',
      status: 'completed',
      usage: { input_tokens: 12, output_tokens: 9 },
    },
  })}\n\n`;
  return created + thoughtEvents + answerStep(thoughts.length, 'Screenshot verification complete.') + completed;
}

async function unlockTestGemini(page) {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-visual-evidence-key');
  await page.getByRole('textbox', { name: 'Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('textbox', { name: 'Confirm Lockbox PIN', exact: true }).fill('2468135790');
  await page.getByRole('button', { name: 'Create PIN Lockbox' }).click();
  await page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'Back to chat' }).click();
}

async function captureGenerationActivity(page) {
  await page.route('**/v1/interactions*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: completedTurn(),
    });
  });

  await page.goto(appUrl, { waitUntil: 'load' });
  await page.getByRole('dialog', { name: 'Welcome.' }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  if (await page.getByRole('dialog', { name: 'Welcome.' }).isVisible()) {
    throw new Error('Visual evidence fixture could not establish the completed-onboarding state.');
  }

  await unlockTestGemini(page);
  await page.getByRole('textbox', { name: 'Message Elara' }).fill('Create a September budget mockup.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Screenshot verification complete.', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });

  const activity = page.getByRole('region', { name: 'Generation activity' });
  await activity.waitFor({ state: 'visible', timeout: 10_000 });
  const toggle = activity.getByRole('button').first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await activity.locator('.generation-activity__step').first().waitFor({ state: 'visible', timeout: 10_000 });

  const notoReady = await page.waitForFunction(
    () => globalThis.document.querySelectorAll('.generation-activity__noto-glyph').length > 0,
    undefined,
    { timeout: 10_000 },
  ).then(() => true).catch(() => false);

  const metrics = await activity.evaluate((section) => {
    const circle = section.querySelector('.generation-activity__step-icon');
    const glyph = section.querySelector('.generation-activity__noto-glyph');
    const fallback = circle?.querySelector('svg');
    const circleBox = circle?.getBoundingClientRect();
    const glyphBox = glyph?.getBoundingClientRect();
    const fallbackBox = fallback?.getBoundingClientRect();
    const glyphStyle = glyph ? globalThis.getComputedStyle(glyph) : null;
    return {
      stepCount: section.querySelectorAll('.generation-activity__step').length,
      circle: circleBox ? {
        width: Number(circleBox.width.toFixed(2)),
        height: Number(circleBox.height.toFixed(2)),
      } : null,
      glyph: glyphBox && glyphStyle ? {
        width: Number(glyphBox.width.toFixed(2)),
        height: Number(glyphBox.height.toFixed(2)),
        fontSize: glyphStyle.fontSize,
        lineHeight: glyphStyle.lineHeight,
        fontFamily: glyphStyle.fontFamily,
        fontWeight: glyphStyle.fontWeight,
      } : null,
      fallback: fallbackBox ? {
        width: Number(fallbackBox.width.toFixed(2)),
        height: Number(fallbackBox.height.toFixed(2)),
      } : null,
    };
  });

  await mkdir(outputDir, { recursive: true });
  const pagePath = join(outputDir, 'generation-activity-page.png');
  const panelPath = join(outputDir, 'generation-activity-panel.png');
  await page.screenshot({ path: pagePath, fullPage: false });
  await activity.screenshot({ path: panelPath });
  const glyphSettings = await captureGlyphSettings(page);

  const evidence = {
    schemaVersion: 1,
    label,
    scenario: 'generation-activity',
    sourceSha,
    baseSha,
    headSha,
    viewport: VIEWPORT,
    notoEmojiReady: notoReady,
    metrics: {
      generationActivity: metrics,
      glyphSettings: {
        previewReady: glyphSettings.previewReady,
        previewStatus: glyphSettings.previewStatus,
        rows: glyphSettings.rows,
      },
    },
    files: {
      page: `${label}/generation-activity-page.png`,
      panel: `${label}/generation-activity-panel.png`,
      glyphSettingsPage: glyphSettings.files.page,
      glyphSettingsPanel: glyphSettings.files.panel,
    },
  };
  await writeFile(join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function captureGlyphSettings(page) {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Appearance' }).click();

  const settings = page.locator('.generation-glyph-settings');
  await settings.waitFor({ state: 'visible', timeout: 10_000 });
  const previewStatus = settings.getByRole('status');
  await previewStatus
    .filter({ hasText: /Preview renders glyphs|Noto preview is unavailable/ })
    .waitFor({ state: 'visible', timeout: 10_000 });
  const previewStatusText = (await previewStatus.textContent())?.trim() ?? '';
  const previewReady = await settings.locator('.generation-glyph-setting__preview-glyph').first()
    .getAttribute('data-ready') === 'true';

  const rows = await settings.locator('.generation-glyph-setting').evaluateAll((elements) => elements.map((row) => {
    const circle = row.querySelector('.generation-glyph-setting__preview');
    const glyph = row.querySelector('.generation-glyph-setting__preview-glyph');
    const label = row.querySelector('label')?.textContent?.trim() ?? '';
    const circleBox = circle?.getBoundingClientRect();
    const glyphBox = glyph?.getBoundingClientRect();
    const glyphStyle = glyph ? globalThis.getComputedStyle(glyph) : null;
    return {
      label,
      circle: circleBox ? {
        width: Number(circleBox.width.toFixed(2)),
        height: Number(circleBox.height.toFixed(2)),
      } : null,
      glyph: glyphBox && glyphStyle ? {
        width: Number(glyphBox.width.toFixed(2)),
        height: Number(glyphBox.height.toFixed(2)),
        centerOffsetX: circleBox ? Number(((glyphBox.left + glyphBox.width / 2) - (circleBox.left + circleBox.width / 2)).toFixed(2)) : null,
        centerOffsetY: circleBox ? Number(((glyphBox.top + glyphBox.height / 2) - (circleBox.top + circleBox.height / 2)).toFixed(2)) : null,
        fontSize: glyphStyle.fontSize,
        lineHeight: glyphStyle.lineHeight,
        fontFamily: glyphStyle.fontFamily,
        fontWeight: glyphStyle.fontWeight,
        transform: glyphStyle.transform,
      } : null,
    };
  }));

  const pagePath = join(outputDir, 'generation-glyph-settings-page.png');
  const panelPath = join(outputDir, 'generation-glyph-settings-panel.png');
  await page.screenshot({ path: pagePath, fullPage: false });
  await settings.screenshot({ path: panelPath });

  return {
    rows,
    previewReady,
    previewStatus: previewStatusText,
    files: {
      page: `${label}/generation-glyph-settings-page.png`,
      panel: `${label}/generation-glyph-settings-panel.png`,
    },
  };
}


async function captureSettingsMemory(page) {
  // Deterministic Memory settings scenario: one canonical memory (present on
  // both revisions) plus one grounded semantic summary file (only when the
  // semanticMemories store exists). The fixture is synthetic and fully
  // pinned; on the base revision the semantic stage fails closed and is
  // recorded as such, keeping before/after comparable.
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.getByRole('dialog', { name: 'Welcome.' }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  if (await page.getByRole('dialog', { name: 'Welcome.' }).isVisible()) {
    throw new Error('Visual evidence fixture could not establish the completed-onboarding state.');
  }

  // First pass lets the app open its database, then the fixture is seeded
  // through one short-lived connection and the view is reloaded fresh.
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();
  await page.getByText('Memory Bank', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });

  const fixture = await page.evaluate(async () => {
    const request = globalThis.indexedDB.open('elara-angelic-utility-applet');
    let database;
    try {
      database = await new Promise((resolveOpen, rejectOpen) => {
        request.onsuccess = () => resolveOpen(request.result);
        request.onerror = () => rejectOpen(request.error);
      });
    } catch {
      return { canonicalSeeded: false, semanticSeeded: false };
    }
    const hasSemanticStore = [...database.objectStoreNames].includes('semanticMemories');
    const now = 1_758_000_000_000; // pinned epoch: deterministic dates and staleness
    try {
      await new Promise((resolveWrite, rejectWrite) => {
        const transaction = database.transaction(['memories'], 'readwrite');
        transaction.objectStore('memories').put({
          id: 'memory_visual_fixture',
          kind: 'CONTEXTUAL',
          title: 'Owner note',
          body: 'Zuhayr is the owner of the project.',
          createdAt: now,
          updatedAt: now,
          observedAt: now,
          confidence: 0.8,
          importance: 0.6,
          lifecycle: 'active',
          source: { source: 'user', createdAt: now },
          tags: [],
          relatedMemoryIds: [],
          supportingMemoryIds: [],
          conflictingMemoryIds: [],
          supersedes: [],
          supersededBy: [],
          reinforcementCount: 0,
          folderId: null,
          expiresAt: null,
          lastRecalledAt: null,
          recallCount: 0,
          pinned: false,
          autonomyContext: false,
        });
        transaction.oncomplete = () => resolveWrite();
        transaction.onerror = () => rejectWrite(transaction.error);
        transaction.onabort = () => rejectWrite(transaction.error);
      });
    } catch {
      database.close();
      return { canonicalSeeded: false, semanticSeeded: false };
    }
    let semanticSeeded = false;
    if (hasSemanticStore) {
      try {
        await new Promise((resolveWrite, rejectWrite) => {
          const transaction = database.transaction(['semanticMemories'], 'readwrite');
          transaction.objectStore('semanticMemories').put({
            id: 'semantic_visual_fixture',
            kind: 'person',
            title: 'Zuhayr',
            aliases: ['Z'],
            summary: 'The owner of the project.',
            recentObservations: ['Zuhayr is the owner of the project.'],
            openConflicts: [],
            sourceMemoryIds: ['memory_visual_fixture'],
            updatedAt: now,
            generatedAt: now,
            version: 1,
          });
          transaction.oncomplete = () => resolveWrite();
          transaction.onerror = () => rejectWrite(transaction.error);
          transaction.onabort = () => rejectWrite(transaction.error);
        });
        semanticSeeded = true;
      } catch {
        semanticSeeded = false;
      }
    }
    database.close();
    return { canonicalSeeded: true, semanticSeeded };
  });

  // Fresh mount so the UI reads the seeded fixture exactly once.
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.getByRole('dialog', { name: 'Welcome.' }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Memory' }).click();
  await page.getByText('Memory Bank', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });

  const semanticSection = page.locator('.semantic-files').first();
  const hasSemanticSection = await semanticSection.isVisible().catch(() => false);
  const metrics = await page.evaluate(() => {
    const boxOf = (element) => {
      const box = element.getBoundingClientRect();
      return { top: Number(box.top.toFixed(2)), width: Number(box.width.toFixed(2)), height: Number(box.height.toFixed(2)) };
    };
    const fontOf = (element) => {
      const style = globalThis.getComputedStyle(element);
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
    };
    const semantic = globalThis.document.querySelector('.semantic-files');
    const bank = globalThis.document.querySelector('.memory-settings');
    const firstCard = semantic?.querySelector('.semantic-files__card');
    const firstBankCard = bank?.querySelector('.memory-card');
    return {
      semanticTopics: semantic
        ? {
          present: true,
          ...boxOf(semantic),
          cards: semantic.querySelectorAll('.semantic-files__card').length,
          firstCard: firstCard
            ? { ...boxOf(firstCard), font: fontOf(firstCard.querySelector('strong') || firstCard) }
            : null,
        }
        : { present: false },
      memoryBank: bank
        ? {
          present: true,
          ...boxOf(bank),
          cards: bank.querySelectorAll('.memory-card').length,
          firstCard: firstBankCard ? boxOf(firstBankCard) : null,
        }
        : { present: false },
    };
  });

  const pagePath = join(outputDir, 'settings-memory-page.png');
  const panelPath = join(outputDir, 'settings-memory-panel.png');
  await page.screenshot({ path: pagePath, fullPage: false });
  const panel = hasSemanticSection ? semanticSection : page.locator('.memory-settings').first();
  await panel.screenshot({ path: panelPath });

  const evidence = {
    schemaVersion: 1,
    label,
    scenario: 'settings-memory',
    sourceSha,
    baseSha,
    headSha,
    viewport: VIEWPORT,
    fixture,
    metrics,
    files: {
      page: `${label}/settings-memory-page.png`,
      panel: `${label}/settings-memory-panel.png`,
    },
  };
  await writeFile(join(outputDir, 'settings-memory.evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  server = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: targetDir,
      env: {
        ...process.env,
        VITE_GOOGLE_CLIENT_ID: 'e2e-public-client-id.apps.googleusercontent.com',
        VITE_GOOGLE_PICKER_API_KEY: 'e2e-public-picker-api-key',
        VITE_GOOGLE_CLOUD_PROJECT_NUMBER: '123456789012',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // npm spawns Vite as a child. Give the dev server its own process group
      // so cleanup terminates the entire tree instead of leaving Vite holding
      // the stdout/stderr pipes and keeping this evidence process alive.
      detached: process.platform !== 'win32',
    },
  );
  server.stdout?.on('data', rememberServerLog);
  server.stderr?.on('data', rememberServerLog);

  await waitForServer(appUrl, server);
  process.stdout.write(`[${label}] dev server ready at ${appUrl}\n`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    globalThis.localStorage.setItem('elara.onboarding.completed', 'true');
  });
  const page = await context.newPage();

  try {
    await captureGenerationActivity(page);
    const memoryPage = await context.newPage();
    try {
      await captureSettingsMemory(memoryPage);
    } finally {
      await memoryPage.close();
    }
    process.stdout.write(`[${label}] visual evidence captured in ${outputDir}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

try {
  await main();
} finally {
  await stopServer(server);
}
