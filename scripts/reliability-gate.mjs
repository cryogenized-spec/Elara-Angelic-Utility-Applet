import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'README.md', '.nvmrc', 'package.json',
  'docs/ARCHITECTURE_DECISION.md', 'docs/SYSTEM_BOUNDARIES.md', 'docs/GEMINI_INTEGRATION_STRATEGY.md', 'docs/GEMINI_REQUEST_CONTRACT.md', 'docs/PROVIDER_ERROR_NORMALIZATION.md',
  'docs/GOOGLE_OAUTH_ARCHITECTURE.md', 'docs/GOOGLE_SCOPE_REGISTRY.md', 'docs/GOOGLE_CALENDAR_SERVICE.md', 'docs/GOOGLE_TASKS_SERVICE.md', 'docs/GOOGLE_GMAIL_SERVICE.md', 'docs/GOOGLE_TOOL_BOUNDARY.md', 'docs/GOOGLE_WRITE_CONFIRMATION.md', 'docs/GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md', 'docs/GEMINI_BACKGROUND_EXECUTION.md',
  'docs/NEXT_FEATURE_PHASE_PLAN.md', 'docs/MARKDOWN_FORMAT.md', 'docs/ROLEPLAY_WORLD_CANVAS_PLAN.md',
  'src/app/components/MarkdownText.tsx', 'src/app/components/MarkdownText.test.tsx', 'src/app/components/RoleplaySettings.tsx',
  'src/character/system-instruction.ts', 'src/persistence/character.ts', 'src/persistence/character.test.ts', 'src/persistence/gemini-api-key.ts', 'src/persistence/gemini-api-key.test.ts', 'src/persistence/preferences.ts', 'src/persistence/roleplay-world.ts',
  'src/domain/roleplay-world.ts', 'src/domain/roleplay-world.test.ts',
  'src/gemini/runtime-context.ts', 'src/google/confirmation/broker.ts', 'src/google/confirmation/roleplay-broker.ts', 'src/google/tools/roleplay-world-schemas.ts', 'src/google/tools/roleplay-world-handlers.ts', 'src/google/tools/gemini-declarations.test.ts',
  'e2e/roleplay-world.spec.ts',
];

for (const relative of requiredFiles) if (!existsSync(join(root, relative))) throw new Error(`Reliability gate: missing ${relative}`);

