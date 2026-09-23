import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'README.md', 'AGENTS.md', '.nvmrc', 'package.json',
  'documents/INDEX.md', 'documents/manifest.json', 'documents/architecture.md',
  'documents/ui.md', 'documents/chat.md', 'documents/gemini.md', 'documents/vtt.md', 'documents/memory.md',
  'documents/artifacts.md', 'documents/documents.md', 'documents/character.md', 'documents/google-auth.md', 'documents/google-workspace.md',
  'documents/media.md', 'documents/autonomy.md', 'documents/security.md', 'documents/persistence.md', 'documents/pwa.md', 'documents/worker.md',
  'documents/reliability.md', 'documents/third-party-notices.md', 'public/core/README.md',
  'src/artifacts/repository.ts', 'src/artifacts/validation.ts', 'src/artifacts/image-preprocessing.ts', 'src/artifacts/intake.ts', 'src/artifacts/transformations.ts', 'src/artifacts/repository.test.ts', 'src/gemini/multimodal.test.ts', 'src/app/components/artifacts/GeneratedTextCard.tsx', 'src/app/components/artifacts/GeneratedTextCard.test.tsx', 'src/ocr/service.ts', 'src/ocr/worker.ts', 'src/documents/compiler.ts', 'src/documents/compiler.worker.ts', 'scripts/verify-artifact-assets.mjs',
  'src/app/components/MarkdownText.tsx', 'src/app/components/MarkdownText.test.tsx', 'src/app/components/RoleplaySettings.tsx',
  'src/character/system-instruction.ts', 'src/persistence/character.ts', 'src/persistence/character.test.ts', 'src/persistence/gemini-api-key.ts', 'src/persistence/gemini-api-key.test.ts', 'src/persistence/preferences.ts', 'src/persistence/roleplay-world.ts',
  'src/domain/roleplay-world.ts', 'src/domain/roleplay-world.test.ts',
  'src/gemini/runtime-context.ts', 'src/google/confirmation/broker.ts', 'src/google/confirmation/roleplay-broker.ts', 'src/google/tools/roleplay-world-schemas.ts', 'src/google/tools/roleplay-world-handlers.ts', 'src/google/tools/gemini-declarations.test.ts',
  'src/google/drive/limits.ts', 'src/google/drive/errors.ts', 'src/google/drive/download.ts', 'src/google/drive/create-replay.ts', 'src/google/drive/create-replay.test.ts', 'src/google/drive/adversarial-certification.test.ts', 'src/google/tools/drive-parity.test.ts', 'src/google/tools/drive-write-parity.test.ts', 'e2e/google-drive.spec.ts',
  'src/autonomy/contracts.ts', 'src/autonomy/schedule.ts', 'src/autonomy/policy.ts', 'src/autonomy/outcome.ts', 'src/autonomy/authority.ts', 'src/autonomy/instruction.ts', 'src/autonomy/runner.ts', 'src/autonomy/runner.test.ts', 'src/autonomy/tool-surface.test.ts', 'src/persistence/autonomy.ts', 'src/persistence/autonomy.test.ts', 'src/app/components/AutonomySettings.tsx', 'src/gemini/google-tool-loop.readonly.test.ts',
  'src/autonomy/scheduler.ts', 'src/autonomy/scheduler.test.ts', 'src/autonomy/context.ts', 'src/autonomy/context.test.ts', 'src/autonomy/protocol.ts', 'src/autonomy/protocol.test.ts',
  'src/autonomy/cloud/pairing.ts', 'src/autonomy/cloud/pairing.test.ts', 'src/autonomy/cloud/client.ts', 'src/autonomy/cloud/sync.ts', 'src/autonomy/cloud/sync.test.tsx', 'src/app/components/AutonomyCloud.tsx',
  'worker/src/entry.ts', 'worker/src/google/oauth-provider.ts', 'worker/src/google/oauth-routes.ts', 'worker/src/google/oauth-vault.ts',
  'worker/src/autonomy/ports.ts', 'worker/src/autonomy/store.ts', 'worker/src/autonomy/engine.ts', 'worker/src/autonomy/routes.ts', 'worker/src/autonomy/workflow.ts', 'worker/src/autonomy/cloud-execute.ts', 'src/autonomy/history-page.ts', 'src/autonomy/history-page.test.ts', 'src/autonomy/config-identity.ts', 'src/autonomy/config-identity.test.ts', 'src/autonomy/cloud-result.ts', 'src/autonomy/workflow-identity.ts', 'src/autonomy/envelope.ts', 'worker/test/autonomy-engine.test.ts', 'worker/test/autonomy-http.test.ts', 'worker/test/google-oauth-vault.test.ts', 'worker/test/google-oauth-routes.test.ts', 'worker/test/helpers.ts', 'vitest.workers.config.ts', 'vitest.clickup.workers.config.ts',
  'scripts/verify-autonomy-worker.mjs', 'e2e/autonomy-cloud.spec.ts',
  'e2e/roleplay-world.spec.ts', 'e2e/autonomy.spec.ts',
];

for (const relative of requiredFiles) if (!existsSync(join(root, relative))) throw new Error(`Reliability gate: missing ${relative}`);

