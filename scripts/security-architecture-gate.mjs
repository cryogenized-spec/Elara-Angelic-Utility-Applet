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
  [/\bnew\s+Function\s*\(/, 'dynamic Function constructor'],
  [/\bdangerouslySetInnerHTML\b/, 'React raw HTML injection'],
  [/(?:\.innerHTML|\.outerHTML)\s*=/, 'direct HTML injection'],
  [/\bdocument\.write\s*\(/, 'document.write'],
  [/\bsrcDoc\s*=/, 'iframe srcDoc injection'],
];
const forbiddenNodeAuthority = /(?:from\s+|import\s*\()['"](?:node:)?(?:child_process|fs(?:\/promises)?|net|tls|dgram|vm|cluster|worker_threads|process)['"]/;

for (const [path, source] of runtime) {
  for (const [pattern, label] of forbiddenCapabilities) {
    if (pattern.test(source)) fail(`${path} acquires forbidden capability: ${label}`);
  }
  if (forbiddenNodeAuthority.test(source)) fail(`${path} imports a forbidden Node host authority`);
}

// ---------------------------------------------------------------------------
// 2. Durable-state authorities.
// Importing Dexie helpers is not itself an authority (liveQuery is a reader).
// Owning/constructing a Dexie database is. Freeze exactly those owners so a new
// durable store is always an explicit architecture review event.
// ---------------------------------------------------------------------------
const reviewedDexieAuthorities = new Set([
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

const pairing = read('src/autonomy/cloud/pairing.ts');
const autonomyCredential = read('src/autonomy/cloud/credential.ts');
if (!pairing.includes("type StoredAutonomyPairing = Omit<AutonomyPairing, 'token'>")) fail('autonomy pairing must exclude token from its durable metadata type');
if (!pairing.includes('saveAutonomyInstallationToken')) fail('autonomy pairing must route the installation credential through its protected store');
if (/writeJson\(PAIRING_KEY\s*,\s*\{\s*\.\.\.pairing\s*\}/.test(pairing)) fail('autonomy pairing serializes the complete pairing object, including its credential');
if (!autonomyCredential.includes("name: 'AES-GCM'")) fail('autonomy installation credential must use AES-GCM at rest');
if (!autonomyCredential.includes("generateKey({ name: 'AES-GCM', length: 256 }, false")) fail('autonomy installation credential key must remain non-extractable');
if (/localStorage/.test(autonomyCredential)) fail('autonomy credential store must not use localStorage');

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
// Global fetch is the actual egress capability. Google service adapters receive
// an authorized fetch from the OAuth authority; they do not own global egress.
// YouTube uses injectable fetch seams but every runtime default is explicit and
// every provider destination is frozen below.
// ---------------------------------------------------------------------------
const reviewedRawFetchAuthorities = new Set([
  'src/autonomy/cloud/client.ts',
  'src/google/oauth/authority.ts',
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
for (const path of reviewedGlobalFetchReferences) {
  const source = runtime.get(path) ?? '';
  if (!/(?:globalThis|window|self)\.fetch\b/.test(source)) fail(`reviewed global fetch reference disappeared or moved: ${path}`);
}

const oauthAuthority = read('src/google/oauth/authority.ts');
if (!oauthAuthority.includes('GOOGLE_API_HOSTS')) fail('Google OAuth egress must retain its explicit API host allowlist');
if (!oauthAuthority.includes("url.protocol !== 'https:'")) fail('Google OAuth egress must enforce HTTPS');
if (!oauthAuthority.includes('assertGoogleApiTarget')) fail('Google authorized fetch must validate its destination');

const autonomyClient = read('src/autonomy/cloud/client.ts');
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

if (errors.length) {
  process.stderr.write(`Security & architecture gate failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Security & architecture gate passed: ${runtime.size} runtime files checked; forbidden execution/DOM/Node powers absent; ${reviewedDexieAuthorities.size} durable authorities, ${reviewedLockboxConsumers.size} Lockbox consumers, outbound egress authorities, autonomy credential handling, Google service imports, and confirmation brokers match the reviewed capability surface.\n`);
