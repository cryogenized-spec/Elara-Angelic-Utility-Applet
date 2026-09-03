import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'README.md',
  '.nvmrc',
  'package.json',
  'tsconfig.json',
  'docs/ARCHITECTURE_DECISION.md',
  'docs/SYSTEM_BOUNDARIES.md',
  'docs/GEMINI_INTEGRATION_STRATEGY.md',
  'docs/GEMINI_REQUEST_CONTRACT.md',
  'docs/PROVIDER_ERROR_NORMALIZATION.md',
  'docs/GOOGLE_OAUTH_ARCHITECTURE.md',
  'docs/GOOGLE_SCOPE_REGISTRY.md',
  'docs/GOOGLE_CALENDAR_SERVICE.md',
  'docs/GOOGLE_TASKS_SERVICE.md',
  'docs/GOOGLE_GMAIL_SERVICE.md',
  'docs/GOOGLE_TOOL_BOUNDARY.md',
  'docs/GOOGLE_WRITE_CONFIRMATION.md',
  'docs/GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md',
  'docs/GEMINI_BACKGROUND_EXECUTION.md',
];

for (const relative of requiredFiles) {
  if (!existsSync(join(root, relative))) throw new Error(`Reliability gate: missing ${relative}`);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const script of ['lint', 'typecheck', 'test', 'build', 'e2e']) {
  if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`Reliability gate: missing npm script ${script}`);
}

const forbiddenProviderApis = /generateContent\s*\(/g;
const stack = [join(root, 'src')];
while (stack.length) {
  const current = stack.pop();
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) stack.push(path);
    if (!entry.isFile() || !/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue;
    const source = readFileSync(path, 'utf8');
    if (forbiddenProviderApis.test(source)) throw new Error(`Reliability gate: forbidden legacy Gemini API in ${path}`);
    forbiddenProviderApis.lastIndex = 0;
  }
}

if (readFileSync(join(root, '.nvmrc'), 'utf8').trim() !== '24') {
  throw new Error('Reliability gate: Node baseline must remain 24.');
}

console.log(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24 baseline, and no legacy generateContent() calls in src.`);