const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
const packageJson = JSON.parse(packageSource);
for (const script of ['lint', 'typecheck', 'test', 'test:workers', 'build', 'e2e', 'reliability:check', 'verify:artifact-assets']) if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`Reliability gate: missing npm script ${script}`);
if ((packageSource.match(/"dexie"\s*:/g) ?? []).length !== 1) throw new Error('Reliability gate: package.json must contain exactly one dexie dependency entry.');
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
const driveDownloadSource = readFileSync(join(root, 'src/google/drive/download.ts'), 'utf8');
if (!driveDownloadSource.includes('artifactRepository')) throw new Error('Reliability gate: Drive downloads must persist file bytes through the artifact repository.');
if (!driveDownloadSource.includes('setStatus')) throw new Error('Reliability gate: Drive download artifacts must commit their lifecycle through the guarded repository transitions.');
const driveHandlerSource = readFileSync(join(root, 'src/google/tools/service-handlers.ts'), 'utf8');
if (driveHandlerSource.includes('bytesBase64')) throw new Error('Reliability gate: Drive tool results must never carry raw file bytes or base64 payloads to the model.');
if (!driveHandlerSource.includes('runDriveCreateOnce')) throw new Error('Reliability gate: Drive file creation must retain its same-call replay fence.');
const driveServiceSource = readFileSync(join(root, 'src/google/drive/service.ts'), 'utf8');
if (!driveServiceSource.includes("'If-Match'")) throw new Error('Reliability gate: Drive mutations must send a conditional If-Match precondition.');
if (driveServiceSource.includes("method: 'DELETE'")) throw new Error('Reliability gate: Elara must never permanently delete a Drive file.');
const driveReplaySource = readFileSync(join(root, 'src/google/drive/create-replay.ts'), 'utf8');
if (!driveReplaySource.includes('payloadSignature')) throw new Error('Reliability gate: Drive create replay must bind the fence to the call payload.');
const compilerWorkerSource = readFileSync(join(root, 'src/documents/compiler.worker.ts'), 'utf8');
if (!compilerWorkerSource.includes('shellEscape: false')) throw new Error('Reliability gate: browser document compilation must disable shell escape.');
const workerProviderSource = readFileSync(join(root, 'worker', 'src', 'index.ts'), 'utf8');
if (!workerProviderSource.includes('verifyBearerToken') || !workerProviderSource.includes('requireProviderAdmission') || !workerProviderSource.includes("request.headers.get('Authorization')")) throw new Error('Reliability gate: Worker Gemini/transcription provider routes must require installation bearer admission.');
if (!workerProviderSource.includes("maxOutputTokens: z.number().int().min(1).max(65_536)")) throw new Error('Reliability gate: Worker Gemini output budget must remain locally bounded.');
if (!workerProviderSource.includes('GEMINI_MAX_REQUEST_BYTES = 2 * 1024 * 1024') || !workerProviderSource.includes('readBoundedJson(request, GEMINI_MAX_REQUEST_BYTES)')) throw new Error('Reliability gate: Worker Gemini request bodies must be byte-bounded before JSON parsing.');
if (!workerProviderSource.includes('GEMINI_MAX_RELAY_BYTES = 4 * 1024 * 1024') || !workerProviderSource.includes('GEMINI_STREAM_LIMITS.maxEvents') || !workerProviderSource.includes('streamedTextChars') || !workerProviderSource.includes('streamedThoughtChars')) throw new Error('Reliability gate: Worker Gemini relay must retain finite event/text/thought/byte budgets.');
const providerSource = readFileSync(join(root, 'src/gemini/provider.ts'), 'utf8');
if (!providerSource.includes("from '@google/genai'")) throw new Error('Reliability gate: Gemini must execute directly from the application provider.');
if (providerSource.includes('GEMINI_WORKER_URL') || providerSource.includes('elara-gemini.cryogenized.workers.dev')) throw new Error('Reliability gate: Gemini provider must not use the Cloudflare Worker.');
if (!providerSource.includes('getGeminiApiKey')) throw new Error('Reliability gate: Gemini provider must obtain its credential through the local app Lockbox.');
if (!providerSource.includes("httpOptions: { apiVersion: 'v1', retryOptions: { attempts: 1 } }")) throw new Error('Reliability gate: Gemini Interactions must use the stable v1 API through SDK httpOptions.');
if (providerSource.includes("apiKey, apiVersion: 'v1'")) throw new Error('Reliability gate: Gemini API version must not be configured through the obsolete top-level SDK option.');
if (!providerSource.includes("if (systemInstruction) payload.system_instruction = systemInstruction;")) throw new Error('Reliability gate: empty Character Master must omit system_instruction entirely.');
if (!providerSource.includes('request.results')) throw new Error('Reliability gate: Gemini tool-result continuation must support grouped results.');
const streamLimitSource = readFileSync(join(root, 'src/gemini/stream-limits.ts'), 'utf8');
if (!streamLimitSource.includes('maxEvents: 50_000') || !streamLimitSource.includes('maxTextChars: 1_000_000') || !streamLimitSource.includes('maxThoughtChars: 64_000') || !streamLimitSource.includes('maxFunctionArgumentChars: 100_000')) throw new Error('Reliability gate: canonical Gemini live-stream ceilings changed without review.');
if (!providerSource.includes('GEMINI_STREAM_LIMITS.maxEvents') || !providerSource.includes('GEMINI_STREAM_LIMITS.maxTextChars') || !providerSource.includes('GEMINI_STREAM_LIMITS.maxThoughtChars') || !providerSource.includes('GEMINI_STREAM_LIMITS.maxFunctionArgumentChars')) throw new Error('Reliability gate: browser Gemini provider must enforce every canonical live-stream ceiling.');
const generationStateSafetySource = readFileSync(join(root, 'src/chat/generation-state.ts'), 'utf8');
if (!generationStateSafetySource.includes('GEMINI_STREAM_LIMITS.maxTextChars') || !generationStateSafetySource.includes('GEMINI_STREAM_LIMITS.maxThoughtChars')) throw new Error('Reliability gate: chat reducer must independently bound live transcript and thought-summary state.');

