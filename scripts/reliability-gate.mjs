import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'README.md', '.nvmrc', 'package.json',
  'docs/ARCHITECTURE_DECISION.md', 'docs/SYSTEM_BOUNDARIES.md', 'docs/GEMINI_INTEGRATION_STRATEGY.md', 'docs/GEMINI_REQUEST_CONTRACT.md', 'docs/PROVIDER_ERROR_NORMALIZATION.md',
  'docs/GOOGLE_OAUTH_ARCHITECTURE.md', 'docs/GOOGLE_SCOPE_REGISTRY.md', 'docs/GOOGLE_CALENDAR_SERVICE.md', 'docs/GOOGLE_TASKS_SERVICE.md', 'docs/GOOGLE_GMAIL_SERVICE.md', 'docs/GOOGLE_TOOL_BOUNDARY.md', 'docs/GOOGLE_WRITE_CONFIRMATION.md', 'docs/GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md', 'docs/GEMINI_BACKGROUND_EXECUTION.md',
  'docs/NEXT_FEATURE_PHASE_PLAN.md', 'docs/MARKDOWN_FORMAT.md', 'docs/ROLEPLAY_WORLD_CANVAS_PLAN.md', 'docs/ARTIFACT_SYSTEM.md', 'public/core/README.md',
  'src/artifacts/repository.ts', 'src/artifacts/validation.ts', 'src/artifacts/image-preprocessing.ts', 'src/artifacts/intake.ts', 'src/artifacts/transformations.ts', 'src/artifacts/repository.test.ts', 'src/gemini/multimodal.test.ts', 'src/app/components/artifacts/GeneratedTextCard.tsx', 'src/app/components/artifacts/GeneratedTextCard.test.tsx', 'src/ocr/service.ts', 'src/ocr/worker.ts', 'src/documents/compiler.ts', 'src/documents/compiler.worker.ts', 'scripts/verify-artifact-assets.mjs',
  'src/app/components/MarkdownText.tsx', 'src/app/components/MarkdownText.test.tsx', 'src/app/components/RoleplaySettings.tsx',
  'src/character/system-instruction.ts', 'src/persistence/character.ts', 'src/persistence/character.test.ts', 'src/persistence/gemini-api-key.ts', 'src/persistence/gemini-api-key.test.ts', 'src/persistence/preferences.ts', 'src/persistence/roleplay-world.ts',
  'src/domain/roleplay-world.ts', 'src/domain/roleplay-world.test.ts',
  'src/gemini/runtime-context.ts', 'src/google/confirmation/broker.ts', 'src/google/confirmation/roleplay-broker.ts', 'src/google/tools/roleplay-world-schemas.ts', 'src/google/tools/roleplay-world-handlers.ts', 'src/google/tools/gemini-declarations.test.ts',
  'src/autonomy/contracts.ts', 'src/autonomy/schedule.ts', 'src/autonomy/policy.ts', 'src/autonomy/outcome.ts', 'src/autonomy/authority.ts', 'src/autonomy/instruction.ts', 'src/autonomy/runner.ts', 'src/autonomy/runner.test.ts', 'src/autonomy/tool-surface.test.ts', 'src/persistence/autonomy.ts', 'src/persistence/autonomy.test.ts', 'src/app/components/AutonomySettings.tsx', 'src/gemini/google-tool-loop.readonly.test.ts',
  'src/autonomy/scheduler.ts', 'src/autonomy/scheduler.test.ts', 'src/autonomy/context.ts', 'src/autonomy/context.test.ts', 'src/autonomy/protocol.ts', 'src/autonomy/protocol.test.ts',
  'src/autonomy/cloud/pairing.ts', 'src/autonomy/cloud/pairing.test.ts', 'src/autonomy/cloud/client.ts', 'src/autonomy/cloud/sync.ts', 'src/autonomy/cloud/sync.test.tsx', 'src/app/components/AutonomyCloud.tsx',
  'worker/src/autonomy/ports.ts', 'worker/src/autonomy/store.ts', 'worker/src/autonomy/engine.ts', 'worker/src/autonomy/routes.ts', 'worker/src/autonomy/workflow.ts', 'src/autonomy/workflow-identity.ts', 'src/autonomy/envelope.ts', 'worker/test/autonomy-engine.test.ts', 'worker/test/autonomy-http.test.ts', 'worker/test/helpers.ts', 'vitest.workers.config.ts',
  'scripts/verify-autonomy-worker.mjs', 'docs/AUTONOMOUS_ELARA.md', 'e2e/autonomy-cloud.spec.ts',
  'e2e/roleplay-world.spec.ts', 'e2e/autonomy.spec.ts',
];

