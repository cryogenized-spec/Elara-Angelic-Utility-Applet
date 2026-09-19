import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const rel = (absolute) => relative(root, absolute).replaceAll('\\', '/');

function walk(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  const output = [];
  const stack = [absolute];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.isFile()) output.push(next);
    }
  }
  return output;
}

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    fail(`missing security boundary file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

const runtimeFiles = [...walk('src'), ...walk('worker/src')]
  .filter((file) => /\.(?:ts|tsx|mts|cts|js|mjs)$/.test(file))
  .filter((file) => !/\.d\.ts$/.test(file))
  .filter((file) => !/(?:\.test\.|\.spec\.)/.test(file));
const runtime = new Map(runtimeFiles.map((file) => [rel(file), readFileSync(file, 'utf8')]));

// ---------------------------------------------------------------------------
// 1. Forbidden execution / DOM / host capabilities.
// These primitives grant powers that Elara does not need. Any introduction is
// an architecture event, not an ordinary implementation detail.
// ---------------------------------------------------------------------------
const forbiddenCapabilities = [
  [/\beval\s*\(/, 'dynamic eval'],
  [/\b(?:new\s+)?Function\s*\(/, 'dynamic Function constructor'],
  [/\bdangerouslySetInnerHTML\b/, 'React raw HTML injection'],
  [/(?:\.innerHTML|\.outerHTML|\[['"](?:innerHTML|outerHTML)['"]\])\s*=/, 'direct HTML injection'],
  [/\b(?:document\.write|document\[['"]write['"]\])\s*\(/, 'document.write'],
  [/(?:\.srcDoc|\[['"]srcDoc['"]\])\s*=/, 'iframe srcDoc injection'],
  [/\binsertAdjacentHTML\s*\(/, 'DOM HTML parser injection'],
  [/\bcreateContextualFragment\s*\(/, 'DOM fragment parser injection'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest transport'],
  [/\bnew\s+WebSocket\b/, 'WebSocket transport'],
  [/\bnew\s+EventSource\b/, 'EventSource transport'],
  [/\bnavigator\.sendBeacon\s*\(/, 'sendBeacon transport'],
  [/\bnew\s+SharedWorker\b/, 'SharedWorker authority'],
  [/\bimport\s*\(\s*['"]https?:\/\//, 'remote dynamic module import'],
];
const forbiddenNodeAuthority = /(?:from\s+|import\s*\()['"](?:node:)?(?:child_process|fs(?:\/promises)?|net|tls|dgram|vm|cluster|worker_threads|process)['"]/;

for (const [path, source] of runtime) {
  for (const [pattern, label] of forbiddenCapabilities) {
    if (pattern.test(source)) fail(`${path} acquires forbidden capability: ${label}`);
  }
  if (forbiddenNodeAuthority.test(source)) fail(`${path} imports a forbidden Node host authority`);
}

// Dynamic script insertion is executable-network authority. Elara currently
// needs exactly three such loaders: Google Identity Services, Google Picker,
// and YouTube's official IFrame API. Freeze the owners and provider URLs.
const reviewedScriptLoaders = new Map([
  ['src/google/oauth/gis.ts', [
    "const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';",
    "document.createElement('script')",
    'script.src = GIS_SCRIPT_URL;',
  ]],
  ['src/google/picker/service.ts', [
    "const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';",
    "const PICKER_ORIGIN = 'https://apis.google.com';",
    "document.createElement('script')",
    'script.src = PICKER_SCRIPT_URL;',
    ".setOAuthToken(token)",
    ".setOrigin(window.location.origin)",
  ]],
  ['src/media/youtube/player.ts', [
    "const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';",
    "document.createElement('script')",
    'script.src = IFRAME_API_SRC;',
  ]],
]);
const actualScriptLoaders = new Set();
for (const [path, source] of runtime) {
  if (/document\.createElement\(\s*['"]script['"]\s*\)/.test(source)) actualScriptLoaders.add(path);
}
for (const path of actualScriptLoaders) if (!reviewedScriptLoaders.has(path)) fail(`unreviewed dynamic script loader: ${path}`);
for (const [path, markers] of reviewedScriptLoaders) {
  const source = runtime.get(path) ?? '';
  if (!actualScriptLoaders.has(path)) fail(`reviewed dynamic script loader disappeared or moved: ${path}`);
  for (const marker of markers) if (!source.includes(marker)) fail(`${path} changed its reviewed executable script boundary: ${marker}`);
}

// Browser Worker construction creates a second executable runtime. The two
// reviewed workers are local module URLs only; any new Worker owner requires
// explicit architecture review.
const reviewedWorkerAuthorities = new Map([
  ['src/ocr/service.ts', "new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })"],
  ['src/documents/compiler.ts', "new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module' })"],
]);
const actualWorkerAuthorities = new Set();
for (const [path, source] of runtime) {
  if (/\bnew\s+(?:globalThis\.)?Worker\s*\(/.test(source)) actualWorkerAuthorities.add(path);
}
for (const path of actualWorkerAuthorities) if (!reviewedWorkerAuthorities.has(path)) fail(`unreviewed browser Worker authority: ${path}`);
for (const [path, marker] of reviewedWorkerAuthorities) {
  const source = runtime.get(path) ?? '';
  if (!actualWorkerAuthorities.has(path)) fail(`reviewed browser Worker authority disappeared or moved: ${path}`);
  if (!source.includes(marker)) fail(`${path} changed its reviewed local Worker target`);
}

// ---------------------------------------------------------------------------
// 2. Durable-state authorities.
// Importing Dexie helpers is not itself an authority (liveQuery is a reader).
// Owning/constructing a Dexie database is. Freeze exactly those owners so a new
// durable store is always an explicit architecture review event.
// ---------------------------------------------------------------------------
const reviewedDexieAuthorities = new Set([
  // Account-keyed task snapshots and local overdue rules; no credentials.
  'src/kanban/store.ts',
  'src/autonomy/cloud/credential.ts',
  'src/media/storage.ts',
  'src/persistence/autonomy.ts',
  'src/persistence/character.ts',
  'src/persistence/conversation.ts',
  'src/persistence/gemini-api-key.ts',
  'src/persistence/gemini-passkey.ts',
  'src/persistence/preferences.ts',
  'src/persistence/roleplay-world.ts',
]);
const actualDexieAuthorities = new Set();
for (const [path, source] of runtime) {
  if (/\b(?:extends\s+Dexie|new\s+Dexie)\b/.test(source)) actualDexieAuthorities.add(path);
}
for (const path of actualDexieAuthorities) if (!reviewedDexieAuthorities.has(path)) fail(`unreviewed durable Dexie authority: ${path}`);
for (const path of reviewedDexieAuthorities) if (!actualDexieAuthorities.has(path)) fail(`reviewed durable authority disappeared or moved: ${path}`);

// ---------------------------------------------------------------------------
// 3. Credential authority and propagation.
// Lockbox imports are a capability: consumers can receive plaintext secrets in
// memory. Freeze the reviewed runtime consumers and reject generic vault APIs.
// ---------------------------------------------------------------------------
const reviewedLockboxConsumers = new Set([
  'src/app/components/GeminiApiLockbox.tsx',
  'src/gemini/provider.ts',
  'src/media/search.ts',
  'src/media/youtube/readiness.ts',
  'src/persistence/gemini-lockbox-settings.ts',
  'src/persistence/gemini-passkey.ts',
  'src/vtt/transcription.ts',
]);
const actualLockboxConsumers = new Set();
for (const [path, source] of runtime) {
  if (path === 'src/persistence/gemini-api-key.ts') continue;
  if (/['"](?:\.\.\/)*persistence\/gemini-api-key['"]|['"]\.\/gemini-api-key['"]/.test(source)) actualLockboxConsumers.add(path);
}
for (const path of actualLockboxConsumers) if (!reviewedLockboxConsumers.has(path)) fail(`unreviewed Lockbox plaintext consumer: ${path}`);
for (const path of reviewedLockboxConsumers) if (!actualLockboxConsumers.has(path)) fail(`reviewed Lockbox consumer disappeared or moved: ${path}`);

const lockbox = read('src/persistence/gemini-api-key.ts');
if (/export\s+(?:async\s+)?function\s+(?:get|read|save|set|store)Secret\b/.test(lockbox)
  || /export\s+const\s+(?:get|read|save|set|store)Secret\b/.test(lockbox)) {
  fail('Lockbox exposes a forbidden generic secret accessor; credentials require named minimum-capability accessors');
}

// The installation credential is a separate device-local secret boundary used
// only for the user's own self-hosted Worker. Freeze the direct store consumer
// (pairing) and the two reviewed plaintext handoff consumers: autonomy cloud
// transport and durable Google OAuth brokerage.
const reviewedAutonomyCredentialConsumers = new Set(['src/autonomy/cloud/pairing.ts']);
const actualAutonomyCredentialConsumers = new Set();
for (const [path, source] of runtime) {
  if (path === 'src/autonomy/cloud/credential.ts') continue;
  if (/from\s+['"]\.\/credential['"]/.test(source)) actualAutonomyCredentialConsumers.add(path);
}
for (const path of actualAutonomyCredentialConsumers) if (!reviewedAutonomyCredentialConsumers.has(path)) fail(`unreviewed autonomy credential-store consumer: ${path}`);
for (const path of reviewedAutonomyCredentialConsumers) if (!actualAutonomyCredentialConsumers.has(path)) fail(`reviewed autonomy credential-store consumer disappeared or moved: ${path}`);

const reviewedPairingTokenConsumers = new Set([
  'src/autonomy/cloud/client.ts',
  'src/google/oauth/authority.ts',
]);
const actualPairingTokenConsumers = new Set();
for (const [path, source] of runtime) {
  if (path === 'src/autonomy/cloud/pairing.ts') continue;
  if (/\bresolvePairingToken\b/.test(source)) actualPairingTokenConsumers.add(path);
}
for (const path of actualPairingTokenConsumers) if (!reviewedPairingTokenConsumers.has(path)) fail(`unreviewed runtime autonomy-token consumer: ${path}`);
for (const path of reviewedPairingTokenConsumers) if (!actualPairingTokenConsumers.has(path)) fail(`reviewed runtime autonomy-token consumer disappeared or moved: ${path}`);

const pairing = read('src/autonomy/cloud/pairing.ts');
const autonomyCredential = read('src/autonomy/cloud/credential.ts');
const autonomyClient = read('src/autonomy/cloud/client.ts');
const oauthAuthority = read('src/google/oauth/authority.ts');
if (!pairing.includes("type StoredAutonomyPairing = Omit<AutonomyPairing, 'token'>")) fail('autonomy pairing must exclude token from its durable metadata type');
if (!pairing.includes('saveAutonomyInstallationToken')) fail('autonomy pairing must route the installation credential through its protected store');
if (/writeJson\(PAIRING_KEY\s*,\s*\{\s*\.\.\.pairing\s*\}/.test(pairing)) fail('autonomy pairing serializes the complete pairing object, including its credential');
if (!autonomyCredential.includes("name: 'AES-GCM'")) fail('autonomy installation credential must use AES-GCM at rest');
if (!autonomyCredential.includes("generateKey({ name: 'AES-GCM', length: 256 }, false")) fail('autonomy installation credential key must remain non-extractable');
if (/localStorage/.test(autonomyCredential)) fail('autonomy credential store must not use localStorage');
for (const [path, source] of [
  ['src/autonomy/cloud/credential.ts', autonomyCredential],
  ['src/autonomy/cloud/pairing.ts', pairing],
  ['src/autonomy/cloud/client.ts', autonomyClient],
  ['src/google/oauth/authority.ts', oauthAuthority],
]) {
  if (/\bconsole\.(?:log|info|warn|error|debug)\s*\(/.test(source)) fail(`${path} must not log from the installation-credential-bearing boundary`);
}

for (const [path, source] of runtime) {
  for (const line of source.split(/\r?\n/)) {
    if (!/(?:window\.)?localStorage\.setItem\s*\(/.test(line)) continue;
    if (/token|api[_-]?key|secret|password|passphrase|credential/i.test(line)) {
      fail(`${path} writes a credential-shaped value to localStorage`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Outbound network authority.
// Global fetch is the approved request transport. Alternative raw browser
// transports are forbidden above; dynamic executable loaders are separately
// frozen. Google service adapters receive an authorized fetch from the OAuth
// authority and therefore do not own global egress.
// ---------------------------------------------------------------------------
const reviewedRawFetchAuthorities = new Set([
  'src/autonomy/cloud/client.ts',
  'src/google/oauth/authority.ts',
  'src/ui/noto-emoji.ts',
]);
const reviewedGlobalFetchReferences = new Set([
  'src/media/youtube/readiness.ts',
  'src/media/youtube/service.ts',
  'src/media/youtube/validate.ts',
]);

function ownsUnqualifiedFetch(source) {
  const pattern = /(?<![.$\w])fetch\s*\(/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const prefix = source.slice(lineStart, match.index);
    if (/\b(?:async|function)\s*$/.test(prefix)) continue; // method/function declaration
    return true;
  }
  return false;
}

for (const [path, source] of runtime) {
  if (ownsUnqualifiedFetch(source) && !reviewedRawFetchAuthorities.has(path)) fail(`unreviewed global fetch authority: ${path}`);
  if (/(?:globalThis|window|self)\.fetch\b/.test(source) && !reviewedGlobalFetchReferences.has(path)) fail(`unreviewed global fetch reference: ${path}`);
}
for (const path of reviewedRawFetchAuthorities) {
  const source = runtime.get(path) ?? '';
  if (!ownsUnqualifiedFetch(source)) fail(`reviewed global fetch authority disappeared or moved: ${path}`);
}

const notoEmojiFontSource = read('src/ui/noto-emoji.ts');
for (const marker of [
  "const GOOGLE_FONTS_CSS_ORIGIN = 'https://fonts.googleapis.com'",
  "const GOOGLE_FONTS_BINARY_ORIGIN = 'https://fonts.gstatic.com'",
  "credentials: 'omit'",
  "referrerPolicy: 'no-referrer'",
  "cache: 'no-store'",
  'MAX_FONT_BYTES',
]) {
  if (!notoEmojiFontSource.includes(marker)) fail(`Noto Emoji egress boundary is missing: ${marker}`);
}
for (const path of reviewedGlobalFetchReferences) {
  const source = runtime.get(path) ?? '';
  if (!/(?:globalThis|window|self)\.fetch\b/.test(source)) fail(`reviewed global fetch reference disappeared or moved: ${path}`);
}

if (!oauthAuthority.includes('GOOGLE_API_HOSTS')) fail('Google OAuth egress must retain its explicit API host allowlist');
if (!oauthAuthority.includes("url.protocol !== 'https:'")) fail('Google OAuth egress must enforce HTTPS');
if (!oauthAuthority.includes('assertGoogleApiTarget')) fail('Google authorized fetch must validate its destination');
for (const marker of ['requestGoogleAuthorizationCode', "'/google/oauth/token'", 'resolvePairingToken', 'signWrite']) {
  if (!oauthAuthority.includes(marker)) fail(`durable Google OAuth browser authority is missing: ${marker}`);
}

for (const marker of [
  "url.protocol !== 'https:'",
  'url.username || url.password',
  'url.search || url.hash',
  'resolvePairingToken',
]) {
  if (!autonomyClient.includes(marker)) fail(`autonomy cloud egress boundary is missing: ${marker}`);
}
if (/fetch\s*\(\s*`[^`]*\$\{[^}]*token/i.test(autonomyClient)
  || /new\s+URL\s*\(\s*`[^`]*\$\{[^}]*token/i.test(autonomyClient)) {
  fail('autonomy cloud client interpolates a credential into a network target');
}

for (const [path, endpoint] of [
  ['src/media/youtube/service.ts', 'https://www.googleapis.com/youtube/v3/search'],
  ['src/media/youtube/readiness.ts', 'https://www.googleapis.com/youtube/v3/videos'],
  ['src/media/youtube/validate.ts', 'https://www.googleapis.com/youtube/v3/videos'],
]) {
  const source = read(path);
  if (!source.includes(endpoint)) fail(`${path} changed its reviewed YouTube API destination`);
  if (!source.includes("'x-goog-api-key'")) fail(`${path} must keep the YouTube API key in a request header`);
}

// ---------------------------------------------------------------------------
// 5. Google execution and confirmation boundaries.
// Raw Google service classes may only be constructed by the reviewed tool
// handlers. Mutation confirmation may only be brokered by the executor/tool
// loop/roleplay adapter. UI/domain code cannot quietly bypass those seams.
// ---------------------------------------------------------------------------
const reviewedGoogleServiceImporters = new Set([
  // Human-operated board only: live-session/effective-scope/account admission,
  // explicit Save actions and typed destructive confirmation in KanbanScreen.
  // Model mutations continue through the existing tool executor/broker.
  'src/kanban/google-port.ts',
  'src/google/tools/read-handlers.ts',
  'src/google/tools/service-handlers.ts',
]);
const serviceImport = /from\s+['"][^'"]*\/(?:calendar|tasks|gmail|docs|drive|sheets|chat)\/service['"]/;
for (const [path, source] of runtime) {
  if (serviceImport.test(source) && !reviewedGoogleServiceImporters.has(path)) fail(`Google service bypasses the reviewed tool handler boundary: ${path}`);
}
for (const path of reviewedGoogleServiceImporters) if (!serviceImport.test(runtime.get(path) ?? '')) fail(`reviewed Google service handler disappeared or moved: ${path}`);

const reviewedConfirmationBrokerConsumers = new Set([
  'src/gemini/google-tool-loop.ts',
  'src/google/confirmation/roleplay-broker.ts',
  'src/google/tools/executor.ts',
]);
function importsConfirmationBroker(path, source) {
  if (path === 'src/google/confirmation/roleplay-broker.ts') return /from\s+['"]\.\/broker['"]/.test(source);
  return /from\s+['"][^'"]*confirmation\/broker['"]/.test(source);
}
for (const [path, source] of runtime) {
  if (importsConfirmationBroker(path, source) && !reviewedConfirmationBrokerConsumers.has(path)) fail(`unreviewed confirmation-broker consumer: ${path}`);
}
for (const path of reviewedConfirmationBrokerConsumers) {
  if (!importsConfirmationBroker(path, runtime.get(path) ?? '')) fail(`reviewed confirmation-broker consumer disappeared or moved: ${path}`);
}

const executor = read('src/google/tools/executor.ts');
if (!executor.includes('evaluateWriteConfirmation')) fail('Google executor must evaluate mutation confirmation policy');
if (!executor.includes('requestGoogleToolConfirmation')) fail('Google executor must retain the shared confirmation broker');
const toolLoop = read('src/gemini/google-tool-loop.ts');
if (!toolLoop.includes('requestGoogleToolConfirmations')) fail('Gemini tool loop must retain grouped mutation confirmation');
if (!toolLoop.includes("else results.push(errorToolResult(call, 'INVALID_TOOL_CALL'));")) fail('Mutations without valid confirmation requests must fail closed before execution');
if (!toolLoop.includes('containsUntrustedExternal') || !toolLoop.includes('isUntrustedExternalReadTool') || !toolLoop.includes('UNTRUSTED_EXTERNAL_READ_PREFIXES') || !toolLoop.includes('batchStartedTainted') || !toolLoop.includes('untrustedContext: true as const')) fail('Gemini tool loop must intrinsically taint later mutation confirmations after external reads');
const geminiContracts = read('src/gemini/contracts.ts');
const appSource = read('src/app/App.tsx');
const kanbanStore = read('src/kanban/store.ts');
if (appSource.includes('kanbanContext') && (!geminiContracts.includes('untrustedExternalContext?: boolean') || !appSource.includes('untrustedExternalContext: Boolean(kanbanInstruction)') || !toolLoop.includes('request.untrustedExternalContext === true'))) fail('Persisted Kanban provider context must enter the existing Gemini untrusted-context authority before the first model tool batch');
if (appSource.includes('kanbanContext') && !kanbanStore.includes('if (!memo.length) return "";')) fail('Empty Kanban overdue memos must not taint unrelated model turns');
if (appSource.includes('kanbanContext') && (!kanbanStore.includes('MAX_BOARD_LISTS = 500') || !kanbanStore.includes('MAX_BOARD_TASKS = 20_000') || !kanbanStore.includes('MAX_BOARD_PROVIDER_PAGES = 1_024'))) fail('Kanban provider traversal must retain explicit aggregate resource ceilings');

const googleBroker = read('src/google/confirmation/broker.ts');
if (googleBroker.includes("all.dataset.decision = 'all';") || googleBroker.includes('✓ Approve all')) fail('Google confirmation broker must not expose approve-all');
if (!googleBroker.includes('checkbox.checked = requests.length === 1 && request.untrustedContext !== true;')) fail('Grouped and tainted Google confirmations must default unselected');
if (!googleBroker.includes("warning.dataset.untrustedContext = 'true';") || !googleBroker.includes('refreshApproveState')) fail('Tainted Google confirmations must expose a warning and require explicit selection');

const confirmationPolicy = read('src/google/confirmation/policy.ts');
const confirmationExecutor = read('src/google/tools/executor.ts');
if (!confirmationPolicy.includes('MAX_CONFIRMATION_REVIEW_CHARS = 1_250_000')) fail('Confirmation review payload ceiling must remain bounded');
if (!confirmationExecutor.includes('writeConfirmationSchema.parse') || !confirmationExecutor.includes('MAX_CONFIRMATION_REVIEW_CHARS')) fail('Confirmation requests must remain schema-validated and bounded');

const lockboxAuthority = read('src/persistence/gemini-api-key.ts');
if (!lockboxAuthority.includes('const PBKDF2_ITERATIONS = 600_000;')) fail('Lockbox new-write PBKDF2 work factor must remain hardened');
if (!lockboxAuthority.includes('GEMINI_LOCKBOX_NEW_PIN_MIN_LENGTH = 10')) fail('Fresh Lockbox PIN minimum must remain hardened');

const workerProvider = read('worker/src/index.ts');
if (!workerProvider.includes('verifyBearerToken') || !workerProvider.includes('requireProviderAdmission') || !workerProvider.includes('admissionConfigured')) fail('Worker provider routes and health contract must retain installation bearer admission');
if (!workerProvider.includes("maxOutputTokens: z.number().int().min(1).max(65_536)")) fail('Worker provider output budget must remain bounded');

if (errors.length) {
  process.stderr.write(`Security & architecture gate failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Security & architecture gate passed: ${runtime.size} runtime files checked; forbidden execution/DOM/Node and alternate browser transport powers absent; reviewed dynamic script and browser Worker authorities frozen; ${reviewedDexieAuthorities.size} durable authorities, ${reviewedLockboxConsumers.size} Lockbox consumers, installation credential propagation, outbound egress authorities, Google service imports, and confirmation brokers match the reviewed capability surface.\n`);