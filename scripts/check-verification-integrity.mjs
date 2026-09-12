import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const read = (relative) => {
  const path = join(root, relative);
  if (!existsSync(path)) {
    fail(`missing ${relative}`);
    return '';
  }
  return readFileSync(path, 'utf8');
};
const count = (source, pattern) => (source.match(pattern) ?? []).length;

const expectedSpecs = [
  'artwork.spec.ts',
  'autonomy-cloud.spec.ts',
  'autonomy.spec.ts',
  'character-runtime.spec.ts',
  'folders.spec.ts',
  'google-oauth-settings.spec.ts',
  'lockbox.spec.ts',
  'media-handoff.spec.ts',
  'mobile-reliability.spec.ts',
  'onboarding.spec.ts',
  'response-variants.spec.ts',
  'roleplay-world.spec.ts',
  'smoke.spec.ts',
  'thread-isolation.spec.ts',
  'vtt.spec.ts',
  'workspace-shortcuts.spec.ts',
];

const e2eDir = join(root, 'e2e');
const actualSpecs = existsSync(e2eDir)
  ? readdirSync(e2eDir).filter((name) => name.endsWith('.spec.ts')).sort()
  : [];
for (const expected of expectedSpecs) if (!actualSpecs.includes(expected)) fail(`expected E2E spec is missing: e2e/${expected}`);

const forbiddenTestControl = /\b(?:test|describe|test\.describe)\.(?:skip|only|fixme|fail|todo)\s*\(/;
const forbiddenSourceImport = /(?:['"`](?:\.\.\/)+src\/|['"`]\/(?:Elara-Angelic-Utility-Applet\/)?src\/)/;
const obsoleteBrowserProvider = /\*\*\/api\/gemini/;
const directWritableIndexedDb = /['"]readwrite['"]/;
const directDatabaseDeletion = /indexedDB\.deleteDatabase\s*\(/;
const allowedLocalStorageWriters = new Map([
  ['global-setup.ts', 1],
  ['google-oauth-settings.spec.ts', 1],
  ['smoke.spec.ts', 1],
]);

for (const name of [...actualSpecs, 'global-setup.ts']) {
  const relative = `e2e/${name}`;
  const source = read(relative);
  if (forbiddenTestControl.test(source)) fail(`${relative} contains a disabled/focused/expected-failure test control`);
  if (forbiddenSourceImport.test(source)) fail(`${relative} imports application source directly instead of driving a public/user boundary`);
  if (obsoleteBrowserProvider.test(source)) fail(`${relative} intercepts the retired browser /api/gemini path`);
  if (directWritableIndexedDb.test(source) || directDatabaseDeletion.test(source)) fail(`${relative} mutates IndexedDB directly; E2E may inspect storage but must not forge application state`);

  const writes = count(source, /localStorage\.setItem\s*\(/g);
  const allowedWrites = allowedLocalStorageWriters.get(name) ?? 0;
  if (writes !== allowedWrites) {
    fail(`${relative} contains ${writes} localStorage write(s); expected ${allowedWrites}. Add storage seeding only for explicit setup/migration fixtures.`);
  }
}

const globalSetup = read('e2e/global-setup.ts');
if (!globalSetup.includes("window.localStorage.setItem('elara.onboarding.completed', 'true')")) {
  fail('global E2E setup may seed only the explicit completed-onboarding fixture');
}
const oauthSpec = read('e2e/google-oauth-settings.spec.ts');
if (!oauthSpec.includes('Explicit legacy-migration seeding')) fail('Google OAuth localStorage seeding must remain explicitly scoped to migration coverage');
const smokeSpec = read('e2e/smoke.spec.ts');
if (!smokeSpec.includes("window.localStorage.setItem('elara.gemini.api-key', 'e2e-legacy-api-key')")) {
  fail('Smoke localStorage seeding must remain the explicit legacy Gemini-key migration fixture');
}

const tsconfigE2e = read('tsconfig.e2e.json');
let e2eConfig = null;
try {
  e2eConfig = JSON.parse(tsconfigE2e);
} catch (error) {
  fail(`tsconfig.e2e.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
if (e2eConfig) {
  if (e2eConfig.compilerOptions?.strict !== true || e2eConfig.compilerOptions?.noEmit !== true) fail('E2E TypeScript must remain strict and noEmit');
  if (JSON.stringify(e2eConfig.include) !== JSON.stringify(['e2e'])) fail('tsconfig.e2e.json must cover the complete e2e directory');
  if (e2eConfig.compilerOptions?.paths) fail('E2E TypeScript must not provide an application-source import alias');
  if (e2eConfig.compilerOptions?.allowImportingTsExtensions) fail('E2E TypeScript must not enable direct .ts source imports');
}

const playwright = read('playwright.config.ts');
for (const project of ["name: 'chromium'", "name: 'android-portrait'", "name: 'onboarding'"]) {
  if (!playwright.includes(project)) fail(`Playwright configuration is missing ${project}`);
}
if (!playwright.includes("globalSetup: './e2e/global-setup.ts'")) fail('Playwright must use the explicit E2E global setup');
if (!playwright.includes('testIgnore: /mobile-reliability\\.spec\\.ts|onboarding\\.spec\\.ts/')) fail('Chromium project coverage changed; review the E2E routing explicitly');
if (!playwright.includes('testMatch: /(?:mobile-reliability|vtt|media-handoff)\\.spec\\.ts/')) fail('Android-portrait project coverage changed; review it explicitly');
if (!playwright.includes('testMatch: /onboarding\\.spec\\.ts/')) fail('Onboarding project must remain isolated');
if (!playwright.includes('storageState: { cookies: [], origins: [] }')) fail('Onboarding project must start from clean browser storage');
if (!playwright.includes('reuseExistingServer: !process.env.CI')) fail('CI must not reuse a pre-existing Playwright web server');

const packageSource = read('package.json');
let packageJson = null;
try {
  packageJson = JSON.parse(packageSource);
} catch (error) {
  fail(`package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
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
if (packageJson) {
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== expected) fail(`npm script ${name} changed from the reviewed command`);
  }
}

const workflow = read('.github/workflows/ci.yml');
for (const bypass of ['continue-on-error', 'if: always()', '|| true']) {
  if (workflow.includes(bypass)) fail(`CI workflow contains forbidden bypass marker: ${bypass}`);
}
const orderedCommands = [
  'npm run docs:check',
  'npm run verify:gates',
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run test:workers',
  'npm run build',
  'npx playwright install --with-deps chromium',
  'npm run e2e -- --project=chromium --project=android-portrait --project=onboarding',
  'npm run reliability:check',
];
let lastIndex = -1;
for (const command of orderedCommands) {
  const index = workflow.indexOf(command, lastIndex + 1);
  if (index === -1) fail(`CI workflow is missing or reorders required command: ${command}`);
  else lastIndex = index;
}
if (!workflow.includes('permissions:\n  contents: read')) fail('CI permissions must remain read-only at repository scope');

if (errors.length) {
  process.stderr.write(`Verification integrity failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Verification integrity passed: ${actualSpecs.length} E2E specs checked; no skip/focus controls, direct app-state imports, obsolete browser provider route, writable IndexedDB fixtures, CI bypass markers, or reviewed-script drift detected.\n`);
