import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const checker = resolve(root, 'scripts/check-coverage.mjs');
const sandbox = mkdtempSync(join(tmpdir(), 'elara-coverage-gate-'));
const metrics = ['lines', 'statements', 'functions', 'branches'];

function metric(pct) { return { total: 100, covered: pct, skipped: 0, pct }; }
function writeFixture(branchPct) {
  mkdirSync(join(sandbox, 'coverage'), { recursive: true });
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  writeFileSync(join(sandbox, 'coverage/coverage-summary.json'), JSON.stringify({
    total: {
      lines: metric(100),
      statements: metric(100),
      functions: metric(100),
      branches: metric(branchPct),
    },
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

  // Controlled mutation: one protected metric falls below the certified floor.
  writeFixture(99);
  const mutated = runChecker();
  if (mutated.status === 0) throw new Error('coverage checker accepted a deliberately regressed branch metric');
  if (!mutated.stderr.includes('global branches coverage regressed')) {
    throw new Error(`coverage checker failed for the wrong reason:\n${mutated.stderr || mutated.stdout}`);
  }

  process.stdout.write('Coverage gate adversarial sentinel passed: green control accepted; deliberate branch-coverage regression rejected.\n');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
