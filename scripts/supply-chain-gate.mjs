import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const same = (actual, expected, label) => {
  if (JSON.stringify(actual ?? {}) !== JSON.stringify(expected ?? {})) fail(`${label} changed from the reviewed supply-chain baseline`);
};

const baseline = json('scripts/supply-chain-baseline.json');
const reviewedDirectDependencies = { dependencies: baseline.dependencies, devDependencies: baseline.devDependencies };
const reviewedInstallScripts = baseline.allowScripts;
const reviewedActions = new Set(baseline.actions);

if (read('.nvmrc').trim() !== baseline.node) fail(`.nvmrc must pin Node exactly to ${baseline.node}`);
const npmrc = read('.npmrc').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
same(npmrc, baseline.npmrc, '.npmrc');
if (!baseline.npmrc.includes('strict-allow-scripts=true')) fail('reviewed baseline lost strict-allow-scripts=true');
if (npmrc.some((line) => /^(?:ignore-scripts|dangerously-allow-all-scripts)\s*=\s*true$/i.test(line))) fail('.npmrc may not bypass install-script policy');

const pkg = json('package.json');
same(pkg.overrides, baseline.overrides, 'package.json security overrides');
same(pkg.dependencies, reviewedDirectDependencies.dependencies, 'package.json dependencies');
same(pkg.devDependencies, reviewedDirectDependencies.devDependencies, 'package.json devDependencies');
same(pkg.allowScripts, reviewedInstallScripts, 'package.json allowScripts');
if (pkg.scripts?.['supply-chain:check'] !== 'node scripts/supply-chain-gate.mjs') fail('package.json supply-chain:check changed');
if (!pkg.scripts?.['reliability:check']?.includes('npm run supply-chain:check')) fail('final reliability gate must rerun supply-chain policy');

const lock = json('package-lock.json');
if (lock.lockfileVersion !== 3) fail(`package-lock.json lockfileVersion must remain 3; found ${lock.lockfileVersion}`);
same(lock.packages?.['']?.dependencies, reviewedDirectDependencies.dependencies, 'package-lock root dependencies');
same(lock.packages?.['']?.devDependencies, reviewedDirectDependencies.devDependencies, 'package-lock root devDependencies');
const sharp = lock.packages?.['node_modules/sharp'];
if (sharp?.version !== baseline.overrides?.sharp) fail(`lockfile must resolve sharp to reviewed patched version ${baseline.overrides?.sharp}`);

const installScriptIdentities = new Set();
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  if (metadata?.resolved) {
    if (!metadata.resolved.startsWith('https://registry.npmjs.org/')) fail(`${path} resolves outside the npm registry`);
    if (typeof metadata.integrity !== 'string' || !metadata.integrity.startsWith('sha512-')) fail(`${path} lacks sha512 registry integrity`);
  }
  if (metadata?.hasInstallScript === true && metadata?.version) {
    const marker = 'node_modules/';
    const index = path.lastIndexOf(marker);
    if (index !== -1) installScriptIdentities.add(`${path.slice(index + marker.length)}@${metadata.version}`);
  }
}
const actualInstallScripts = [...installScriptIdentities].sort();
const expectedInstallScripts = [...baseline.installScriptIdentities].sort();
same(actualInstallScripts, expectedInstallScripts, 'reviewed install-script capability inventory');

