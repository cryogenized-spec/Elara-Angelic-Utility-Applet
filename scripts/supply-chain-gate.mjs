import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(join(root, path), 'utf8');

const expectedNode = '24.21.0';
const expectedNpmrc = [
  'strict-allow-scripts=true',
  'allow-scripts-pin=true',
  'allow-git=none',
  'allow-remote=none',
  'allow-file=none',
];

const reviewedDirectDependencies = {
  dependencies: {
    '@google/genai': '2.21.0',
    dexie: '^4.0.0',
    'lucide-react': '1.40.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0',
    'react-markdown': '^10.1.0',
    'remark-gfm': '^4.0.1',
    'tesseract.js': '^7.0.0',
    'texlyre-busytex': '^1.4.0',
    zod: '^4.0.0',
  },
  devDependencies: {
    '@cloudflare/vitest-pool-workers': '^0.22.0',
    '@eslint/js': '^10.0.1',
    '@playwright/test': '1.62.1',
    '@types/react': '^19.0.0',
    '@types/react-dom': '^19.0.0',
    '@typescript/native': 'npm:typescript@^7.0.2',
    '@vitejs/plugin-react': '6.1.1',
    '@vitest/coverage-v8': '4.1.11',
    eslint: '10.9.1',
    'eslint-plugin-react-hooks': '^7.1.1',
    'fake-indexeddb': '^6.2.5',
    globals: '^17.12.0',
    jsdom: '30.0.1',
    typescript: 'npm:@typescript/typescript6@^6.0.2',
    'typescript-eslint': '^8.70.0',
    'vite-plugin-pwa': '1.3.0',
    vitest: '4.1.11',
    wrangler: '4.129.0',
  },
};

const reviewedInstallScripts = {
  '@google/genai': false,
  protobufjs: false,
  'tesseract.js': false,
  'esbuild@0.28.1': true,
  'workerd@1.20260815.1': true,
  'workerd@1.20260903.1': true,
};

const reviewedActions = new Set([
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346',
  'actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294',
]);

function equalRecord(actual, expected, label) {
  if (JSON.stringify(actual ?? {}) !== JSON.stringify(expected)) {
    fail(`${label} changed from the reviewed dependency capability inventory`);
  }
}

function packageNameFromLockPath(path) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  return index === -1 ? null : path.slice(index + marker.length);
}

const nvmrc = read('.nvmrc').trim();
if (nvmrc !== expectedNode) fail(`.nvmrc must pin Node exactly to ${expectedNode}; found ${nvmrc || '<empty>'}`);

const npmrcLines = read('.npmrc').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (JSON.stringify(npmrcLines) !== JSON.stringify(expectedNpmrc)) {
  fail('.npmrc must keep strict install-script and non-registry dependency controls exactly pinned');
}
if (npmrcLines.some((line) => /^(?:ignore-scripts|dangerously-allow-all-scripts)\s*=\s*true$/i.test(line))) {
  fail('.npmrc may not bypass the reviewed install-script authority');
}

const pkg = JSON.parse(read('package.json'));
equalRecord(pkg.dependencies, reviewedDirectDependencies.dependencies, 'package.json dependencies');
equalRecord(pkg.devDependencies, reviewedDirectDependencies.devDependencies, 'package.json devDependencies');
equalRecord(pkg.allowScripts, reviewedInstallScripts, 'package.json allowScripts');
if (pkg.scripts?.['supply-chain:check'] !== 'node scripts/supply-chain-gate.mjs') fail('package.json supply-chain:check command changed');
if (!pkg.scripts?.['reliability:check']?.includes('npm run supply-chain:check')) fail('final reliability command must rerun the supply-chain gate');

const lock = JSON.parse(read('package-lock.json'));
if (lock.lockfileVersion !== 3) fail(`package-lock.json must stay at lockfileVersion 3; found ${lock.lockfileVersion}`);
const rootPackage = lock.packages?.[''];
if (!rootPackage) fail('package-lock.json is missing its root package entry');
else {
  equalRecord(rootPackage.dependencies, reviewedDirectDependencies.dependencies, 'package-lock root dependencies');
  equalRecord(rootPackage.devDependencies, reviewedDirectDependencies.devDependencies, 'package-lock root devDependencies');
}

const installScriptPackages = new Set();
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  const name = packageNameFromLockPath(path);
  const version = metadata?.version;
  if (metadata?.resolved) {
    if (!metadata.resolved.startsWith('https://registry.npmjs.org/')) {
      fail(`${path} resolves outside the npm registry: ${metadata.resolved}`);
    }
    if (typeof metadata.integrity !== 'string' || !metadata.integrity.startsWith('sha512-')) {
      fail(`${path} is registry-resolved without a sha512 integrity digest`);
    }
  }
  if (metadata?.hasInstallScript === true && name && version) installScriptPackages.add(`${name}@${version}`);
}

