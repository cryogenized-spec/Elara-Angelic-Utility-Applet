import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    fail(`missing ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function walk(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  const files = [];
  const stack = [absolute];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files;
}

const relativePath = (absolute) => relative(root, absolute).replaceAll('\\', '/');
const count = (source, pattern) => (source.match(pattern) ?? []).length;

// A green test suite is not evidence if the suite can silently be focused,
// skipped, expected-to-fail, or narrowed. Keep this dependency-free so it can
// run before npm ci and protect the verification harness itself.
const forbiddenTestControl = /\b(?:test|it|describe|test\.describe)\.(?:skip|only|fixme|fail|todo)\s*\(/;
for (const testFile of [...walk('src'), ...walk('worker/test'), ...walk('e2e')]) {
  if (!/(?:\.test\.(?:ts|tsx)|\.spec\.ts)$/.test(testFile)) continue;
  const source = readFileSync(testFile, 'utf8');
  if (forbiddenTestControl.test(source)) {
    fail(`${relativePath(testFile)} contains a disabled, focused, or expected-failure test control`);
  }
}

// E2E must drive user/public boundaries. Direct app imports and writable IDB
// fixtures can let a browser test forge state that the real application could
// not. Two reviewed media tests deliberately mutate already-created persisted
// rows to prove retention/adversarial behavior; exact path/count allowlisting
// makes any additional writable fixture an explicit architecture event.
const e2eFiles = walk('e2e').filter((path) => /(?:\.spec\.ts|global-setup\.ts)$/.test(path));
const forbiddenSourceImport = /(?:from\s+['"](?:\.\.\/)+src\/|import\s*\(\s*['"](?:\.\.\/)+src\/|['"]\/(?:Elara-Angelic-Utility-Applet\/)?src\/)/;
const writableIndexedDb = /['"]readwrite['"]/g;
const directDatabaseDeletion = /indexedDB\.deleteDatabase\s*\(/;
const retiredBrowserProvider = /\*\*\/api\/gemini|\/api\/gemini/;
const allowedWritableIndexedDb = new Map([
  ['e2e/media-handoff.spec.ts', 1],
  ['e2e/media-playback-adversarial.phase8.spec.ts', 1],
]);
const allowedLocalStorageWrites = new Map([
  ['e2e/global-setup.ts', 1],
  ['e2e/google-oauth-settings.spec.ts', 1],
  ['e2e/smoke.spec.ts', 1],
  ['e2e/youtube-policy-consent.phase9.spec.ts', 1],
]);

for (const file of e2eFiles) {
  const source = readFileSync(file, 'utf8');
  const path = relativePath(file);
  if (forbiddenSourceImport.test(source)) fail(`${path} imports application source directly instead of driving a public/user boundary`);
  if (retiredBrowserProvider.test(source)) fail(`${path} references the retired browser /api/gemini provider route`);
  if (directDatabaseDeletion.test(source)) fail(`${path} deletes IndexedDB directly; E2E must not erase application stores behind the public boundary`);

  const writableTransactions = count(source, writableIndexedDb);
  const allowedWritableTransactions = allowedWritableIndexedDb.get(path) ?? 0;
  if (writableTransactions !== allowedWritableTransactions) {
    fail(`${path} contains ${writableTransactions} writable IndexedDB transaction(s); expected ${allowedWritableTransactions}. Review any browser-state mutation explicitly.`);
  }

  const writes = count(source, /(?:window\.)?localStorage\.setItem\s*\(/g);
  const allowed = allowedLocalStorageWrites.get(path) ?? 0;
  if (writes !== allowed) {
    fail(`${path} contains ${writes} localStorage write(s); expected ${allowed}. Review any browser-state seeding explicitly.`);
  }
}

for (const [path] of [...allowedWritableIndexedDb, ...allowedLocalStorageWrites]) {
  if (!e2eFiles.some((file) => relativePath(file) === path)) fail(`approved E2E fixture is missing: ${path}`);
}

// The E2E compiler surface must stay strict and must not grow a shortcut back
// into application source.
const tsconfigSource = read('tsconfig.e2e.json');
try {
  const config = JSON.parse(tsconfigSource);
  if (config.compilerOptions?.strict !== true) fail('tsconfig.e2e.json must keep strict=true');
  if (config.compilerOptions?.noEmit !== true) fail('tsconfig.e2e.json must keep noEmit=true');
  if (JSON.stringify(config.include) !== JSON.stringify(['e2e'])) fail('tsconfig.e2e.json must cover the complete e2e directory');
  if (config.compilerOptions?.paths) fail('tsconfig.e2e.json must not provide application-source aliases');
  if (config.compilerOptions?.allowImportingTsExtensions) fail('tsconfig.e2e.json must not enable direct .ts source imports');
} catch (error) {
  fail(`tsconfig.e2e.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const playwright = read('playwright.config.ts');
for (const project of ["name: 'chromium'", "name: 'android-portrait'", "name: 'onboarding'"]) {
  if (!playwright.includes(project)) fail(`Playwright configuration is missing ${project}`);
}
if (!playwright.includes("globalSetup: './e2e/global-setup.ts'")) fail('Playwright must keep the explicit global setup');
if (!playwright.includes('storageState: { cookies: [], origins: [] }')) fail('Onboarding must start with clean browser storage');
if (!playwright.includes('reuseExistingServer: !process.env.CI')) fail('CI must not reuse an arbitrary pre-existing Playwright web server');
if (/\bpassWithNoTests\s*:/.test(playwright)) fail('Playwright must not allow an empty test suite');

const vitest = read('vitest.config.ts');
if (!vitest.includes("environment: 'jsdom'")) fail('main Vitest suite must keep the jsdom environment');
if (/\b(?:include|testNamePattern|passWithNoTests)\s*:/.test(vitest)) fail('main Vitest config may not narrow discovery or allow an empty suite');

const workerVitest = read('vitest.workers.config.ts');
if (!workerVitest.includes("include: ['worker/test/**/*.test.ts']")) fail('Worker Vitest must include the complete worker/test tree');
if (!workerVitest.includes('isolatedStorage: true')) fail('Worker tests must keep per-test storage isolation');
if (/\b(?:testNamePattern|passWithNoTests)\s*:/.test(workerVitest)) fail('Worker Vitest may not narrow named tests or allow an empty suite');

// Pin the commands that constitute the repository's verification contract.
const packageSource = read('package.json');
try {
  const pkg = JSON.parse(packageSource);
  const expectedScripts = {
    'docs:check': 'node scripts/check-docs.mjs',
    'verify:gates': 'node scripts/check-verification-integrity.mjs',
    lint: 'eslint .',
    typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p worker/tsconfig.json --noEmit && tsc -p tsconfig.e2e.json --noEmit',
    test: 'vitest run',
    'test:workers': 'vitest run --config vitest.workers.config.ts',
    build: 'tsc -p tsconfig.json --noEmit && vite build',
    e2e: 'playwright test',
    'reliability:check': 'npm run docs:check && npm run verify:gates && node scripts/reliability-gate.mjs',
  };
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (pkg.scripts?.[name] !== expected) fail(`npm script ${name} changed from the reviewed command`);
  }
} catch (error) {
  fail(`package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

// CI itself is inside the threat model. It must run the protected commands in
// order, with lockfile-strict installation and read-only repository access.
const workflow = read('.github/workflows/ci.yml');
for (const marker of ['continue-on-error', 'if: always()', '|| true', 'set +e']) {
  if (workflow.includes(marker)) fail(`CI workflow contains forbidden bypass marker: ${marker}`);
}
if (/run:\s+npm install\b/.test(workflow)) fail('CI must use npm ci rather than npm install');
if (!workflow.includes('permissions:\n  contents: read')) fail('CI repository permissions must remain read-only');
const orderedCommands = [
  'npm run docs:check',
  'npm run verify:gates',
  'npm ci --no-audit --no-fund',
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run test:workers',
  'npm run build',
  'npm exec -- playwright install --with-deps chromium',
  'npm run e2e -- --project=chromium --project=android-portrait --project=onboarding',
  'npm run reliability:check',
];
let previousIndex = -1;
for (const command of orderedCommands) {
  const index = workflow.indexOf(command, previousIndex + 1);
  if (index === -1) fail(`CI workflow is missing or reorders required command: ${command}`);
  else previousIndex = index;
}

// Cheap suppression hygiene: TypeScript suppression is prohibited, and every
// actual ESLint-disable comment must carry an inline reason after `--`.
const eslintDisableComment = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b/;
const reasonedEslintDisableComment = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\s+[^\n]+\s--\s\S/;
for (const file of [...walk('src'), ...walk('worker'), ...walk('e2e'), ...walk('scripts')]) {
  if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  const path = relativePath(file);
  if (/@ts-(?:ignore|nocheck)\b/.test(source)) fail(`${path} contains a forbidden TypeScript suppression`);
  for (const line of source.split(/\r?\n/)) {
    if (eslintDisableComment.test(line) && !reasonedEslintDisableComment.test(line)) {
      fail(`${path} contains an eslint-disable without an inline reason`);
      break;
    }
  }
}

if (errors.length) {
  process.stderr.write(`Verification integrity failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Verification integrity passed: ${e2eFiles.filter((file) => file.endsWith('.spec.ts')).length} E2E specs plus unit/worker test controls checked; no skip/focus controls, direct app-state imports, unreviewed writable IndexedDB fixtures, CI bypass markers, unreasoned lint disables, TypeScript suppressions, or reviewed-script drift detected.\n`);
