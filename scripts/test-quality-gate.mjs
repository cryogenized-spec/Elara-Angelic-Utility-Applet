import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const rel = (absolute) => relative(root, absolute).replaceAll('\\', '/');

function walk(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  const output = [];
  const stack = [absolute];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile()) output.push(next);
    }
  }
  return output;
}

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    fail(`missing structural contract file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Tests must execute behavior, not inspect implementation files as text.
// Static architecture/source contracts belong in this gate instead of Vitest,
// otherwise they inflate the apparent test count without covering runtime code.
// ---------------------------------------------------------------------------
const testFiles = [...walk('src'), ...walk('worker/test')]
  .filter((file) => /(?:\.test\.(?:ts|tsx)|\.spec\.(?:ts|tsx))$/.test(file));
const forbiddenSourceInspection = [
  [/from\s+['"]node:fs(?:\/promises)?['"]/, 'imports node:fs'],
  [/from\s+['"]node:path['"]/, 'imports node:path'],
  [/\breadFileSync\s*\(/, 'reads implementation files synchronously'],
  [/\bprocess\.cwd\s*\(/, 'anchors assertions to repository source text'],
];
for (const file of testFiles) {
  const source = readFileSync(file, 'utf8');
  for (const [pattern, label] of forbiddenSourceInspection) {
    if (pattern.test(source)) fail(`${rel(file)} ${label}; move structural assertions to scripts/test-quality-gate.mjs or replace them with behavior`);
  }
}

// ---------------------------------------------------------------------------
// 2. Hidden model-input prohibition for Workspace shortcuts.
// This is a source architecture invariant, not a behavioral unit assertion.
// ---------------------------------------------------------------------------
const appSource = read('src/app/App.tsx');
if (/streamAssistantTurn\s*\(\s*(?=['"`])/.test(appSource)) {
  fail('App.tsx passes an app-authored string literal directly to streamAssistantTurn');
}
for (const name of ['prefillWorkspaceShortcut', 'handleQuickShortcut']) {
  const body = appSource.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`))?.[0] ?? '';
  if (!body) fail(`Workspace shortcut entry point moved or disappeared: ${name}`);
  else {
    if (body.includes('streamAssistantTurn')) fail(`${name} bypasses the visible composer and streams a hidden model turn`);
    if (/hiddenTask|hidden\s+prompt/i.test(body)) fail(`${name} constructs hidden task text`);
  }
}
if (appSource.includes('Execute the saved Workspace shortcut')) fail('retired synthesized Workspace shortcut prompt returned');

// ---------------------------------------------------------------------------
// 3. Terminal persistence remains an application-level ownership boundary.
// Pure status behavior is unit-tested in chat/generation-sync; these checks only
// ensure App keeps routing navigation/mutations through that authority.
// ---------------------------------------------------------------------------
if ((appSource.match(/statusAfterNavigation\(current\)/g) ?? []).length < 2) {
  fail('App.tsx no longer preserves the saving barrier through both cancel/navigation paths');
}
if (!appSource.includes('if (isTerminalPhase(current.phase)) break;')) {
  fail('App.tsx no longer closes the upstream iterator when generation becomes terminal');
}
for (const handler of ['handleRename', 'handleArchive', 'handleDelete']) {
  const body = appSource.match(new RegExp(`async function ${handler}\\([\\s\\S]*?\\n  \\}`))?.[0] ?? '';
  if (!body || !/status\s*===\s*['"]saving['"]/.test(body)) fail(`${handler} no longer blocks mutation while terminal persistence owns storage`);
}

// ---------------------------------------------------------------------------
// 4. Single-owner shell geometry. Visual values are covered by Playwright;
// this gate prevents competing selector authorities from silently reappearing.
// ---------------------------------------------------------------------------
const shellSheets = [
  'src/app/layout.css',
  'src/app/app.css',
  'src/app/quick-action-rail.css',
  'src/app/components/conversation-surface.css',
  'src/app/components/portrait-banner.css',
  'src/app/components/workspace-menu.css',
  'src/app/components/composer.css',
  'src/app/components/composer-layout.css',
];
const sheets = new Map(shellSheets.map((path) => [path, read(path)]));

function selectorsOf(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const found = [];
  let prelude = '';
  for (const character of source) {
    if (character === '{') {
      const candidate = prelude.trim();
      if (candidate && !candidate.startsWith('@')) {
        for (const part of candidate.split(',')) {
          const selector = part.trim();
          if (selector) found.push(selector);
        }
      }
      prelude = '';
    } else if (character === '}') prelude = '';
    else prelude += character;
  }
  return found;
}

const geometryOwners = new Map([
  ['.app-shell', 'src/app/layout.css'],
  ['.control-stack', 'src/app/layout.css'],
  ['.glass-menu-button', 'src/app/layout.css'],
  ['.conversation', 'src/app/layout.css'],
  ['.conversation__stream', 'src/app/layout.css'],
  ['.elara-banner', 'src/app/components/portrait-banner.css'],
  ['.elara-banner__portrait-float', 'src/app/components/portrait-banner.css'],
  ['.workspace-trigger', 'src/app/components/workspace-menu.css'],
  ['.tool-rail', 'src/app/quick-action-rail.css'],
  ['.tool-rail--workspace', 'src/app/quick-action-rail.css'],
  ['.message', 'src/app/components/conversation-surface.css'],
  ['.message-user', 'src/app/components/conversation-surface.css'],
  ['.message-assistant', 'src/app/components/conversation-surface.css'],
  ['.message-meta', 'src/app/components/conversation-surface.css'],
  ['.message-body', 'src/app/components/conversation-surface.css'],
]);
for (const [selector, expectedOwner] of geometryOwners) {
  const owners = shellSheets.filter((path) => selectorsOf(sheets.get(path) ?? '').includes(selector));
  if (owners.length !== 1 || owners[0] !== expectedOwner) {
    fail(`${selector} geometry authority changed: expected only ${expectedOwner}, found ${owners.join(', ') || 'none'}`);
  }
}
const shellSource = [...sheets.values()].join('\n');
if (/\.left-spine\b/.test(shellSource)) fail('retired left-spine shell authority returned');
if (/(?:margin|padding|left|inset)[^;{}]*\b54px/.test(shellSource.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  fail('retired 54px left-spine offset returned');
}
if (/\.composer__markdown\b/.test(read('src/app/components/composer.css'))) fail('retired separate Markdown composer control styling returned');

// ---------------------------------------------------------------------------
// 5. YouTube iframe compliance is intentionally structural. Elara may style
// only its outer player surface; provider iframe geometry/interaction stays
// unmodified and no pseudo-element may be layered over provider controls.
// ---------------------------------------------------------------------------
const playerCss = read('src/media/playback/player-host.css');
const iframeRule = playerCss.match(/\.playback-player-host iframe\s*\{([^}]*)\}/)?.[1] ?? '';
const hostRule = playerCss.match(/\.playback-player-host\s*\{([^}]*)\}/)?.[1] ?? '';
if (!iframeRule.includes('min-height: 200px') || !iframeRule.includes('border: 0')) fail('YouTube iframe minimum geometry contract changed');
if (/position\s*:|z-index\s*:|transform\s*:|filter\s*:|opacity\s*:|pointer-events\s*:|clip(?:-path)?\s*:|mask\s*:/.test(iframeRule)) {
  fail('Elara styling acquired authority over YouTube iframe presentation/interaction');
}
for (const forbidden of [
  '.playback-player-host::before',
  '.playback-player-host::after',
  '.playback-player-host iframe::before',
  '.playback-player-host iframe::after',
]) {
  if (playerCss.includes(forbidden)) fail(`provider overlay selector returned: ${forbidden}`);
}
if (!hostRule.includes('min-height: 200px') || !hostRule.includes('aspect-ratio: 16 / 9') || !playerCss.includes('min-width: 200px')) {
  fail('YouTube host no longer preserves the reviewed minimum viewport geometry');
}
for (const preset of ['minimal', 'glass', 'cinema']) {
  if (!playerCss.includes(`:root[data-elara-media-player-preset='${preset}'] .playback-player-surface`)) fail(`missing outer-shell media preset: ${preset}`);
  if (playerCss.includes(`data-elara-media-player-preset='${preset}'] .playback-player-host`)) fail(`${preset} preset styles provider-owned iframe host instead of Elara outer shell`);
}

if (errors.length) {
  process.stderr.write(`Test quality gate failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Test quality gate passed: ${testFiles.length} unit/worker test files execute behavior rather than reading source text; Workspace input, terminal persistence, single-owner layout, and YouTube iframe structural contracts remain intact.\n`);