const reviewedScriptIdentities = new Set([
  '@google/genai@2.21.0',
  'protobufjs@7.6.6',
  'tesseract.js@7.0.0',
  'esbuild@0.28.1',
  'workerd@1.20260815.1',
  'workerd@1.20260903.1',
]);
for (const identity of installScriptPackages) if (!reviewedScriptIdentities.has(identity)) fail(`unreviewed dependency install-script capability: ${identity}`);
for (const identity of reviewedScriptIdentities) if (!installScriptPackages.has(identity)) fail(`reviewed install-script package disappeared or changed version: ${identity}`);

const workflowDir = join(root, '.github/workflows');
const workflowFiles = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name)).sort();
if (workflowFiles.length !== 1 || workflowFiles[0] !== 'ci.yml') fail(`only the certified CI/release workflow may remain; found ${workflowFiles.join(', ') || '<none>'}`);

const ci = read('.github/workflows/ci.yml');
const actionUses = [...ci.matchAll(/\buses:\s*([^\s#]+)/g)].map((match) => match[1]);
for (const action of actionUses) {
  if (!/^[^\s@]+@[0-9a-f]{40}$/.test(action)) fail(`GitHub Action is not pinned to a full commit SHA: ${action}`);
  if (!reviewedActions.has(action)) fail(`GitHub Action is not in the reviewed immutable action inventory: ${action}`);
}
for (const action of reviewedActions) if (!actionUses.includes(action)) fail(`reviewed GitHub Action disappeared from CI: ${action}`);

const checkoutSha = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const checkoutCount = actionUses.filter((action) => action === checkoutSha).length;
const noPersistCount = (ci.match(/persist-credentials:\s*false/g) ?? []).length;
if (checkoutCount !== noPersistCount) fail(`every checkout must disable persisted credentials: ${checkoutCount} checkout(s), ${noPersistCount} protected block(s)`);
if (/check-latest:\s*true/.test(ci)) fail('CI may not float to the latest Node patch via check-latest');
if (/\bnpm\s+install\b/.test(ci)) fail('workflows may not use npm install; certification must use npm ci');
if (/\b(?:ignore-scripts|dangerously-allow-all-scripts)\b/.test(ci)) fail('workflows may not bypass install-script policy');

const runsOnCount = (ci.match(/^\s+runs-on:/gm) ?? []).length;
const timeoutCount = (ci.match(/^\s+timeout-minutes:/gm) ?? []).length;
if (runsOnCount !== timeoutCount) fail(`every CI job must have an explicit timeout: ${runsOnCount} job(s), ${timeoutCount} timeout(s)`);
if (!ci.includes('permissions: {}')) fail('workflow-wide GITHUB_TOKEN permissions must default to none');
if (!ci.includes('group: ci-${{ github.workflow }}-${{ github.ref }}')) fail('CI concurrency must be scoped to workflow and ref');
if (!ci.includes('cancel-in-progress: true')) fail('CI must cancel superseded runs for the same ref');

const supplyIndex = ci.indexOf('npm run supply-chain:check');
const installIndex = ci.indexOf('npm ci --no-audit --no-fund');
const auditIndex = ci.indexOf('npm audit --audit-level=high');
const reliabilityIndex = ci.indexOf('npm run reliability:check');
const pagesUploadIndex = ci.indexOf('actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9');
if (supplyIndex === -1 || installIndex === -1 || supplyIndex > installIndex) fail('supply-chain gate must execute before npm ci');
if (auditIndex === -1 || auditIndex < installIndex) fail('high-severity npm audit must execute after the locked install');
if (reliabilityIndex === -1 || pagesUploadIndex === -1 || pagesUploadIndex < reliabilityIndex) fail('Pages artifact may only be packaged after final reliability passes');
if (!ci.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")) fail('Pages artifact upload must be restricted to main push certification');
if (!ci.includes('needs: runtime')) fail('Pages deployment must depend on the certified runtime job');
if (!ci.includes('pages: write') || !ci.includes('id-token: write')) fail('Pages deploy job is missing its explicit deployment permissions');
if (!ci.includes('environment:\n      name: github-pages')) fail('Pages deployment must use the github-pages environment boundary');
if (!ci.includes("if: github.event_name == 'pull_request'")) fail('dependency review job must be PR-only');
if (!ci.includes('fail-on-severity: high')) fail('dependency review must reject newly introduced high/critical vulnerabilities');

if (!existsSync(join(root, '.github/dependabot.yml'))) fail('Dependabot configuration is required for dependency and action maintenance');
else {
  const dependabot = read('.github/dependabot.yml');
  for (const marker of ['package-ecosystem: npm', 'package-ecosystem: github-actions', 'interval: weekly']) {
    if (!dependabot.includes(marker)) fail(`Dependabot configuration lost required marker: ${marker}`);
  }
}

if (errors.length) {
  process.stderr.write(`Supply-chain gate failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Supply-chain gate passed: Node ${expectedNode} pinned; ${Object.keys(reviewedDirectDependencies.dependencies).length + Object.keys(reviewedDirectDependencies.devDependencies).length} direct dependency specs frozen; ${installScriptPackages.size} install-script packages reviewed; ${actionUses.length} GitHub Action invocations immutably pinned; lockfile registry/integrity, CI permissions/timeouts/concurrency, dependency review, Dependabot, and certified-before-deploy ordering verified.\n`);
