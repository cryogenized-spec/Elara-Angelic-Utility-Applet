import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const documentsRoot = join(root, 'documents');
const manifestPath = join(documentsRoot, 'manifest.json');
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function walk(path, ignored = new Set()) {
  if (!existsSync(path)) return [];
  const output = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) output.push(...walk(full, ignored));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

if (!existsSync(manifestPath)) fail('missing documents/manifest.json');
if (!existsSync(join(documentsRoot, 'INDEX.md'))) fail('missing documents/INDEX.md');
if (existsSync(join(root, 'docs'))) fail('legacy /docs documentation root must not exist');
if (existsSync(join(documentsRoot, 'migration-map.json'))) fail('documents/migration-map.json is migration scaffolding and must not return');

const manifest = existsSync(manifestPath) ? readJson(manifestPath, 'documents/manifest.json') : null;
const systems = manifest && typeof manifest.systems === 'object' && manifest.systems ? manifest.systems : null;
if (!systems) fail('manifest.systems must be an object');
if (manifest && manifest.root !== 'documents') fail('manifest.root must be "documents"');
if (manifest && (!Array.isArray(manifest.authority) || manifest.authority.join(',') !== 'source,tests,documents')) {
  fail('manifest.authority must be ["source","tests","documents"]');
}

const allowedCanonical = new Set(['INDEX.md', 'manifest.json']);
const seenIds = new Set();
let activeSystems = 0;
let verifiedPaths = 0;

for (const [name, system] of Object.entries(systems ?? {})) {
  if (!system || typeof system !== 'object') {
    fail(`manifest system ${name} must be an object`);
    continue;
  }
  if (system.status !== 'active') fail(`manifest system ${name} must be active`);
  if (typeof system.id !== 'string' || !/^SYS-[A-Z0-9-]+$/.test(system.id)) fail(`manifest system ${name} has invalid id`);
  else if (seenIds.has(system.id)) fail(`duplicate system id ${system.id}`);
  else seenIds.add(system.id);

  if (typeof system.doc !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(system.doc)) {
    fail(`manifest system ${name} has invalid canonical doc filename`);
    continue;
  }

  activeSystems += 1;
  allowedCanonical.add(system.doc);
  const docPath = join(documentsRoot, system.doc);
  if (!existsSync(docPath)) {
    fail(`manifest system ${name} points to missing documents/${system.doc}`);
  } else {
    const source = readFileSync(docPath, 'utf8');
    const idMatch = source.match(/^id:\s*(SYS-[A-Z0-9-]+)\s*$/m);
    const statusMatch = source.match(/^status:\s*([^\s]+)\s*$/m);
    const verifiedMatch = source.match(/^verified_commit:\s*([0-9a-f]{40})\s*$/m);
    if (!source.startsWith('---\n')) fail(`documents/${system.doc} must begin with frontmatter`);
    if (idMatch?.[1] !== system.id) fail(`documents/${system.doc} id does not match manifest (${system.id})`);
    if (statusMatch?.[1] !== 'active') fail(`documents/${system.doc} status must be active`);
    if (!verifiedMatch) fail(`documents/${system.doc} must carry a 40-character verified_commit`);
    for (let chapter = 1; chapter <= 8; chapter += 1) {
      if (!new RegExp(`^## ${chapter}\\.`, 'm').test(source)) fail(`documents/${system.doc} is missing chapter ${chapter}`);
    }
  }

  if (!Array.isArray(system.paths)) fail(`manifest system ${name}.paths must be an array`);
  else {
    for (const declared of system.paths) {
      if (typeof declared !== 'string' || !declared || declared.includes('*')) {
        fail(`manifest system ${name} has unsupported source path ${String(declared)}`);
        continue;
      }
      if (!existsSync(join(root, declared))) fail(`manifest system ${name} points to missing source path ${declared}`);
      else verifiedPaths += 1;
    }
  }

  if (!Array.isArray(system.keywords) || system.keywords.length === 0) fail(`manifest system ${name}.keywords must be a non-empty array`);
}

if (manifest?.routing?.default && !Object.hasOwn(systems ?? {}, manifest.routing.default)) {
  fail(`manifest routing.default references unknown system ${manifest.routing.default}`);
}

if (existsSync(documentsRoot)) {
  for (const file of walk(documentsRoot)) {
    const relativePath = relative(documentsRoot, file).split(sep).join('/');
    if (!allowedCanonical.has(relativePath)) fail(`unregistered canonical documentation file documents/${relativePath}`);
  }
}

const forbiddenDocName = /(?:^|[_-])(PASS|STATUS|HANDOFF|RECOVERY)(?:[_-]|\.|$)|IMPLEMENTATION[_-](?:LOG|PLAN)|ROADMAP/i;
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', 'playwright-report', 'test-results']);
const textExtensions = new Set(['.md', '.json', '.mjs', '.js', '.ts', '.tsx', '.yml', '.yaml']);
const legacyLinkPatterns = [
  /github\.com\/cryogenized-spec\/Elara-Angelic-Utility-Applet\/(?:blob|raw)\/[^/]+\/docs\//,
  /\]\((?:\.\/|\/)?docs\//,
  /\bdocs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md\b/,
];

for (const file of walk(root, ignoredDirectories)) {
  const rel = relative(root, file).split(sep).join('/');
  if (extname(file).toLowerCase() === '.md' && forbiddenDocName.test(rel.split('/').at(-1) ?? '')) {
    fail(`forbidden historical documentation filename ${rel}`);
  }
  if (!textExtensions.has(extname(file).toLowerCase()) || rel === 'package-lock.json') continue;
  const source = readFileSync(file, 'utf8');
  if (legacyLinkPatterns.some((pattern) => pattern.test(source))) fail(`legacy /docs reference remains in ${rel}`);
}

const markdownFiles = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...walk(documentsRoot).filter((file) => extname(file) === '.md')];
for (const file of markdownFiles) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  const links = source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const rawTarget = match[1].trim();
    if (!rawTarget || /^(?:https?:|mailto:|tel:|data:|#)/i.test(rawTarget)) continue;
    const pathPart = rawTarget.split('#', 1)[0].split('?', 1)[0];
    if (!pathPart) continue;
    const target = pathPart.startsWith('/') ? join(root, pathPart.slice(1)) : resolve(dirname(file), pathPart);
    if (!target.startsWith(root + sep) && target !== root) fail(`link escapes repository in ${relative(root, file)}: ${rawTarget}`);
    else if (!existsSync(target)) fail(`broken local documentation link in ${relative(root, file)}: ${rawTarget}`);
  }
}

if (errors.length) {
  process.stderr.write(`Documentation integrity failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Documentation integrity passed: ${activeSystems} active systems, ${allowedCanonical.size} canonical files, ${verifiedPaths} routed source paths verified.\n`);