for (const relative of requiredFiles) if (!existsSync(join(root, relative))) throw new Error(`Reliability gate: missing ${relative}`);

const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
const packageJson = JSON.parse(packageSource);
for (const script of ['lint', 'typecheck', 'test', 'test:workers', 'build', 'e2e', 'reliability:check', 'verify:artifact-assets']) if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`Reliability gate: missing npm script ${script}`);
if ((packageSource.match(/\"dexie\"\s*:/g) ?? []).length !== 1) throw new Error('Reliability gate: package.json must contain exactly one dexie dependency entry.');
if (packageSource.includes('BLOCK_NONE')) throw new Error('Reliability gate: provider safety override marker BLOCK_NONE must not be present.');
for (const font of ['Inter-latin.woff2', 'Manrope-latin.woff2', 'Outfit-latin.woff2']) {
  if (!existsSync(join(root, 'src', 'ui', 'generated-fonts', font))) throw new Error(`Reliability gate: missing bundled font asset ${font}.`);
}
if (!packageJson.dependencies?.['tesseract.js'] || !packageJson.dependencies?.['texlyre-busytex']) throw new Error('Reliability gate: local OCR and document compiler dependencies must remain explicit.');

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

const domainRoot = join(root, 'src', 'domain');
const forbiddenDomainDependencies = /@google\/genai|gemini|tesseract|busytex|lualatex|ocr|google\/oauth|drive/i;
for (const entry of readdirSync(domainRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
  const source = readFileSync(join(domainRoot, entry.name), 'utf8');
  const imports = source.split('\n').filter((line) => /^\s*(?:import|export).*from\s+['"]/.test(line)).join('\n');
  if (forbiddenDomainDependencies.test(imports)) throw new Error(`Reliability gate: domain module imports provider/compiler/OCR concerns in ${entry.name}.`);
}
const artifactRepositorySource = readFileSync(join(root, 'src/artifacts/repository.ts'), 'utf8');
if (!artifactRepositorySource.includes('ArrayBuffer') || !artifactRepositorySource.includes('canonicalBlob')) throw new Error('Reliability gate: artifact persistence must hydrate binary storage at the repository boundary.');
if (artifactRepositorySource.includes('artifactFromStored(item, new Blob())') || !artifactRepositorySource.includes('ARTIFACT_STORAGE_FAILED')) throw new Error('Reliability gate: artifact reads must report missing/corrupt payloads instead of silently repairing them.');
const compilerWorkerSource = readFileSync(join(root, 'src/documents/compiler.worker.ts'), 'utf8');
if (!compilerWorkerSource.includes('shellEscape: false')) throw new Error('Reliability gate: browser document compilation must disable shell escape.');
const providerSource = readFileSync(join(root, 'src/gemini/provider.ts'), 'utf8');
if (!providerSource.includes("from '@google/genai'")) throw new Error('Reliability gate: Gemini must execute directly from the application provider.');
if (providerSource.includes('GEMINI_WORKER_URL') || providerSource.includes('elara-gemini.cryogenized.workers.dev')) throw new Error('Reliability gate: Gemini provider must not use the Cloudflare Worker.');
if (!providerSource.includes('getGeminiApiKey')) throw new Error('Reliability gate: Gemini provider must obtain its credential through the local app Lockbox.');
if (!providerSource.includes("httpOptions: { apiVersion: 'v1', retryOptions: { attempts: 1 } }")) throw new Error('Reliability gate: Gemini Interactions must use the stable v1 API through SDK httpOptions.');
if (providerSource.includes("apiKey, apiVersion: 'v1'")) throw new Error('Reliability gate: Gemini API version must not be configured through the obsolete top-level SDK option.');
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
const promptWarningSource = readFileSync(join(root, 'src/app/components/MasterPromptWarning.tsx'), 'utf8');
if (promptWarningSource.includes('setInterval') || promptWarningSource.includes('loadCharacterProfile')) throw new Error('Reliability gate: Master Prompt warning must derive from App state without a hidden polling loop.');

const geminiDeclarationSource = readFileSync(join(root, 'src/google/tools/gemini-declarations.ts'), 'utf8');
if (geminiDeclarationSource.includes('Application tool risk:')) throw new Error('Reliability gate: tool risk policy must not be presented as competing model persona guidance.');
if (!geminiDeclarationSource.includes('description: descriptor.description')) throw new Error('Reliability gate: Gemini tool descriptions must come directly from the registered capability descriptions.');
if (!geminiDeclarationSource.includes('googleToolRegistry')) throw new Error('Reliability gate: Gemini declarations must derive from the canonical executable tool registry.');
if (!geminiDeclarationSource.includes("exposure === 'gemini'")) throw new Error('Reliability gate: Gemini declarations must exclude internal adapter primitives.');
if (!geminiDeclarationSource.includes("additionalProperties: false")) throw new Error('Reliability gate: Gemini tool arguments must reject undeclared properties.');
if (!geminiDeclarationSource.includes("'calendar.createEvent'")) throw new Error('Reliability gate: Calendar write capability must remain model-executable.');

const roleplayWorldSource = readFileSync(join(root, 'src/google/tools/roleplay-world-handlers.ts'), 'utf8');
if (!roleplayWorldSource.includes('loadRoleplayPreferences')) throw new Error('Reliability gate: Roleplay world tools must respect Roleplay Mode state.');
if (!roleplayWorldSource.includes('crypto.subtle.digest')) throw new Error('Reliability gate: Roleplay entity refs must use cryptographic digest material.');
const roleplayBrokerSource = readFileSync(join(root, 'src/google/confirmation/roleplay-broker.ts'), 'utf8');
if (!roleplayBrokerSource.includes('requestGoogleToolConfirmation')) throw new Error('Reliability gate: Roleplay mutations must use the shared Google confirmation broker.');
const googleBrokerSource = readFileSync(join(root, 'src/google/confirmation/broker.ts'), 'utf8');
if (!googleBrokerSource.includes('requestGoogleToolConfirmations')) throw new Error('Reliability gate: Google mutations must support grouped confirmation requests.');
if (!googleBrokerSource.includes('data-decision="decline"') || (!googleBrokerSource.includes('data-decision="selected"') && !googleBrokerSource.includes('data-decision="all"'))) throw new Error('Reliability gate: Google mutations must expose explicit decline and approval controls.');
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


// ---------------------------------------------------------------------------
// Phase B invariants (Autonomous Elara design §4.4, §7, §8, §10): the cloud
// scheduler architecture is enforced automatically, not by convention.
// ---------------------------------------------------------------------------

const workerSourceFiles = [];
const workerStack = [join(root, 'worker', 'src')];
while (workerStack.length) {
  const current = workerStack.pop();
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) workerStack.push(path);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) workerSourceFiles.push(path);
  }
}

// Worker runtime must never import the browser memory store, browser
// persistence, or the browser Google OAuth authority (design §8/§10/§11).
const forbiddenWorkerImports = /memory\/store|persistence\/|google\/oauth|retrieveMemories|dexie/i;
for (const path of workerSourceFiles) {
  const source = readFileSync(path, 'utf8');
  const importLines = source.split('\n').filter((line) => /^\s*(?:import|export)\s.*from\s+['"]/.test(line) || /^\s*import\s+['"]/.test(line)).join('\n');
  if (forbiddenWorkerImports.test(importLines)) throw new Error(`Reliability gate: worker module must not import browser-only concerns (memory store / persistence / OAuth / Dexie): ${path}`);
  // No server-side Google credentials or OAuth exchange anywhere in the worker.
  if (/accounts\.google\.com|googleapis\.com\/oauth|refresh_token|authorization.?code/i.test(source)) throw new Error(`Reliability gate: server-side Google OAuth markers must not appear in worker code: ${path}`);
  if (/from ['"]agents['"]|@cloudflare\/agents/.test(source)) throw new Error(`Reliability gate: Agents SDK must not appear: ${path}`);
  if (/cloudflare:workflows/.test(source)) throw new Error(`Reliability gate: do not import cloudflare:workflows (${path}); bind Workflows via wrangler.`);
  // No Web Push before Phase D.
  if (/vapid|web-push|pushManager|PushSubscription/i.test(source)) throw new Error(`Reliability gate: Web Push must not appear before Phase D: ${path}`);
}
if (packageSource.includes('"agents"') || packageJson.dependencies?.agents || packageJson.devDependencies?.agents) throw new Error('Reliability gate: the Agents SDK dependency is deliberately not adopted (design §7.4).');

// The scheduler seam exists and names its contracts.
const portsSource = readFileSync(join(root, 'worker', 'src', 'autonomy', 'ports.ts'), 'utf8');
if (!portsSource.includes('interface WakeSource') || !portsSource.includes('interface SchedulerPort')) throw new Error('Reliability gate: the WakeSource/SchedulerPort seam must be declared in worker/src/autonomy/ports.ts.');
if (!portsSource.includes("kind: 'cron-trigger'")) throw new Error('Reliability gate: the production wake source must be the cron trigger.');
const engineSource = readFileSync(join(root, 'worker', 'src', 'autonomy', 'engine.ts'), 'utf8');
for (const portOperation of ['ensureScheduled', 'cancel(', 'dueWithin']) {
  if (!engineSource.includes(portOperation)) throw new Error(`Reliability gate: the AutonomyEngine Durable Object must implement the SchedulerPort surface (${portOperation}).`);
}
if (!engineSource.includes('decideRunClaim')) throw new Error('Reliability gate: the DO claim path must use the shared pure decideRunClaim decision.');

// The cron handler is a heartbeat only: no agent execution, no provider calls.
const workerEntrySource = readFileSync(join(root, 'worker', 'src', 'index.ts'), 'utf8');
const scheduledMatch = workerEntrySource.match(/async scheduled\([\s\S]*?\n  \},/);
if (!scheduledMatch) throw new Error('Reliability gate: the worker must export a scheduled() cron handler.');
const scheduledBody = scheduledMatch[0];
for (const forbidden of ['gemini', 'Gemini', 'streamGoogleToolLoop', 'GoogleGenAI', 'routine', 'engine.fetch']) {
  if (scheduledBody.includes(forbidden)) throw new Error(`Reliability gate: the cron handler must remain a heartbeat (found "${forbidden}" in scheduled()).`);
}
if (!scheduledBody.includes('heartbeat')) throw new Error('Reliability gate: the cron handler must invoke the scheduler heartbeat.');

// No public wake endpoint, ever.
for (const wakeRoute of ["'/autonomy/wake'", '"/autonomy/wake"', "'/autonomy/heartbeat'", '"/autonomy/heartbeat"']) {
  if (workerEntrySource.includes(wakeRoute)) throw new Error('Reliability gate: no public wake endpoint may exist.');
}

// Exactly one coarse cron trigger, hourly.
const wranglerSource = readFileSync(join(root, 'worker', 'wrangler.toml'), 'utf8');
const crons = wranglerSource.match(/crons\s*=\s*\[([^\]]*)\]/);
if (!crons || crons[1].split(',').filter((entry) => entry.trim()).length !== 1 || !crons[1].includes('0 * * * *')) throw new Error('Reliability gate: the worker must carry exactly one hourly cron trigger.');
if (!wranglerSource.includes('new_sqlite_classes') || !wranglerSource.includes('AutonomyEngine')) throw new Error('Reliability gate: the AutonomyEngine Durable Object must be declared with SQLite storage.');
if (!wranglerSource.includes('class_name = "RoutineRunWorkflow"') || !wranglerSource.includes('binding = "ROUTINE_RUN"')) throw new Error('Reliability gate: wrangler must declare the RoutineRun Workflow binding.');
const workflowSource = readFileSync(join(root, 'worker', 'src', 'autonomy', 'workflow.ts'), 'utf8');
if (!workflowSource.includes('class RoutineRunWorkflow') || !workflowSource.includes('WorkflowEntrypoint')) throw new Error('Reliability gate: RoutineRunWorkflow must be a WorkflowEntrypoint.');
if (!engineSource.includes('completeClaim') || !engineSource.includes('dispatchWorkflow')) throw new Error('Reliability gate: the DO must claim then dispatch a Workflow.');

// The shared scheduler domain stays pure (no Cloudflare, browser, or provider imports).
const allowedSchedulerImports = /^\s*(?:import|export)\s.*from\s+['"](?:zod|\.\/contracts|\.\/schedule|\.\.\/memory\/retrieval|\.\.\/memory\/types)['"];?\s*$/;
for (const shared of ['src/autonomy/scheduler.ts', 'src/autonomy/context.ts']) {
  const source = readFileSync(join(root, shared), 'utf8');
  for (const line of source.split('\n')) {
    if (/^\s*(?:import|export)\s.*from\s+['"]/.test(line) && !allowedSchedulerImports.test(line)) {
      throw new Error(`Reliability gate: shared scheduler module ${shared} must stay pure (unexpected import: ${line.trim()}).`);
    }
  }
}

if (readFileSync(join(root, '.nvmrc'), 'utf8').trim() !== '24') throw new Error('Reliability gate: Node baseline must remain 24.');

process.stdout.write(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24 baseline, single dexie dependency, no safety override marker, no legacy generateContent() calls, direct Gemini browser transport through the encrypted Dexie Lockbox, restricted Markdown safety boundary, no built-in Character Master prompt, canonical executable tool capability exposure including Roleplay World, single VTT system instruction, opaque Roleplay refs, shared Google mutation watchdog with grouped confirmation and grouped Gemini tool results, Calendar event creation, deterministic YAML view, and encrypted credential persistence contract, plus the Phase B scheduler invariants: SchedulerPort/WakeSource seam, DO single-alarm scheduler with shared pure due-time truth, heartbeat-only cron, no public wake endpoint, worker isolation from browser memory/persistence/OAuth, no server-side Google credentials, no Agents SDK, no pre-phase Workflows or Web Push, single hourly cron trigger, and pure shared scheduler/context modules.\n`);
