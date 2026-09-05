import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'README.md',
  '.nvmrc',
  'package.json',
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
  'src/persistence/gemini-api-key.ts',
  'src/persistence/gemini-api-key.test.ts',
  'src/persistence/preferences.ts',
  'src/google/tools/gemini-declarations.test.ts',
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

const providerSource = readFileSync(join(root, 'src/gemini/provider.ts'), 'utf8');
if (!providerSource.includes("from '@google/genai'")) throw new Error('Reliability gate: Gemini must execute directly from the application provider.');
if (providerSource.includes('GEMINI_WORKER_URL') || providerSource.includes('elara-gemini.cryogenized.workers.dev')) throw new Error('Reliability gate: Gemini provider must not use the Cloudflare Worker.');
if (!providerSource.includes('getGeminiApiKey')) throw new Error('Reliability gate: Gemini provider must obtain its credential through the local app Lockbox.');
if (!providerSource.includes("if (systemInstruction) payload.system_instruction = systemInstruction;")) throw new Error('Reliability gate: empty Character Master must omit system_instruction entirely.');

const markdownSource = readFileSync(join(root, 'src/app/components/MarkdownText.tsx'), 'utf8');
if (!markdownSource.includes('skipHtml')) throw new Error('Reliability gate: restricted Markdown renderer must explicitly skip raw HTML.');
if (!markdownSource.includes('safeMarkdownUrl')) throw new Error('Reliability gate: Markdown renderer must use the application safe-link boundary.');

const characterSource = readFileSync(join(root, 'src/character/system-instruction.ts'), 'utf8');
if (!characterSource.includes("export const ELARA_SYSTEM_INSTRUCTION = '';")) throw new Error('Reliability gate: no built-in Elara Character Master prompt may be shipped.');

const appSource = readFileSync(join(root, 'src/app/App.tsx'), 'utf8');
if (appSource.includes('buildCharacterInstruction')) throw new Error('Reliability gate: legacy character instruction resolver must not be used.');
if (!appSource.includes('googleGeminiFunctionNames')) throw new Error('Reliability gate: normal character turns must receive the registered Google capability surface.');
if (!appSource.includes('tools: DEFAULT_GEMINI_TOOLS')) throw new Error('Reliability gate: normal and regenerated turns must expose the canonical executable tool surface.');
if (!appSource.includes('readOnly: false')) throw new Error('Reliability gate: character tool loop must not force normal turns into read-only mode.');
if (appSource.includes('Configure it before sending a message')) throw new Error('Reliability gate: an empty Character Master must not block normal chat.');
if (appSource.includes('Configure it before regenerating')) throw new Error('Reliability gate: an empty Character Master must not block regeneration.');

const geminiDeclarationSource = readFileSync(join(root, 'src/google/tools/gemini-declarations.ts'), 'utf8');
if (geminiDeclarationSource.includes('Application tool risk:')) throw new Error('Reliability gate: tool risk policy must not be presented as competing model persona guidance.');
if (!geminiDeclarationSource.includes('description: descriptor.description')) throw new Error('Reliability gate: Gemini tool descriptions must come directly from the registered capability descriptions.');
if (!geminiDeclarationSource.includes("filter((descriptor) => descriptor.risk === 'read')")) throw new Error('Reliability gate: default conversational tool surface must only expose currently executable read capabilities.');

const vttSource = readFileSync(join(root, 'src/vtt/transformation.ts'), 'utf8');
if (vttSource.includes('buildVttTransformSystemInstruction')) throw new Error('Reliability gate: VTT must not construct a second competing system instruction.');
if (!vttSource.includes('systemInstruction: masterInstruction')) throw new Error('Reliability gate: VTT must use the Character Master System Instruction verbatim.');

const transcriptionSource = readFileSync(join(root, 'src/vtt/transcription.ts'), 'utf8');
if (transcriptionSource.includes('GEMINI_WORKER_URL') || transcriptionSource.includes('elara-gemini.cryogenized.workers.dev')) throw new Error('Reliability gate: VTT transcription must not use the Cloudflare Worker.');
if (!transcriptionSource.includes("from '@google/genai'")) throw new Error('Reliability gate: VTT transcription must use the direct Gemini SDK.');

const lockboxSource = readFileSync(join(root, 'src/persistence/gemini-api-key.ts'), 'utf8');
if (!lockboxSource.includes('import Dexie')) throw new Error('Reliability gate: Gemini API credential must use Dexie persistence.');
if (!lockboxSource.includes("this.version(1).stores({ secrets: 'id, updatedAt' })")) throw new Error('Reliability gate: Gemini API credential must use a dedicated Dexie Lockbox store.');
if (!lockboxSource.includes("name: 'PBKDF2'")) throw new Error('Reliability gate: Lockbox password must derive its encryption key with PBKDF2.');
if (!lockboxSource.includes("name: 'AES-GCM'")) throw new Error('Reliability gate: Gemini API credential must be encrypted with AES-GCM.');
if (!lockboxSource.includes('crypto.getRandomValues')) throw new Error('Reliability gate: Lockbox encryption must use random salt and IV material.');
if (lockboxSource.includes('localStorage.setItem')) throw new Error('Reliability gate: Gemini API credential must never be written to localStorage.');
if (!lockboxSource.includes('removeLegacyPlaintextKey')) throw new Error('Reliability gate: legacy plaintext Gemini API storage must be explicitly removed.');
if (!lockboxSource.includes('let unlockedApiKey: string | null = null;')) throw new Error('Reliability gate: decrypted Gemini API key must remain session-memory-only.');

const lockboxTestSource = readFileSync(join(root, 'src/persistence/gemini-api-key.test.ts'), 'utf8');
if (!lockboxTestSource.includes("Invalid Lockbox password.")) throw new Error('Reliability gate: Lockbox tests must cover wrong-password rejection.');
if (!lockboxTestSource.includes('lockGeminiApiKey')) throw new Error('Reliability gate: Lockbox tests must cover locking and clearing plaintext session state.');

const characterPersistence = readFileSync(join(root, 'src/persistence/character.ts'), 'utf8');
if (characterPersistence.includes('LEGACY_CHARACTER_SYSTEM_INSTRUCTION')) throw new Error('Reliability gate: legacy character prompt constant must be removed from persistence.');
if (characterPersistence.includes('LEGACY_DEFAULT_MARKER')) throw new Error('Reliability gate: legacy character prompt marker must be removed from persistence.');
if (!characterPersistence.includes('return value.slice(0, MAX_INSTRUCTION_LENGTH);')) throw new Error('Reliability gate: configured master prompt must be preserved without prompt substitution.');
if (!characterPersistence.includes('this.version(6)')) throw new Error('Reliability gate: character persistence must retain a current schema version after clearing the default prompt.');
if (!characterPersistence.includes("record.systemInstruction = '';")) throw new Error('Reliability gate: persisted Character Master must be clear after the default-removal migration.');

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

console.log(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24 baseline, single dexie dependency, no safety override marker, no legacy generateContent() calls, direct Gemini browser transport through the encrypted Dexie Lockbox, restricted Markdown safety boundary, no built-in Character Master prompt, direct executable tool capability exposure, no competing character resolver, singular VTT system instruction, and encrypted credential persistence contract.`);
