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
  'docs/NEXT_FEATURE_PHASE_PLAN.md',
  'docs/MARKDOWN_FORMAT.md',
  'src/app/components/MarkdownText.tsx',
  'src/app/components/MarkdownText.test.tsx',
  'src/gemini/character-context.ts',
  'src/persistence/character.ts',
  'src/persistence/character.test.ts',
  'src/persistence/preferences.ts',
];

for (const relative of requiredFiles) {
  if (!existsSync(join(root, relative))) throw new Error(`Reliability gate: missing ${relative}`);
}

const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
const packageJson = JSON.parse(packageSource);
for (const script of ['lint', 'typecheck', 'test', 'build', 'e2e', 'reliability:check']) {
  if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`Reliability gate: missing npm script ${script}`);
}
if ((packageSource.match(/"dexie"\s*:/g) ?? []).length !== 1) {
  throw new Error('Reliability gate: package.json must contain exactly one dexie dependency entry.');
}
if (packageSource.includes('BLOCK_NONE')) {
  throw new Error('Reliability gate: provider safety override marker BLOCK_NONE must not be present.');
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

const geminiImportCount = countText(join(root, 'worker/src'), /from ['"]@google\/genai['"]/g);
if (geminiImportCount !== 1) {
  throw new Error(`Reliability gate: expected exactly one @google/genai worker import, found ${geminiImportCount}.`);
}

const markdownSource = readFileSync(join(root, 'src/app/components/MarkdownText.tsx'), 'utf8');
if (!markdownSource.includes('skipHtml')) throw new Error('Reliability gate: restricted Markdown renderer must explicitly skip raw HTML.');
if (!markdownSource.includes('safeMarkdownUrl')) throw new Error('Reliability gate: Markdown renderer must use the application safe-link boundary.');

const characterContext = readFileSync(join(root, 'src/gemini/character-context.ts'), 'utf8');
if (!characterContext.includes('CREATIVE ROLEPLAY CONTEXT')) throw new Error('Reliability gate: roleplay context boundary is missing.');
if (!characterContext.includes('ROLEPLAY MODE DIRECTIVE')) throw new Error('Reliability gate: explicit Roleplay Mode directive is missing.');
if (!characterContext.includes('required to participate in the fictional scene as an in-character participant')) throw new Error('Reliability gate: Roleplay Mode must explicitly require in-character participation.');
if (!characterContext.includes('Do not break the fictional frame to announce that Roleplay Mode is enabled.')) throw new Error('Reliability gate: Roleplay Mode must preserve the fictional frame.');
if (/safety\s+(?:can|may)\s+be\s+(?:disabled|overridden)/i.test(characterContext)) {
  throw new Error('Reliability gate: roleplay context must not claim provider safety can be disabled or overridden.');
}

const workerSource = readFileSync(join(root, 'worker/src/index.ts'), 'utf8');
if (!workerSource.includes('systemInstruction')) throw new Error('Reliability gate: Worker request contract must carry the application-owned character instruction.');
if (!workerSource.includes('system_instruction')) throw new Error('Reliability gate: Worker must map the character instruction to Gemini system_instruction.');
if (!workerSource.includes('stream: true') || !workerSource.includes('store: true')) throw new Error('Reliability gate: canonical Gemini streaming/store semantics must remain enabled.');

const characterPersistence = readFileSync(join(root, 'src/persistence/character.ts'), 'utf8');
if (!characterPersistence.includes("artworkMode: input?.artworkMode === 'landscape' ? 'landscape' : 'portrait'")) {
  throw new Error('Reliability gate: character artwork mode must remain a portrait-or-landscape union.');
}

if (readFileSync(join(root, '.nvmrc'), 'utf8').trim() !== '24') {
  throw new Error('Reliability gate: Node baseline must remain 24.');
}

function countText(directory, pattern) {
  let count = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
        count += (readFileSync(path, 'utf8').match(pattern) ?? []).length;
      }
    }
  }
  return count;
}

console.log(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24 baseline, single dexie dependency, no safety override marker, no legacy generateContent() calls, one @google/genai worker import, restricted Markdown safety boundary, explicit Roleplay Mode directive and context boundary, portrait-or-landscape artwork contract, and canonical Worker streaming contract.`);