const markdownSource = readFileSync(join(root, 'src/app/components/MarkdownText.tsx'), 'utf8');
if (!markdownSource.includes('skipHtml')) throw new Error('Reliability gate: restricted Markdown renderer must explicitly skip raw HTML.');
if (!markdownSource.includes('safeMarkdownUrl')) throw new Error('Reliability gate: Markdown renderer must use the application safe-link boundary.');

const characterSource = readFileSync(join(root, 'src/character/system-instruction.ts'), 'utf8');
if (!characterSource.includes("export const ELARA_SYSTEM_INSTRUCTION = '';")) throw new Error('Reliability gate: no built-in Elara Character Master prompt may be shipped.');

const appSource = readFileSync(join(root, 'src/app/App.tsx'), 'utf8');
const clickUpToolElectionSource = readFileSync(join(root, 'src/clickup/tool-election.ts'), 'utf8');
for (const marker of ['loadStoredClickUpStatus', 'clickupToolNameSchema', 'defaultGeminiToolsForClickUpConnection', 'defaultGeminiToolsForCurrentSession']) {
  if (!clickUpToolElectionSource.includes(marker)) throw new Error(`Reliability gate: ClickUp provider-aware tool election is missing ${marker}.`);
}
if (appSource.includes('buildCharacterInstruction')) throw new Error('Reliability gate: legacy character instruction resolver must not be used.');
if (!appSource.includes('defaultGeminiToolsForCurrentSession')) throw new Error('Reliability gate: normal character turns must elect the registered capability surface through provider-aware tool election.');
if (!appSource.includes('tools: defaultGeminiToolsForCurrentSession()')) throw new Error('Reliability gate: normal and regenerated turns must elect the canonical executable tool surface at dispatch time.');
if (appSource.includes('const DEFAULT_GEMINI_TOOLS = googleGeminiFunctionNames()')) throw new Error('Reliability gate: provider-gated tool schemas must not be frozen into every chat turn.');
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
const googleExecutorSource = readFileSync(join(root, 'src/google/tools/executor.ts'), 'utf8');
if (!googleExecutorSource.includes('friendlyArgumentReview') || googleExecutorSource.includes('JSON.stringify(args, null, 2)')) throw new Error('Reliability gate: mutation confirmations must retain full validated review detail without raw JSON presentation.');
const googleBrokerSource = readFileSync(join(root, 'src/google/confirmation/broker.ts'), 'utf8');
if (!googleBrokerSource.includes('requestGoogleToolConfirmations')) throw new Error('Reliability gate: Google mutations must support grouped confirmation requests.');
if (!googleBrokerSource.includes("decline.dataset.decision = 'decline';") || !googleBrokerSource.includes("selected.dataset.decision = 'selected';")) throw new Error('Reliability gate: Google mutations must expose explicit decline and selected-approval controls through DOM-safe decision assignments.');
if (googleBrokerSource.includes("all.dataset.decision = 'all';") || googleBrokerSource.includes('✓ Approve all')) throw new Error('Reliability gate: grouped mutations must not regain one-click approve-all authority.');
if (!googleBrokerSource.includes('checkbox.checked = requests.length === 1 && request.untrustedContext !== true;')) throw new Error('Reliability gate: grouped and tainted mutation confirmations must default unselected.');
if (googleBrokerSource.includes('innerHTML')) throw new Error('Reliability gate: Google confirmation UI must not regain raw HTML parsing authority.');
if (!googleBrokerSource.includes('aria-label') || !googleBrokerSource.includes('confirmationToolPresentation')) throw new Error('Reliability gate: confirmation controls must remain accessible and provider actions human-readable.');
if (!googleBrokerSource.includes("warning.dataset.untrustedContext = 'true';") || !googleBrokerSource.includes('refreshApproveState')) throw new Error('Reliability gate: tainted confirmations must expose warning state and require explicit selection.');
if (!googleBrokerSource.includes('EXPANDED_REVIEW_CHARS') || !googleBrokerSource.includes("host.classList.add('roleplay-confirmation--expanded')") || googleBrokerSource.includes("reviewText.style.maxHeight = '12rem'")) throw new Error('Reliability gate: substantial confirmations must use adaptive review sizing rather than the old fixed 12rem cap.');
if (!googleBrokerSource.includes('request.attachmentReview') || !googleBrokerSource.includes("'File preview'")) throw new Error('Reliability gate: attachment confirmations must retain the human metadata/preview surface.');
const confirmationStyleSource = readFileSync(join(root, 'src/app/components/roleplay-settings.css'), 'utf8');
if (!confirmationStyleSource.includes('.roleplay-confirmation--expanded') || !confirmationStyleSource.includes('unicode-bidi:plaintext')) throw new Error('Reliability gate: approval reviews must retain viewport-aware expansion and bidi isolation.');
const confirmationWatchdogE2eSource = readFileSync(join(root, 'e2e/confirmation-watchdog.spec.ts'), 'utf8');
if (!confirmationWatchdogE2eSource.includes('reviewScrollHeight') || !confirmationWatchdogE2eSource.includes("locator('script')") || !confirmationWatchdogE2eSource.includes("locator('img')")) throw new Error('Reliability gate: watchdog E2E must retain Android geometry and raw-markup injection checks.');
const toolLoopSource = readFileSync(join(root, 'src/gemini/google-tool-loop.ts'), 'utf8');
if (!toolLoopSource.includes('requestGoogleToolConfirmations')) throw new Error('Reliability gate: Google tool loop must route mutation batches through the shared confirmation broker.');
if (!toolLoopSource.includes('containsUntrustedExternal') || !toolLoopSource.includes('isExternalEvidenceReadTool') || !toolLoopSource.includes('EXTERNAL_EVIDENCE_READ_PREFIXES') || !toolLoopSource.includes('batchStartedTainted') || !toolLoopSource.includes('untrustedContext: true as const')) throw new Error('Reliability gate: external provider reads must intrinsically taint later mutation confirmations.');
if (!toolLoopSource.includes('UNTRUSTED_CONTEXT_REQUIRES_FRESH_USER_TURN') || !toolLoopSource.includes('batchStartedExternalTainted') || !toolLoopSource.includes('PRIVATE_EXTERNAL_READ_PREFIXES') || !toolLoopSource.includes('taintedReadContinuationAllowed') || !toolLoopSource.includes('driveSearchCandidateIds') || !toolLoopSource.includes('Boolean(request.attachments?.length)') || !toolLoopSource.includes("composed.memoryStatus === 'used'")) throw new Error('Reliability gate: attachments/provider content/memory must retain application-enforced information-flow taint with provenance-bound Drive transfer continuation.');
if (!toolLoopSource.includes("else results.push(errorToolResult(call, 'INVALID_TOOL_CALL'));")) throw new Error('Reliability gate: a mutation without a valid confirmation request must fail closed before execution.');
if (!toolLoopSource.includes('results:')) throw new Error('Reliability gate: Google tool loop must return grouped tool results to Gemini.');
const oauthAuthoritySafetySource = readFileSync(join(root, 'src/google/oauth/authority.ts'), 'utf8');
if (!oauthAuthoritySafetySource.includes("window.addEventListener('storage'") || !oauthAuthoritySafetySource.includes('authorizationStorageRevision()') || !oauthAuthoritySafetySource.includes('Google account changed or could not be verified') || !oauthAuthoritySafetySource.includes('clearGooglePickerAdmissions') || !oauthAuthoritySafetySource.includes('GoogleAuthorizationStateChangedError')) throw new Error('Reliability gate: Google OAuth must retain cross-tab invalidation, pre-egress revision checking and account-continuity cleanup.');
const pairingSafetySource = readFileSync(join(root, 'src/autonomy/cloud/pairing.ts'), 'utf8');
if (!pairingSafetySource.includes("event.key === PAIRING_KEY") || !pairingSafetySource.includes('const current = loadPairing();') || !pairingSafetySource.includes('const stillCurrent = loadPairing();')) throw new Error('Reliability gate: Autonomy installation tokens must fail closed across stale pairing/unpair races.');
const organicMemorySource = readFileSync(join(root, 'src/memory/organic-observer.ts'), 'utf8');
const memorySafetySource = readFileSync(join(root, 'src/memory/safety.ts'), 'utf8');
if (!organicMemorySource.includes('containsCredentialMaterial') || !memorySafetySource.includes('containsLuhnValidCardNumber') || !memorySafetySource.includes('AKIA|ASIA') || !memorySafetySource.includes('eyJ[A-Za-z0-9_-]')) throw new Error('Reliability gate: automatic memory must retain the shared deterministic bare-secret and card-number rejection boundary.');
const clickupAttachmentAuthoritySource = readFileSync(join(root, 'src/clickup/attachment-authority.ts'), 'utf8');
if (!clickupAttachmentAuthoritySource.includes('previewableTextMime') || !clickupAttachmentAuthoritySource.includes('CLICKUP_ARTIFACT_PREVIEW_CHARS') || !clickupAttachmentAuthoritySource.includes('blob.slice(0, CLICKUP_ARTIFACT_PREVIEW_BYTES)')) throw new Error('Reliability gate: ClickUp attachment previews must remain bounded and text-MIME-only.');
const artifactValidationSafetySource = readFileSync(join(root, 'src/artifacts/validation.ts'), 'utf8');
const imagePreprocessSafetySource = readFileSync(join(root, 'src/artifacts/image-preprocessing.ts'), 'utf8');
if (!artifactValidationSafetySource.includes('ARTIFACT_LIMITS.maxImagePixels') || !artifactValidationSafetySource.includes('validateImagePixelBudget') || !imagePreprocessSafetySource.includes('ARTIFACT_LIMITS.maxImagePixels')) throw new Error('Reliability gate: image pixel budget must be enforced both at intake and transform boundaries.');
const pwaSafetySource = readFileSync(join(root, 'src/pwa.ts'), 'utf8');
if (!pwaSafetySource.includes("navigator.serviceWorker.addEventListener('controllerchange'") || !pwaSafetySource.includes('let hadController = Boolean(navigator.serviceWorker.controller)') || !pwaSafetySource.includes('window.location.reload()')) throw new Error('Reliability gate: already-controlled PWA clients must reload after a service-worker takeover to prevent version skew.');
const executorSource = readFileSync(join(root, 'src/google/tools/executor.ts'), 'utf8');
if (!executorSource.includes('requestGoogleToolConfirmation')) throw new Error('Reliability gate: direct Google tool execution must retain the shared confirmation broker.');
if (!executorSource.includes('confirmationRequestForCall')) throw new Error('Reliability gate: Google executor must expose safe confirmation request derivation for batched mutations.');
if (!executorSource.includes('writeConfirmationSchema.parse') || !executorSource.includes('MAX_CONFIRMATION_REVIEW_CHARS')) throw new Error('Reliability gate: confirmation payloads must be schema-validated and bounded.');
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
if (!lockboxSource.includes('const PBKDF2_ITERATIONS = 600_000;')) throw new Error('Reliability gate: new Lockbox encryption must retain the hardened PBKDF2 work factor.');
if (!lockboxSource.includes('GEMINI_LOCKBOX_NEW_PIN_MIN_LENGTH = 10')) throw new Error('Reliability gate: fresh Lockbox PINs must retain the stronger minimum length.');
if (!lockboxSource.includes("name: 'AES-GCM'")) throw new Error('Reliability gate: Gemini API credential must be encrypted with AES-GCM.');
if (!lockboxSource.includes('crypto.getRandomValues')) throw new Error('Reliability gate: Lockbox encryption must use random salt and IV material.');
const approvedLockboxStorageWrite = 'window.localStorage.setItem(LOCKBOX_SESSION_REVOCATION_KEY, revision);';
const lockboxStorageWrites = lockboxSource.match(/\blocalStorage\.setItem\b/g) ?? [];
if (lockboxStorageWrites.length !== 1 || !lockboxSource.includes(approvedLockboxStorageWrite)) throw new Error('Reliability gate: Lockbox localStorage writes are limited to the opaque cross-tab revocation nonce.');
if (!lockboxSource.includes('removeLegacyPlaintextKey')) throw new Error('Reliability gate: legacy plaintext Gemini API storage must be explicitly removed.');
if (!lockboxSource.includes('const unlockedSecrets = new Map<LockboxSecretId, string>();')) throw new Error('Reliability gate: decrypted credentials must remain session-memory-only.');
if (!lockboxSource.includes("event.key === LOCKBOX_SESSION_REVOCATION_KEY") || !lockboxSource.includes('handleSiblingLockboxRevocation')) throw new Error('Reliability gate: protected Lockbox sessions must revoke across sibling tabs.');
if (!lockboxSource.includes('function clearPlaintextSession()') || !lockboxSource.includes('const wasUnlocked = clearPlaintextSession();') || !lockboxSource.includes('clearPlaintextSession();\n  securityMode = null;')) throw new Error('Reliability gate: locking and clearing the Lockbox must converge on the shared plaintext-session revocation boundary.');

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
// persistence, or browser OAuth authorities. Server-side provider OAuth is
// allowed only inside the explicitly reviewed Google/ClickUp OAuth modules
// pinned below as credential authorities.
const forbiddenWorkerImports = /memory\/store|persistence\/|(?:\.\.\/)+src\/(?:google|clickup)\/oauth|retrieveMemories|dexie/i;
const serverOauthMarker = /accounts\.google\.com|googleapis\.com\/oauth|api\.clickup\.com\/api\/v2\/oauth|refresh_token|authorization.?code/i;
for (const path of workerSourceFiles) {
  const source = readFileSync(path, 'utf8');
  const importLines = source.split('\n').filter((line) => /^\s*(?:import|export)\s.*from\s+['"]/.test(line) || /^\s*import\s+['"]/.test(line)).join('\n');
  if (forbiddenWorkerImports.test(importLines)) throw new Error(`Reliability gate: worker module must not import browser-only concerns (memory store / persistence / browser OAuth / Dexie): ${path}`);
  const reviewedServerOauthFile = path.includes(join('worker', 'src', 'google', 'oauth-'))
    || path.includes(join('worker', 'src', 'clickup', 'oauth-'))
    || path.includes(join('worker', 'src', 'clickup', 'provider.ts'));
  if (!reviewedServerOauthFile && serverOauthMarker.test(source)) throw new Error(`Reliability gate: server-side provider OAuth markers are allowed only in reviewed provider OAuth authorities: ${path}`);
  if (/from ['"]agents['"]|@cloudflare\/agents/.test(source)) throw new Error(`Reliability gate: Agents SDK must not appear: ${path}`);
  if (/cloudflare:workflows/.test(source)) throw new Error(`Reliability gate: do not import cloudflare:workflows (${path}); bind Workflows via wrangler.`);
  if (/vapid|web-push|pushManager|PushSubscription/i.test(source)) throw new Error(`Reliability gate: Web Push must not appear before Phase D: ${path}`);
}
if (packageSource.includes('"agents"') || packageJson.dependencies?.agents || packageJson.devDependencies?.agents) throw new Error('Reliability gate: the Agents SDK dependency is deliberately not adopted (design §7.4).');

const googleOauthProviderSource = readFileSync(join(root, 'worker', 'src', 'google', 'oauth-provider.ts'), 'utf8');
const googleOauthVaultSource = readFileSync(join(root, 'worker', 'src', 'google', 'oauth-vault.ts'), 'utf8');
const googleOauthRoutesSource = readFileSync(join(root, 'worker', 'src', 'google', 'oauth-routes.ts'), 'utf8');
const workerCompositionSource = readFileSync(join(root, 'worker', 'src', 'entry.ts'), 'utf8');
if (!googleOauthProviderSource.includes('https://oauth2.googleapis.com/token') || !googleOauthProviderSource.includes("grant_type: 'refresh_token'")) throw new Error('Reliability gate: durable Google OAuth must exchange and refresh only through the reviewed token provider.');
if (!googleOauthVaultSource.includes("name: 'AES-GCM'") || !googleOauthVaultSource.includes('GOOGLE_OAUTH_VAULT_KEY')) throw new Error('Reliability gate: Google refresh tokens must be AES-GCM encrypted with the dedicated vault key.');
if (!googleOauthVaultSource.includes('google_oauth_nonces') || !googleOauthVaultSource.includes('verifySignedWrite')) throw new Error('Reliability gate: Google OAuth vault writes must be independently signed and replay-protected durably.');
if (!googleOauthRoutesSource.includes('verifySignedWrite') || !googleOauthRoutesSource.includes('X-Requested-With')) throw new Error('Reliability gate: public Google OAuth writes must retain signed admission and popup CSRF protection.');
if (!workerCompositionSource.includes('handleGoogleOAuthRoute') || !workerCompositionSource.includes('return coreWorker.fetch(request, env)')) throw new Error('Reliability gate: Worker composition must isolate Google OAuth routing and delegate all existing runtime traffic unchanged.');

const clickUpOauthProviderSource = readFileSync(join(root, 'worker', 'src', 'clickup', 'provider.ts'), 'utf8');
const clickUpOauthVaultSource = readFileSync(join(root, 'worker', 'src', 'clickup', 'oauth-vault.ts'), 'utf8');
const clickUpOauthRoutesSource = readFileSync(join(root, 'worker', 'src', 'clickup', 'oauth-routes.ts'), 'utf8');
if (!clickUpOauthProviderSource.includes('https://api.clickup.com/api/v2/oauth/token') || !clickUpOauthProviderSource.includes('CLICKUP_OAUTH_CLIENT_SECRET')) throw new Error('Reliability gate: ClickUp OAuth token exchange must remain in the reviewed Worker provider.');
if (!clickUpOauthProviderSource.includes("export type ClickUpCredentialKind = 'oauth' | 'personal'") || !clickUpOauthProviderSource.includes('personalClickUpCredential') || !clickUpOauthProviderSource.includes("if (typeof input === 'string') return oauthClickUpCredential(input)") || !clickUpOauthProviderSource.includes("credential.kind === 'personal' ? credential.token : `Bearer ${credential.token}`")) throw new Error('Reliability gate: ClickUp provider auth must preserve structural personal-token and OAuth Authorization forms without token-content inference.');
if (!clickUpOauthVaultSource.includes("name: 'AES-GCM'") || !clickUpOauthVaultSource.includes('CLICKUP_OAUTH_VAULT_KEY')) throw new Error('Reliability gate: ClickUp provider token bytes must remain AES-GCM encrypted with the dedicated vault key.');
if (!clickUpOauthVaultSource.includes("credential_kind TEXT NOT NULL DEFAULT 'oauth'") || !clickUpOauthVaultSource.includes("ALTER TABLE clickup_oauth_credential ADD COLUMN credential_kind TEXT NOT NULL DEFAULT 'oauth'") || !clickUpOauthVaultSource.includes('encrypted.cipher, encrypted.iv, accessToken.kind') || !clickUpOauthVaultSource.includes("row.credential_kind === 'personal'")) throw new Error('Reliability gate: ClickUp credential kind must remain a separate durable discriminator with legacy rows migrating to OAuth.');
if (!clickUpOauthVaultSource.includes('CLICKUP_PERSONAL_TOKEN') || !clickUpOauthVaultSource.includes('connectPersonalToken')) throw new Error('Reliability gate: ClickUp personal-token activation must remain Worker-secret-only.');
if (!clickUpOauthVaultSource.includes('clickup_oauth_nonces') || !clickUpOauthVaultSource.includes('verifySignedWrite')) throw new Error('Reliability gate: ClickUp credential-vault writes must remain signed and replay-protected durably.');
if (!clickUpOauthRoutesSource.includes('verifySignedWrite') || !clickUpOauthRoutesSource.includes("'/clickup/oauth/personal-token'") || !clickUpOauthRoutesSource.includes("'/clickup/oauth/methods'") || !clickUpOauthRoutesSource.includes("'/clickup/oauth/connection-state'") || !workerCompositionSource.includes('handleClickUpOAuthRoute')) throw new Error('Reliability gate: public ClickUp credential writes and method discovery must retain the reviewed route boundary.');
if (!clickUpOauthVaultSource.includes("url.pathname === '/clickup/oauth/methods'") || !clickUpOauthVaultSource.includes('return json(this.connectionMethods())')) throw new Error('Reliability gate: ClickUp connection methods must remain on their backward-compatible separate read endpoint.');
if (!clickUpOauthVaultSource.includes("settled_epoch INTEGER NOT NULL DEFAULT 0") || !clickUpOauthVaultSource.includes('settleConnectionEpochIfCurrent') || !clickUpOauthVaultSource.includes("url.pathname === '/clickup/oauth/connection-state'") || !clickUpOauthVaultSource.includes('return json(this.connectionState())')) throw new Error('Reliability gate: ClickUp connection operations must expose durable pending/settled authority.');
if (!clickUpOauthVaultSource.includes('browser_write_timestamp INTEGER NOT NULL DEFAULT 0') || !clickUpOauthVaultSource.includes('reserveBrowserWriteTimestamp') || !clickUpOauthVaultSource.includes('timestampMs <= row.browser_write_timestamp') || !clickUpOauthVaultSource.includes("code: 'connection_superseded'") || !clickUpOauthVaultSource.includes('const browserWriteTimestamp = writeAuth.timestampMs')) throw new Error('Reliability gate: ClickUp connection writes must be durably ordered by the HMAC-verified browser timestamp before provider/account mutation.');
const clickUpBrowserAuthoritySource = readFileSync(join(root, 'src', 'clickup', 'oauth', 'authority.ts'), 'utf8');
for (const marker of [
  'authorityBinding: clickUpPairingAuthorityBinding(pairing)',
  'cachedStatusRawForPairing',
  'clearCachedStatusForPairing(pairing',
  'expectedRaw !== undefined && raw !== expectedRaw',
  'currentRevision > incomingRevision',
  'PENDING_CONNECTION_KEY',
  'CONNECTION_GENERATION_KEY',
  'operationId: newNonce()',
  'writeConnectionGeneration(pairing, pending.operationId)',
  'generationSnapshot = connectionGenerationForPairing(pairing)',
  'connectionGenerationForPairing(pairing) !== generationSnapshot',
  'connectionGenerationForPairing(pairing) !== pending.operationId',
  'const browserIntentTimestamp = Date.now()',
  'signedPost(pairing, path, payload, parse, browserIntentTimestamp)',
  'expectedOperationId && pending.operationId !== expectedOperationId',
  'CLICKUP_CONNECTION_SETTLE_MS = (WORKER_TIMEOUT_MS * 2) + 5_000',
  "'connection_pending'",
  'ensureConnectionSettled(pairing',
  'bearerConnectionState',
  "'/clickup/oauth/connection-state'",
  'stateAfter.epoch !== stateBefore.epoch',
  'stateAfter.settledEpoch !== stateBefore.settledEpoch',
  'markConnectionPending(pairing, operation)',
]) {
  if (!clickUpBrowserAuthoritySource.includes(marker)) throw new Error(`Reliability gate: ClickUp browser connection race authority is missing ${marker}.`);
}


// The scheduler seam exists and names its contracts.
const portsSource = readFileSync(join(root, 'worker', 'src', 'autonomy', 'ports.ts'), 'utf8');
if (!portsSource.includes('interface WakeSource') || !portsSource.includes('interface SchedulerPort')) throw new Error('Reliability gate: the WakeSource/SchedulerPort seam must be declared in worker/src/autonomy/ports.ts.');
if (!portsSource.includes("kind: 'cron-trigger'")) throw new Error('Reliability gate: the production wake source must be the cron trigger.');
const engineSource = readFileSync(join(root, 'worker', 'src', 'autonomy', 'engine.ts'), 'utf8');
for (const portOperation of ['ensureScheduled', 'cancel(', 'dueWithin']) {
  if (!engineSource.includes(portOperation)) throw new Error(`Reliability gate: the AutonomyEngine Durable Object must implement the SchedulerPort surface (${portOperation}).`);
}
if (!engineSource.includes('decideRunClaim')) throw new Error('Reliability gate: the DO claim path must use the shared pure decideRunClaim decision.');

// The cron handler remains in the existing Worker core and is a heartbeat only.
const workerEntrySource = readFileSync(join(root, 'worker', 'src', 'index.ts'), 'utf8');
const scheduledMatch = workerEntrySource.match(/async scheduled\([\s\S]*?\n {2}\},/);
if (!scheduledMatch) throw new Error('Reliability gate: the worker must export a scheduled() cron handler.');
const scheduledBody = scheduledMatch[0];
for (const forbidden of ['gemini', 'Gemini', 'streamGoogleToolLoop', 'GoogleGenAI', 'routine', 'engine.fetch']) {
  if (scheduledBody.includes(forbidden)) throw new Error(`Reliability gate: the cron handler must remain a heartbeat (found "${forbidden}" in scheduled()).`);
}
if (!scheduledBody.includes('heartbeat')) throw new Error('Reliability gate: the cron handler must invoke the scheduler heartbeat.');

for (const wakeRoute of ["'/autonomy/wake'", '"/autonomy/wake"', "'/autonomy/heartbeat'", '"/autonomy/heartbeat"']) {
  if (workerEntrySource.includes(wakeRoute) || workerCompositionSource.includes(wakeRoute)) throw new Error('Reliability gate: no public wake endpoint may exist.');
}

const wranglerSource = readFileSync(join(root, 'worker', 'wrangler.toml'), 'utf8');
const crons = wranglerSource.match(/crons\s*=\s*\[([^\]]*)\]/);
if (!crons || crons[1].split(',').filter((entry) => entry.trim()).length !== 1 || !crons[1].includes('0 * * * *')) throw new Error('Reliability gate: the worker must carry exactly one hourly cron trigger.');
if (!wranglerSource.includes('main = "src/entry.ts"')) throw new Error('Reliability gate: production Worker HTTP composition must use worker/src/entry.ts.');
if (!wranglerSource.includes('new_sqlite_classes') || !wranglerSource.includes('AutonomyEngine')) throw new Error('Reliability gate: the AutonomyEngine Durable Object must be declared with SQLite storage.');
if (!wranglerSource.includes('name = "GOOGLE_OAUTH"') || !wranglerSource.includes('class_name = "GoogleOAuthVault"')) throw new Error('Reliability gate: wrangler must bind the dedicated GoogleOAuthVault Durable Object.');
if (!wranglerSource.includes('class_name = "RoutineRunWorkflow"') || !wranglerSource.includes('binding = "ROUTINE_RUN"')) throw new Error('Reliability gate: wrangler must declare the RoutineRun Workflow binding.');
const workflowSource = readFileSync(join(root, 'worker', 'src', 'autonomy', 'workflow.ts'), 'utf8');
if (!workflowSource.includes('class RoutineRunWorkflow') || !workflowSource.includes('WorkflowEntrypoint')) throw new Error('Reliability gate: RoutineRunWorkflow must be a WorkflowEntrypoint.');
if (!engineSource.includes('completeClaim') || !engineSource.includes('dispatchWorkflow')) throw new Error('Reliability gate: the DO must claim then dispatch a Workflow.');
if (engineSource.includes("path === '/c0/fixture'")) throw new Error('Reliability gate: production DO fetch must not expose /c0/fixture.');
if (engineSource.includes('claimWithoutDispatch') || engineSource.includes('markDispatchedWithoutAdvance')) throw new Error('Reliability gate: crash fixtures must not be public methods on AutonomyEngine.');
if (workerEntrySource.includes('TestAutonomyEngine') || workerCompositionSource.includes('TestAutonomyEngine')) throw new Error('Reliability gate: production worker entry must not export TestAutonomyEngine.');
if (wranglerSource.includes('TestAutonomyEngine') || wranglerSource.includes('TestGoogleOAuthVault')) throw new Error('Reliability gate: production wrangler must not bind test Durable Object classes.');
if (!engineSource.includes('nextOccurrenceAfterProcessed')) throw new Error('Reliability gate: schedule advance must be occurrence-anchored.');
if (!engineSource.includes('schedulerLive') || !engineSource.includes('agentExecution')) throw new Error('Reliability gate: scheduler liveness and agent execution must not share one dryRun flag.');
if (!readFileSync(join(root, 'worker/src/autonomy/store.ts'), 'utf8').includes('pruneEnvelopes')) throw new Error('Reliability gate: envelopes must be pruned with runs.');
if (wranglerSource.includes('C1_MODEL_STUB')) throw new Error('Reliability gate: C1_MODEL_STUB must not be declared in production wrangler.');
if (workflowSource.includes('C0_SHELL') || engineSource.includes('C0_SHELL')) throw new Error('Reliability gate: C0 shell completion must not remain after C1.');
if (!workflowSource.includes('executeCloudRoutine')) throw new Error('Reliability gate: the Workflow must execute the C1 model step.');
if (!readFileSync(join(root, 'worker/src/autonomy/store.ts'), 'utf8').includes('admitProposedEvent')) throw new Error('Reliability gate: event admission policy must run inside the DO transaction.');
if (!readFileSync(join(root, 'worker/src/autonomy/store.ts'), 'utf8').includes('CREATE TABLE IF NOT EXISTS events')) throw new Error('Reliability gate: cloud events must be durable.');

const allowedSchedulerImports = /^\s*(?:import|export)\s.*from\s+['"](?:zod|\.\/contracts|\.\/schedule|\.\.\/memory\/retrieval|\.\.\/memory\/types)['"];?\s*$/;
for (const shared of ['src/autonomy/scheduler.ts', 'src/autonomy/context.ts']) {
  const source = readFileSync(join(root, shared), 'utf8');
  for (const line of source.split('\n')) {
    if (/^\s*(?:import|export)\s.*from\s+['"]/.test(line) && !allowedSchedulerImports.test(line)) {
      throw new Error(`Reliability gate: shared scheduler module ${shared} must stay pure (unexpected import: ${line.trim()}).`);
    }
  }
}

if (readFileSync(join(root, '.nvmrc'), 'utf8').trim() !== '24.21.0') throw new Error('Reliability gate: Node baseline must remain 24.21.0.');

process.stdout.write(`Reliability gate passed: ${requiredFiles.length} required files, runtime scripts present, Node 24.21.0 baseline, single dexie dependency, no safety override marker, no legacy generateContent() calls, direct Gemini browser transport through the encrypted Dexie Lockbox, restricted Markdown safety boundary, no built-in Character Master prompt, canonical executable tool capability exposure including Roleplay World, single VTT system instruction, opaque Roleplay refs, shared Google mutation watchdog with grouped confirmation and grouped Gemini tool results, Calendar event creation, deterministic YAML view, conditional Drive writes under one concrete strong ETag, a recoverable Drive trash tool instead of permanent deletion, Drive create replay fencing, Drive downloads that persist bytes through the guarded artifact lifecycle instead of returning them to the model, encrypted browser credential persistence, and the reviewed durable Google OAuth server authority with encrypted refresh-token vaulting plus signed replay-protected admission; Phase B scheduler invariants remain intact: SchedulerPort/WakeSource seam, DO single-alarm scheduler with shared pure due-time truth, heartbeat-only cron, no public wake endpoint, worker isolation from browser memory/persistence/OAuth, no Agents SDK, Workflows bound via wrangler, no Web Push, single hourly cron trigger, and pure shared scheduler/context modules.\n`);