const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
const packageJson = JSON.parse(packageSource);
for (const script of ['lint', 'typecheck', 'test', 'build', 'e2e', 'reliability:check']) if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`Reliability gate: missing npm script ${script}`);
if ((packageSource.match(/\"dexie\"\s*:/g) ?? []).length !== 1) throw new Error('Reliability gate: package.json must contain exactly one dexie dependency entry.');
if (packageSource.includes('BLOCK_NONE')) throw new Error('Reliability gate: provider safety override marker BLOCK_NONE must not be present.');

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
if (!providerSource.includes('request.results')) throw new Error('Reliability gate: Gemini tool-result continuation must support grouped results.');

const markdownSource = readFileSync(join(root, 'src/app/components/MarkdownText.tsx'), 'utf8');
if (!markdownSource.includes('skipHtml')) throw new Error('Reliability gate: restricted Markdown renderer must explicitly skip raw HTML.');
if (!markdownSource.includes('safeMarkdownUrl')) throw new Error('Reliability gate: Markdown renderer must use the application safe-link boundary.');

const characterSource = readFileSync(join(root, 'src/character/system-instruction.ts'), 'utf8');
if (!characterSource.includes("export const ELARA_SYSTEM_INSTRUCTION = '';")) throw new Error('Reliability gate: no built-in Elara Character Master prompt may be shipped.');

const appSource = readFileSync(join(root, 'src/app/App.tsx'), 'utf8');
if (appSource.includes('buildCharacterInstruction')) throw new Error('Reliability gate: legacy character instruction resolver must not be used.');
if (!appSource.includes('googleGeminiFunctionNames')) throw new Error('Reliability gate: normal character turns must receive the registered capability surface.');
if (!appSource.includes('tools: DEFAULT_GEMINI_TOOLS')) throw new Error('Reliability gate: normal and regenerated turns must expose the canonical executable tool surface.');
if (!appSource.includes('readOnly: false')) throw new Error('Reliability gate: character tool loop must not force normal turns into read-only mode.');
if (appSource.includes('Configure it before sending a message')) throw new Error('Reliability gate: an empty Character Master must not block normal chat.');
if (appSource.includes('Configure it before regenerating')) throw new Error('Reliability gate: an empty Character Master must not block regeneration.');

const geminiDeclarationSource = readFileSync(join(root, 'src/google/tools/gemini-declarations.ts'), 'utf8');
if (geminiDeclarationSource.includes('Application tool risk:')) throw new Error('Reliability gate: tool risk policy must not be presented as competing model persona guidance.');
if (!geminiDeclarationSource.includes('description: descriptor.description')) throw new Error('Reliability gate: Gemini tool descriptions must come directly from the registered capability descriptions.');
if (!geminiDeclarationSource.includes('googleToolRegistry.map')) throw new Error('Reliability gate: Gemini declarations must derive from the canonical executable tool registry.');
if (!geminiDeclarationSource.includes("additionalProperties: false")) throw new Error('Reliability gate: Gemini tool arguments must reject undeclared properties.');
if (!geminiDeclarationSource.includes("'calendar.createEvent'")) throw new Error('Reliability gate: Calendar write capability must remain model-executable.');

const roleplayWorldSource = readFileSync(join(root, 'src/google/tools/roleplay-world-handlers.ts'), 'utf8');
if (!roleplayWorldSource.includes('loadRoleplayPreferences')) throw new Error('Reliability gate: Roleplay world tools must respect Roleplay Mode state.');
if (!roleplayWorldSource.includes('crypto.subtle.digest')) throw new Error('Reliability gate: Roleplay entity refs must use cryptographic digest material.');
const roleplayBrokerSource = readFileSync(join(root, 'src/google/confirmation/roleplay-broker.ts'), 'utf8');
if (!roleplayBrokerSource.includes('requestGoogleToolConfirmation')) throw new Error('Reliability gate: Roleplay mutations must use the shared Google confirmation broker.');
const googleBrokerSource = readFileSync(join(root, 'src/google/confirmation/broker.ts'), 'utf8');
if (!googleBrokerSource.includes('requestGoogleToolConfirmations')) throw new Error('Reliability gate: Google mutations must support grouped confirmation requests.');
if (!googleBrokerSource.includes('data-decision="accept"') || !googleBrokerSource.includes('data-decision="decline"')) throw new Error('Reliability gate: Google mutations must expose explicit user confirmation controls.');
if (!googleBrokerSource.includes('aria-label')) throw new Error('Reliability gate: Google confirmation controls must be accessible.');
const toolLoopSource = readFileSync(join(root, 'src/gemini/google-tool-loop.ts'), 'utf8');
if (!toolLoopSource.includes('requestGoogleToolConfirmations')) throw new Error('Reliability gate: Google tool loop must route mutation batches through the shared confirmation broker.');
if (!toolLoopSource.includes('results:')) throw new Error('Reliability gate: Google tool loop must return grouped tool results to Gemini.');
const executorSource = readFileSync(join(root, 'src/google/tools/executor.ts'), 'utf8');
if (!executorSource.includes('requestGoogleToolConfirmation')) throw new Error('Reliability gate: direct Google tool execution must retain the shared confirmation broker.');
if (!executorSource.includes('confirmationRequestForCall')) throw new Error('Reliability gate: Google executor must expose safe confirmation request derivation for batched mutations.');
const calendarServiceSource = readFileSync(join(root, 'src/google/calendar/service.ts'), 'utf8');
if (!calendarServiceSource.includes("authorize('calendar.events.write')")) throw new Error('Reliability gate: Calendar writes must use the dedicated write capability.');
const calendarHandlerSource = readFileSync(join(root, 'src/google/tools/service-handlers.ts'), 'utf8');
if (!calendarHandlerSource.includes("'calendar.createEvent'")) throw new Error('Reliability gate: Calendar write handler must be registered.');
const worldSource = readFileSync(join(root, 'src/domain/roleplay-world.ts'), 'utf8');
if (!worldSource.includes('serializeRoleplayWorldYaml')) throw new Error('Reliability gate: Roleplay World must have a deterministic YAML view.');
if (worldSource.includes('ref: ${yamlScalar(entity.ref)}')) throw new Error('Reliability gate: opaque Roleplay refs must remain hidden from visible YAML.');

const vttSource = readFileSync(join(root, 'src/vtt/transformation.ts'), 'utf8');
const composerSource = readFileSync(join(root, 'src/app/components/Composer.tsx'), 'utf8');
if (vttSource.includes('buildVttTransformSystemInstruction')) throw new Error('Reliability gate: VTT must not construct a second competing system instruction.');
if (!vttSource.includes('systemInstruction: options?.systemInstruction')) throw new Error('Reliability gate: VTT transformation must forward its supplied Character Master instruction verbatim.');
if (!composerSource.includes('transformVttTranscript(transcript, vttTransformMode, { model: geminiModel, signal: controller.signal, systemInstruction })')) throw new Error('Reliability gate: Composer must pass the active Character Master instruction into VTT transformation.');

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
if (!lockboxTestSource.includes('Invalid Lockbox password.')) throw new Error('Reliability gate: Lockbox tests must cover wrong-password rejection.');
if (!lockboxTestSource.includes('lockGeminiApiKey')) throw new Error('Reliability gate: Lockbox tests must cover locking and clearing plaintext session state.');

const characterPersistence = readFileSync(join(root, 'src/persistence/character.ts'), 'utf8');
if (characterPersistence.includes('LEGACY_CHARACTER_SYSTEM_INSTRUCTION')) throw new Error('Reliability gate: legacy character prompt constant must be removed from persistence.');
if (characterPersistence.includes('LEGACY_DEFAULT_MARKER')) throw new Error('Reliability gate: legacy character prompt marker must be removed from persistence.');
if (!characterPersistence.includes('return value.slice(0, MAX_INSTRUCTION_LENGTH);')) throw new Error('Reliability gate: configured master prompt must be preserved without prompt substitution.');
if (!characterPersistence.includes('this.version(6)')) throw new Error('Reliability gate: character persistence must retain a current schema version after clearing the default prompt.');
if (!characterPersistence.includes("record.systemInstruction = '';")) throw new Error('Reliability gate: persisted Character Master must be clear after the default-removal migration.');

if (readFileSync(join(root, '.nvmrc'), 'utf8').trim() !== '24') throw new Error('Reliability gate: Node baseline must remain 24.');

console.log(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24 baseline, single dexie dependency, no safety override marker, no legacy generateContent() calls, direct Gemini browser transport through the encrypted Dexie Lockbox, restricted Markdown safety boundary, no built-in Character Master prompt, canonical executable tool capability exposure including Roleplay World, single VTT system instruction, opaque Roleplay refs, shared Google mutation watchdog with grouped confirmation and grouped Gemini tool results, Calendar event creation, deterministic YAML view, and encrypted credential persistence contract.`);
