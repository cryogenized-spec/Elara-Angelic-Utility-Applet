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

  const evidence = {
    schemaVersion: 1,
    label,
    scenario: 'generation-activity',
    sourceSha,
    baseSha,
    headSha,
    viewport: VIEWPORT,
    notoEmojiReady: notoReady,
    metrics,
    files: {
      page: `${label}/generation-activity-page.png`,
      panel: `${label}/generation-activity-panel.png`,
    },
  };
  await writeFile(join(outputDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
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
