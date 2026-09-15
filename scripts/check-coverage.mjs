import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const summaryPath = resolve(root, 'coverage/coverage-summary.json');
const baselinePath = resolve(root, 'scripts/coverage-baseline.json');
const metrics = ['lines', 'statements', 'functions', 'branches'];
const errors = [];

function fail(message) { errors.push(message); }
function readJson(path, label) {
  if (!existsSync(path)) {
    fail(`missing ${label}: ${path}`);
    return null;
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    fail(`invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function percentage(covered, total) {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

function certifiedPrecision(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function checkMetrics(label, actual, floors) {
  for (const metric of metrics) {
    const floor = floors?.[metric];
    if (typeof floor !== 'number') {
      fail(`${label} is missing ${metric} coverage floor`);
      continue;
    }
    const value = actual?.[metric];
    if (typeof value !== 'number') {
      fail(`${label} is missing measured ${metric} coverage`);
      continue;
    }
    const measured = certifiedPrecision(value);
    const certifiedFloor = certifiedPrecision(floor);
    if (measured < certifiedFloor) {
      fail(`${label} ${metric} coverage regressed: ${measured.toFixed(2)}% < ${certifiedFloor.toFixed(2)}%`);
    }
  }
}

function eligibleSourceFiles(directory) {
  const absolute = join(root, directory);
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...eligibleSourceFiles(relative(root, path)));
      continue;
    }
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    files.push(relative(root, path).split(sep).join('/'));
  }
  return files;
}

const summary = readJson(summaryPath, 'coverage summary');
const baseline = readJson(baselinePath, 'coverage baseline');
if (!summary || !baseline) {
  process.stderr.write(`Coverage ratchet failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

if (baseline.version !== 1) fail(`unsupported coverage baseline version: ${String(baseline.version)}`);

const globalActual = Object.fromEntries(metrics.map((metric) => [metric, summary.total?.[metric]?.pct]));
checkMetrics('global', globalActual, baseline.global);

const sourceEntries = [];
for (const [absolutePath, value] of Object.entries(summary)) {
  if (absolutePath === 'total') continue;
  const normalized = absolutePath.split(sep).join('/');
  const marker = '/src/';
  const index = normalized.lastIndexOf(marker);
  if (index < 0) {
    fail(`coverage result is outside src/: ${absolutePath}`);
    continue;
  }
  const relativePath = `src/${normalized.slice(index + marker.length)}`;
  sourceEntries.push([relativePath, value]);
}

// V8's uncovered-file remapper has previously logged a parse warning and then
// silently omitted a valid TypeScript source file while still producing a green
// percentage. Whole-source coverage means the inventory itself is part of the
// contract: every eligible source file must appear exactly once in the report.
const expectedSource = new Set(eligibleSourceFiles('src'));
const reportedSource = new Set(sourceEntries.map(([path]) => path));
for (const path of expectedSource) {
  if (!reportedSource.has(path)) fail(`eligible source disappeared from coverage report: ${path}`);
}
for (const path of reportedSource) {
  if (!expectedSource.has(path)) fail(`coverage report contains an unexpected source entry: ${path}`);
}

for (const [directory, floors] of Object.entries(baseline.directories ?? {})) {
  const prefix = `src/${directory}/`;
  const matching = sourceEntries.filter(([path]) => path.startsWith(prefix));
  if (!matching.length) {
    fail(`coverage directory disappeared from report: ${directory}`);
    continue;
  }
  const actual = {};
  for (const metric of metrics) {
    let covered = 0;
    let total = 0;
    for (const [, value] of matching) {
      covered += value[metric]?.covered ?? 0;
      total += value[metric]?.total ?? 0;
    }
    actual[metric] = percentage(covered, total);
  }
  checkMetrics(`src/${directory}`, actual, floors);
}

const byFile = new Map(sourceEntries);
for (const [path, floors] of Object.entries(baseline.files ?? {})) {
  const value = byFile.get(path);
  if (!value) {
    fail(`critical coverage file disappeared from report: ${path}`);
    continue;
  }
  const actual = Object.fromEntries(metrics.map((metric) => [metric, value[metric]?.pct]));
  checkMetrics(path, actual, floors);
}

if (errors.length) {
  process.stderr.write(`Coverage ratchet failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

const globalText = metrics.map((metric) => `${metric}=${certifiedPrecision(globalActual[metric]).toFixed(2)}%`).join(', ');
process.stdout.write(`Coverage ratchet passed: ${globalText}; complete ${expectedSource.size}-file source inventory present; ${Object.keys(baseline.directories ?? {}).length} critical directories and ${Object.keys(baseline.files ?? {}).length} critical files remain above their certified floors.\n`);