const workflowFiles = readdirSync(join(root, '.github/workflows')).filter((name) => /\.ya?ml$/.test(name)).sort();
same(workflowFiles, ['ci.yml', 'visual-evidence.yml'], 'workflow file inventory');
const ci = read('.github/workflows/ci.yml');
const visualEvidence = read('.github/workflows/visual-evidence.yml');
const workflows = `${ci}\n${visualEvidence}`;
const actionUses = [...workflows.matchAll(/\buses:\s*([^\s#]+)/g)].map((match) => match[1]);
for (const action of actionUses) {
  if (!/^[^\s@]+@[0-9a-f]{40}$/.test(action)) fail(`GitHub Action is not pinned to a full SHA: ${action}`);
  if (!reviewedActions.has(action)) fail(`unreviewed GitHub Action authority: ${action}`);
}
for (const action of reviewedActions) if (!actionUses.includes(action)) fail(`reviewed GitHub Action disappeared: ${action}`);

const checkout = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const checkoutCount = actionUses.filter((action) => action === checkout).length;
const persistedOff = (workflows.match(/persist-credentials:\s*false/g) ?? []).length;
const exactCiRefCount = (workflows.match(/ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/g) ?? []).length;
const exactVisualRefCount = (workflows.match(/ref:\s*\$\{\{ steps\.pr\.outputs\.head_sha \}\}/g) ?? []).length;
if (checkoutCount !== persistedOff || checkoutCount !== exactCiRefCount + exactVisualRefCount) fail('every checkout must use an exact resolved SHA and persist-credentials: false');
if (!ci.includes(`test "$(node --version)" = "v${baseline.node}"`)) fail('CI must assert the exact Node runtime');
if (!ci.includes(`test "$(npm --version)" = "${baseline.npm}"`)) fail('CI must assert the exact npm runtime');
if (/check-latest:\s*true/.test(workflows)) fail('workflows may not float Node via check-latest');
if (/\bnpm\s+install\b/.test(workflows)) fail('workflows may not use npm install; use npm ci');
if (/\b(?:ignore-scripts|dangerously-allow-all-scripts)\b/.test(workflows)) fail('workflows may not bypass install-script policy');
if (workflows.includes('actions/dependency-review-action@')) fail('dependency-review action requires repository Dependency Graph and is not part of the supported CI surface');

function jobSource(source, jobName) {
  const lines = source.split(/\r?\n/);
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`);
  if (jobStart === -1) return '';
  let jobEnd = lines.length;
  for (let index = jobStart + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      jobEnd = index;
      break;
    }
  }
  return lines.slice(jobStart, jobEnd).join('\n');
}

function permissionsForJob(source, jobName) {
  const lines = source.split(/\r?\n/);
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`);
  if (jobStart === -1) return null;
  const permissionStart = lines.findIndex((line, index) => index > jobStart && line === '    permissions:');
  if (permissionStart === -1) return null;
  const result = {};
  for (let index = permissionStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^ {6}([A-Za-z0-9-]+):\s*(read|write|none)\s*$/);
    if (match) {
      result[match[1]] = match[2];
      continue;
    }
    if (/^ {4}\S/.test(line) || /^ {2}\S/.test(line) || /^\S/.test(line)) break;
  }
  return result;
}

const runtimePermissions = permissionsForJob(ci, 'runtime');
if (JSON.stringify(runtimePermissions) !== JSON.stringify({ contents: 'read' })) {
  fail('runtime verification job may not have repository write authority');
}
const visualEvidencePermissions = permissionsForJob(visualEvidence, 'capture');
if (JSON.stringify(visualEvidencePermissions) !== JSON.stringify({ contents: 'read', 'pull-requests': 'read' })) {
  fail('visual-evidence job permissions changed from the reviewed read-only minimum');
}
const deployPermissions = permissionsForJob(ci, 'deploy');
if (JSON.stringify(deployPermissions) !== JSON.stringify({ contents: 'read', pages: 'write', 'id-token': 'write' })) {
  fail('deploy job permissions changed from the reviewed minimum');
}

const runsOn = (workflows.match(/^\s+runs-on:/gm) ?? []).length;
const timeouts = (workflows.match(/^\s+timeout-minutes:/gm) ?? []).length;
if (runsOn !== timeouts) fail(`every workflow job needs an explicit timeout: ${runsOn} jobs, ${timeouts} timeouts`);
if (!ci.includes('permissions: {}') || !visualEvidence.includes('permissions: {}')) fail('workflow-wide token permissions must default to none');
if (!ci.includes('group: ci-${{ github.workflow }}-${{ github.ref }}') || !ci.includes('cancel-in-progress: true')) fail('CI concurrency policy changed');
if (!visualEvidence.includes('group: visual-evidence-pr-${{ github.event.issue.number || inputs.pr_number }}') || !visualEvidence.includes('cancel-in-progress: true')) fail('visual-evidence concurrency policy changed');

const ordered = [
  'npm run supply-chain:check',
  'npm ci --no-audit --no-fund',
  'npm audit signatures',
  'npm audit --audit-level=high',
  'npm run reliability:check',
  'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9',
];
let previous = -1;
for (const marker of ordered) {
  const index = ci.indexOf(marker, previous + 1);
  if (index === -1) fail(`CI lost required ordered control: ${marker}`);
  else previous = index;
}
if (!ci.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")) fail('Pages artifact must be main-push only');
const visualEvidenceJob = jobSource(visualEvidence, 'capture');
if (!visualEvidenceJob.includes('    name: Visual evidence')) fail('visual-evidence capture job disappeared or was renamed');
if (/^ {2}pull_request:/m.test(visualEvidence) || /^ {2}push:/m.test(visualEvidence)) fail('visual evidence must not run automatically on PR or push events');
for (const marker of [
  'workflow_dispatch:',
  'issue_comment:',
  "github.event.comment.body == '/visual-evidence'",
  "github.event.comment.author_association == 'OWNER'",
  "github.event.comment.author_association == 'MEMBER'",
  "github.event.comment.author_association == 'COLLABORATOR'",
  'gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}"',
  'ref: ${{ steps.pr.outputs.head_sha }}',
  'git worktree add --detach "$RUNNER_TEMP/elara-visual-base" "$BASE_SHA"',
  'node scripts/capture-visual-evidence.mjs',
]) {
  if (!visualEvidence.includes(marker)) fail(`visual evidence lost explicit remote-trigger control: ${marker}`);
}
const deployJob = jobSource(ci, 'deploy');
if (!deployJob.includes('    needs: runtime')) fail('Pages deploy must depend on Runtime verification');
if (!ci.includes('pages: write') || !ci.includes('id-token: write')) fail('deploy-pages job lost explicit Pages/OIDC authority');
if (!ci.includes('environment:\n      name: github-pages')) fail('deploy-pages job must use the github-pages environment');

if (!existsSync(join(root, '.github/dependabot.yml'))) fail('Dependabot configuration is required');
else {
  const dependabot = read('.github/dependabot.yml');
  for (const marker of ['package-ecosystem: npm', 'package-ecosystem: github-actions', 'interval: weekly']) if (!dependabot.includes(marker)) fail(`Dependabot lost required marker: ${marker}`);
}

if (errors.length) {
  process.stderr.write(`Supply-chain gate failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Supply-chain gate passed: Node ${baseline.node} / npm ${baseline.npm}; sharp ${baseline.overrides.sharp} security override; ${Object.keys(reviewedDirectDependencies.dependencies).length + Object.keys(reviewedDirectDependencies.devDependencies).length} direct specs; ${installScriptIdentities.size} reviewed install-script packages; ${actionUses.length} immutable Action invocations; exact least-privilege job permissions, lockfile registry/integrity, registry signatures, high-severity audit, Dependabot, exact-head certification and certified-before-deploy ordering verified.\n`);
