import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = resolve(root, 'scripts/check-coverage.mjs');
const sandbox = mkdtempSync(join(tmpdir(), 'elara-coverage-gate-'));
const metrics = ['lines', 'statements', 'functions', 'branches'];
const sourcePath = resolve(sandbox, 'src/example.ts');

function metric(pct) { return { total: 100, covered: pct, skipped: 0, pct }; }
function perfectFileCoverage() {
  return Object.fromEntries(metrics.map((name) => [name, metric(100)]));
}
function writeFixture(branchPct, includeSourceEntry = true) {
  mkdirSync(join(sandbox, 'coverage'), { recursive: true });
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  mkdirSync(join(sandbox, 'src'), { recursive: true });
  writeFileSync(sourcePath, 'export const sentinel = 1;\n');
  writeFileSync(join(sandbox, 'coverage/coverage-summary.json'), JSON.stringify({
    total: {
      lines: metric(100),
      statements: metric(100),
      functions: metric(100),
      branches: metric(branchPct),
    },
    ...(includeSourceEntry ? { [sourcePath]: perfectFileCoverage() } : {}),
  }));
  writeFileSync(join(sandbox, 'scripts/coverage-baseline.json'), JSON.stringify({
    version: 1,
    global: Object.fromEntries(metrics.map((name) => [name, 100])),
    directories: {},
    files: {},
  }));
}

function runChecker() {
  return spawnSync(process.execPath, [checker], { cwd: sandbox, encoding: 'utf8' });
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

  process.stdout.write('Coverage gate adversarial sentinel passed: green control accepted; deliberate metric regression and source-inventory disappearance rejected.\n');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
