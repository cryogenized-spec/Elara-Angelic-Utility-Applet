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

const forbiddenTestControl = /\b(?:test|it|describe|test\.describe)\.(?:skip|only|fixme|fail|todo)\s*\(/;
for (const testFile of [...walk('src'), ...walk('worker/test'), ...walk('e2e')]) {
  if (!/(?:\.test\.(?:ts|tsx)|\.spec\.ts)$/.test(testFile)) continue;
  const source = readFileSync(testFile, 'utf8');
  if (forbiddenTestControl.test(source)) fail(`${relativePath(testFile)} contains a disabled, focused, or expected-failure test control`);
}

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
  if (writableTransactions !== allowedWritableTransactions) fail(`${path} contains ${writableTransactions} writable IndexedDB transaction(s); expected ${allowedWritableTransactions}. Review any browser-state mutation explicitly.`);
  const writes = count(source, /(?:window\.)?localStorage\.setItem\s*\(/g);
  const allowed = allowedLocalStorageWrites.get(path) ?? 0;
  if (writes !== allowed) fail(`${path} contains ${writes} localStorage write(s); expected ${allowed}. Review any browser-state seeding explicitly.`);
}
for (const [path] of [...allowedWritableIndexedDb, ...allowedLocalStorageWrites]) {
  if (!e2eFiles.some((file) => relativePath(file) === path)) fail(`approved E2E fixture is missing: ${path}`);
}

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
for (const project of ["name: 'chromium'", "name: 'android-portrait'", "name: 'onboarding'"]) if (!playwright.includes(project)) fail(`Playwright configuration is missing ${project}`);
if (!playwright.includes("globalSetup: './e2e/global-setup.ts'")) fail('Playwright must keep the explicit global setup');
if (!playwright.includes('storageState: { cookies: [], origins: [] }')) fail('Onboarding must start with clean browser storage');
if (!playwright.includes('reuseExistingServer: !process.env.CI')) fail('CI must not reuse an arbitrary pre-existing Playwright web server');
if (/\bpassWithNoTests\s*:/.test(playwright)) fail('Playwright must not allow an empty test suite');

const vitest = read('vitest.config.ts');
if (!vitest.includes("environment: 'jsdom'")) fail('main Vitest suite must keep the jsdom environment');
if (/\b(?:testNamePattern|passWithNoTests)\s*:/.test(vitest)) fail('main Vitest config may not narrow discovery or allow an empty suite');
for (const marker of ["provider: 'v8'", "reporter: ['text', 'json-summary']", "reportsDirectory: 'coverage'", "include: ['src/**/*.{ts,tsx}']", "'src/**/*.test.{ts,tsx}'", "'src/**/*.spec.{ts,tsx}'"]) {
  if (!vitest.includes(marker)) fail(`Vitest whole-source coverage contract changed or disappeared: ${marker}`);
}

const workerVitest = read('vitest.workers.config.ts');
if (!workerVitest.includes("include: ['worker/test/**/*.test.ts']")) fail('Worker Vitest must include the complete worker/test tree');
if (!workerVitest.includes('isolatedStorage: true')) fail('Worker tests must keep per-test storage isolation');
if (/\b(?:testNamePattern|passWithNoTests)\s*:/.test(workerVitest)) fail('Worker Vitest may not narrow named tests or allow an empty suite');

const packageSource = read('package.json');
try {
  const pkg = JSON.parse(packageSource);
  const expectedScripts = {
    'docs:check': 'node scripts/check-docs.mjs',
    'verify:gates': 'node scripts/check-verification-integrity.mjs',
    'security:check': 'node scripts/security-architecture-gate.mjs',
    'secrets:check': 'node scripts/secret-scan.mjs',
    'supply-chain:check': 'node scripts/supply-chain-gate.mjs',
    'test:quality': 'node scripts/test-quality-gate.mjs && node scripts/verify-coverage-gate.mjs',
    lint: 'eslint . --max-warnings 0',
    typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p worker/tsconfig.json --noEmit && tsc -p tsconfig.e2e.json --noEmit',
    'typecheck:ts7': 'node node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit && node node_modules/@typescript/native/bin/tsc -p worker/tsconfig.json --noEmit && node node_modules/@typescript/native/bin/tsc -p tsconfig.e2e.json --noEmit',
    test: 'vitest run',
    'coverage:check': 'node scripts/check-coverage.mjs',
    'test:coverage': 'vitest run --coverage && npm run coverage:check',
    'test:workers': 'vitest run --config vitest.workers.config.ts',
    build: 'tsc -p tsconfig.json --noEmit && vite build',
    e2e: 'playwright test',
    'reliability:check': 'npm run docs:check && npm run verify:gates && npm run security:check && npm run secrets:check && npm run supply-chain:check && npm run test:quality && node scripts/reliability-gate.mjs',
  };
  for (const [name, expected] of Object.entries(expectedScripts)) if (pkg.scripts?.[name] !== expected) fail(`npm script ${name} changed from the reviewed command`);
  if (pkg.devDependencies?.['@vitest/coverage-v8'] !== '4.1.11') fail('@vitest/coverage-v8 must stay exactly aligned with Vitest 4.1.11');
  if (pkg.overrides?.sharp !== '0.35.4') fail('package.json must keep the reviewed sharp 0.35.4 security override');
} catch (error) {
  fail(`package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (read('.nvmrc').trim() !== '24.21.0') fail('.nvmrc must remain exactly pinned to Node 24.21.0');

const eslintConfig = read('eslint.config.js');
for (const hardRule of ["'@typescript-eslint/no-explicit-any': 'error'", "'react-hooks/set-state-in-effect': 'error'", "'react-hooks/purity': 'error'", "'react-hooks/exhaustive-deps': 'error'", "'no-unsafe-finally': 'error'"]) {
  if (!eslintConfig.includes(hardRule)) fail(`eslint hard rule is missing or weakened: ${hardRule}`);
}
const reviewedLintExceptions = [
  [/'react-hooks\/purity': 'off'/g, 1, 'React purity exception'],
  [/'react-hooks\/set-state-in-effect': 'off'/g, 1, 'set-state-in-effect exception'],
  [/'@typescript-eslint\/no-explicit-any': 'off'/g, 1, 'no-explicit-any exception'],
];
for (const [pattern, expected, label] of reviewedLintExceptions) {
  const actual = count(eslintConfig, pattern);
  if (actual !== expected) fail(`${label} count changed: expected ${expected}, found ${actual}`);
}
for (const reviewedPath of ["files: ['src/app/App.tsx']", "files: ['src/app/components/GeminiApiLockbox.tsx', 'src/app/components/Sidebar.tsx']", "files: ['worker/test/autonomy-engine.test.ts', 'worker/test/autonomy-http.test.ts']"]) {
  if (!eslintConfig.includes(reviewedPath)) fail(`reviewed lint exception scope changed or disappeared: ${reviewedPath}`);
}

const appSource = read('src/app/App.tsx');
const appDateNowCount = count(appSource, /Date\.now\(\)/g);
const appPerformanceNowCount = count(appSource, /performance\.now\(\)/g);
if (appDateNowCount !== 11) fail(`src/app/App.tsx Date.now() surface changed: expected 11, found ${appDateNowCount}`);
if (appPerformanceNowCount !== 2) fail(`src/app/App.tsx performance.now() surface changed: expected 2, found ${appPerformanceNowCount}`);

const securityGate = read('scripts/security-architecture-gate.mjs');
for (const marker of ['forbiddenCapabilities', 'forbiddenNodeAuthority', 'XMLHttpRequest transport', 'sendBeacon transport', 'remote dynamic module import', 'reviewedScriptLoaders', 'reviewedWorkerAuthorities', 'reviewedDexieAuthorities', 'reviewedLockboxConsumers', 'reviewedAutonomyCredentialConsumers', 'reviewedPairingTokenConsumers', 'reviewedRawFetchAuthorities', 'reviewedGlobalFetchReferences', 'reviewedGoogleServiceImporters', 'reviewedConfirmationBrokerConsumers', 'StoredAutonomyPairing']) {
  if (!securityGate.includes(marker)) fail(`security architecture gate lost required capability check: ${marker}`);
}

const secretScan = read('scripts/secret-scan.mjs');
for (const marker of ['Google API key', 'GitHub token', 'AWS access key', 'Private key material', 'tracked environment file is forbidden', 'dummyMarker', 'fixturePath']) {
  if (!secretScan.includes(marker)) fail(`secret scanner lost required detector or fixture policy: ${marker}`);
}

const supplyChainGate = read('scripts/supply-chain-gate.mjs');
for (const marker of ['reviewedActions', 'reviewedDirectDependencies', 'reviewedInstallScripts', 'baseline.overrides', 'sharp?.version', 'lockfileVersion', 'strict-allow-scripts=true', 'persist-credentials', 'upload-pages-artifact', 'deploy-pages', 'npm audit signatures', 'npm audit --audit-level=high']) {
  if (!supplyChainGate.includes(marker)) fail(`supply-chain gate lost required control: ${marker}`);
}
try {
  const baseline = JSON.parse(read('scripts/supply-chain-baseline.json'));
  if (baseline.node !== '24.21.0') fail('supply-chain baseline must keep Node 24.21.0');
  if (baseline.npm !== '11.19.0') fail('supply-chain baseline must keep npm 11.19.0');
  if (baseline.overrides?.sharp !== '0.35.4') fail('supply-chain baseline must keep sharp 0.35.4');
  for (const marker of ['strict-allow-scripts=true', 'allow-git=none', 'allow-remote=none', 'allow-file=none']) {
    if (!baseline.npmrc?.includes(marker)) fail(`supply-chain baseline lost npm policy: ${marker}`);
  }
} catch (error) {
  fail(`scripts/supply-chain-baseline.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const testQualityGate = read('scripts/test-quality-gate.mjs');
for (const marker of ['forbiddenSourceInspection', 'streamAssistantTurn', 'statusAfterNavigation', 'geometryOwners', 'playback-player-host iframe']) {
  if (!testQualityGate.includes(marker)) fail(`test quality gate lost required structural check: ${marker}`);
}
const coverageGate = read('scripts/check-coverage.mjs');
for (const marker of ['coverage/coverage-summary.json', 'coverage-baseline.json', 'baseline.directories', 'baseline.files', 'eligible source disappeared from coverage report']) {
  if (!coverageGate.includes(marker)) fail(`coverage gate lost required ratchet check: ${marker}`);
}
const coverageSentinel = read('scripts/verify-coverage-gate.mjs');
for (const marker of ['spawnSync', 'check-coverage.mjs', 'deliberately regressed branch metric', 'source-inventory disappearance']) {
  if (!coverageSentinel.includes(marker)) fail(`coverage adversarial sentinel lost required proof: ${marker}`);
}
try {
  const baseline = JSON.parse(read('scripts/coverage-baseline.json'));
  if (baseline.measuredFrom !== 'phase3-final-measurement@3efd0085') fail('coverage baseline must identify the certified Phase 3 measurement head');
  const certifiedGlobal = { lines: 64.14, statements: 58.73, functions: 54.21, branches: 53.44 };
  const certifiedDirectories = {
    autonomy: { lines: 94.35, statements: 92.32, functions: 91.28, branches: 83.14 },
    chat: { lines: 96.38, statements: 93.16, functions: 95.38, branches: 84.03 },
    domain: { lines: 97.34, statements: 92.75, functions: 92.30, branches: 85.05 },
    gemini: { lines: 87.83, statements: 81.81, functions: 80.85, branches: 75.23 },
    media: { lines: 89.00, statements: 85.14, functions: 89.47, branches: 77.57 },
    memory: { lines: 95.00, statements: 91.41, functions: 92.85, branches: 79.77 },
    persistence: { lines: 74.17, statements: 69.84, functions: 68.29, branches: 61.14 },
  };
  const certifiedFiles = {
    'src/autonomy/cloud/credential.ts': { lines: 93.93, statements: 94.59, functions: 100.00, branches: 75.00 },
    'src/autonomy/cloud/pairing.ts': { lines: 100.00, statements: 95.77, functions: 90.47, branches: 81.63 },
    'src/persistence/gemini-api-key.ts': { lines: 91.12, statements: 86.25, functions: 85.33, branches: 78.80 },
    'src/chat/generation-sync.ts': { lines: 92.98, statements: 90.14, functions: 94.44, branches: 80.00 },
    'src/gemini/provider.ts': { lines: 86.76, statements: 78.76, functions: 72.97, branches: 68.67 },
    'src/media/playback/PlaybackProvider.tsx': { lines: 95.61, statements: 93.18, functions: 92.30, branches: 84.31 },
    'src/memory/store.ts': { lines: 97.05, statements: 89.79, functions: 92.30, branches: 70.96 },
  };
  const protectFloor = (label, actual, expected) => {
    for (const [metric, minimum] of Object.entries(expected)) {
      if (typeof actual?.[metric] !== 'number' || actual[metric] < minimum) fail(`${label} ${metric} was lowered below the certified Phase 3 floor ${minimum}`);
    }
  };
  protectFloor('coverage baseline global', baseline.global, certifiedGlobal);
  for (const [directory, floors] of Object.entries(certifiedDirectories)) protectFloor(`coverage baseline directory ${directory}`, baseline.directories?.[directory], floors);
  for (const [path, floors] of Object.entries(certifiedFiles)) protectFloor(`coverage baseline file ${path}`, baseline.files?.[path], floors);
} catch (error) {
  fail(`scripts/coverage-baseline.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
if (existsSync(join(root, '.github/workflows/phase3-baseline.yml'))) fail('temporary Phase 3 bootstrap workflow must not remain in the repository');
if (existsSync(join(root, '.github/workflows/phase3-freeze.yml'))) fail('temporary Phase 3 final-freeze workflow must not remain in the repository');
if (existsSync(join(root, '.github/workflows/deploy.yml'))) fail('standalone Pages deployment workflow must not return; deployment is owned by certified CI');

const workflow = read('.github/workflows/ci.yml');
for (const marker of ['continue-on-error', 'if: always()', '|| true', 'set +e']) if (workflow.includes(marker)) fail(`CI workflow contains forbidden bypass marker: ${marker}`);
if (/run:\s+npm install\b/.test(workflow)) fail('CI must use npm ci rather than npm install');
if (/contents:\s*write/.test(workflow)) fail('certification workflow may not retain repository write authority');
if (/persist-credentials:\s*true/.test(workflow)) fail('certification workflow may not persist checkout credentials');
if (!workflow.includes('permissions: {}')) fail('workflow-wide GITHUB_TOKEN permissions must default to none');
const orderedCommands = ['npm run docs:check', 'npm run verify:gates', 'npm run security:check', 'npm run secrets:check', 'npm run supply-chain:check', 'npm run test:quality', 'npm ci --no-audit --no-fund', 'npm audit signatures', 'npm audit --audit-level=high', 'npm run lint', 'npm run typecheck', 'npm run typecheck:ts7', 'npm run test:coverage', 'npm run test:workers', 'npm run build', './node_modules/.bin/playwright install --with-deps chromium', 'npm run e2e -- --project=chromium --project=android-portrait --project=onboarding', 'npm run reliability:check'];
let previousIndex = -1;
for (const command of orderedCommands) {
  const index = workflow.indexOf(command, previousIndex + 1);
  if (index === -1) fail(`CI workflow is missing or reorders required command: ${command}`);
  else previousIndex = index;
}
for (const marker of ['ref: ${{ github.event.pull_request.head.sha || github.sha }}', 'persist-credentials: false', 'cancel-in-progress: true', 'needs: runtime', 'pages: write', 'id-token: write']) {
  if (!workflow.includes(marker)) fail(`CI workflow lost Phase 4 control: ${marker}`);
}

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
process.stdout.write(`Verification integrity passed: ${e2eFiles.filter((file) => file.endsWith('.spec.ts')).length} E2E specs plus unit/worker test controls checked; zero-warning lint contract pinned; TS6 and TS7 typecheck commands pinned; security, secret scanning, supply-chain, test-quality, adversarial coverage sentinel, exact 185-file whole-source coverage ratchet, immutable Actions/Node/npm controls, signed-registry and high-severity audits, exact-head checkout, and certified-before-deploy ordering pinned; no repository write authority, persisted checkout credentials, skip/focus controls, direct app-state imports, unreviewed writable IndexedDB fixtures, CI bypass markers, unreasoned lint disables, TypeScript suppressions, or reviewed-script drift detected.\n`);
