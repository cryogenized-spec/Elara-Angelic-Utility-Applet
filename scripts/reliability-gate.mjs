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
  'src/character/system-instruction.ts',
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

const characterSource = readFileSync(join(root, 'src/character/system-instruction.ts'), 'utf8');
if (!characterSource.includes('You are Elara, an angelic synthetic cybernetic woman and consort.')) throw new Error('Reliability gate: canonical Elara instruction must define the embodied Elara identity.');
if (!characterSource.includes('Do not voluntarily step outside it')) throw new Error('Reliability gate: canonical Elara instruction must enforce continuous character identity.');
if (!characterSource.includes('Perceive the user as the person you are directly speaking with.')) throw new Error('Reliability gate: canonical Elara instruction must define direct user perception.');
if (!characterSource.includes("After establishing your identity and perceiving the user's message through that identity")) throw new Error('Reliability gate: canonical Elara instruction must place user response after character perception.');
if (!characterSource.includes('The tools exposed by the application are capabilities available to Elara.')) throw new Error('Reliability gate: canonical Elara instruction must treat tools as character capabilities.');

const appSource = readFileSync(join(root, 'src/app/App.tsx'), 'utf8');
if (appSource.includes('buildCharacterInstruction')) throw new Error('Reliability gate: legacy character instruction resolver must not be used.');
if (!appSource.includes('googleGeminiFunctionNames')) throw new Error('Reliability gate: normal character turns must receive the registered Google capability surface.');
if (!appSource.includes('tools: DEFAULT_GEMINI_TOOLS')) throw new Error('Reliability gate: normal and regenerated turns must expose the canonical executable tool surface.');
if (!appSource.includes('readOnly: false')) throw new Error('Reliability gate: character tool loop must not force normal turns into read-only mode.');

const geminiDeclarationSource = readFileSync(join(root, 'src/google/tools/gemini-declarations.ts'), 'utf8');
if (geminiDeclarationSource.includes('Application tool risk:')) throw new Error('Reliability gate: tool risk policy must not be presented as competing model persona guidance.');
if (!geminiDeclarationSource.includes('description: descriptor.description')) throw new Error('Reliability gate: Gemini tool descriptions must come directly from the registered capability descriptions.');
if (!geminiDeclarationSource.includes("filter((descriptor) => descriptor.risk === 'read')")) throw new Error('Reliability gate: default conversational tool surface must only expose currently executable read capabilities.');

const vttSource = readFileSync(join(root, 'src/vtt/transformation.ts'), 'utf8');
if (vttSource.includes('buildVttTransformSystemInstruction')) throw new Error('Reliability gate: VTT must not construct a second competing system instruction.');
if (!vttSource.includes('systemInstruction: masterInstruction')) throw new Error('Reliability gate: VTT must use the Character Master System Instruction verbatim.');

const workerSource = readFileSync(join(root, 'worker/src/index.ts'), 'utf8');
if (!workerSource.includes('systemInstruction')) throw new Error('Reliability gate: Worker request contract must carry the application-owned character instruction.');
if (!workerSource.includes('system_instruction')) throw new Error('Reliability gate: Worker must map the character instruction to Gemini system_instruction.');
if (!workerSource.includes('tools: z.array(googleToolNameSchema).max(40).optional()')) throw new Error('Reliability gate: Worker tool-count contract must remain explicit.');
if (!workerSource.includes('stream: true') || !workerSource.includes('store: true')) throw new Error('Reliability gate: canonical Gemini streaming/store semantics must remain enabled.');

const characterPersistence = readFileSync(join(root, 'src/persistence/character.ts'), 'utf8');
if (characterPersistence.includes('LEGACY_CHARACTER_SYSTEM_INSTRUCTION')) throw new Error('Reliability gate: legacy character prompt constant must be removed from persistence.');
if (characterPersistence.includes('LEGACY_DEFAULT_MARKER')) throw new Error('Reliability gate: legacy character prompt marker must be removed from persistence.');
if (!characterPersistence.includes('return value.slice(0, MAX_INSTRUCTION_LENGTH);')) throw new Error('Reliability gate: configured master prompt must be preserved without prompt substitution.');
if (!characterPersistence.includes('this.version(4)')) throw new Error('Reliability gate: character persistence must retain a post-legacy schema version.');

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

console.log(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24 baseline, single dexie dependency, no safety override marker, no legacy generateContent() calls, one @google/genai worker import, restricted Markdown safety boundary, one embodied Elara Character Master System Instruction, direct executable tool capability exposure within the Worker contract, no competing character resolver, singular VTT system instruction, and canonical Worker streaming contract.`);
