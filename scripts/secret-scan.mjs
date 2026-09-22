import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const root = process.cwd();
const findings = [];
const skippedDirs = new Set(['.git', 'node_modules', 'dist', 'coverage', 'playwright-report', 'test-results', 'dev-dist', '.wrangler']);
const textExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.toml', '.html', '.css', '.scss', '.txt', '.ini', '.conf', '.sh', '.ps1', '.xml', '.svg']);
const textNames = new Set(['.npmrc', '.nvmrc', '.gitignore', '.gitattributes', 'LICENSE', 'README']);
const allowedEnvNames = new Set(['.env.example', '.env.sample', '.env.template']);
const fixturePath = /(?:^|\/)(?:test|tests|__tests__|fixtures?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const dummyMarker = /(?:test|fake|dummy|never|probe|example|placeholder)/i;

const patterns = [
  ['Google API key', /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g],
  ['GitHub token', /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})(?![A-Za-z0-9_])/g],
  ['ClickUp personal token', /(?<![A-Za-z0-9_])pk_[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g],
  ['AWS access key', /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g],
  ['Slack token', /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9-])/g],
  ['OpenAI-style key', /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g],
  ['Google OAuth client secret', /(?<![A-Za-z0-9_-])GOCSPX-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g],
  ['npm access token', /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36,}(?![A-Za-z0-9_])/g],
  ['SendGrid API key', /(?<![A-Za-z0-9_.-])SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_.-])/g],
  ['Private key material', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g],
];

function relativePath(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function shouldRead(path) {
  const name = basename(path);
  const extension = extname(name).toLowerCase();
  if (name.startsWith('.env')) return true;
  return textExtensions.has(extension) || textNames.has(name) || (extension === '' && statSync(path).size <= 256 * 1024);
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirs.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.isFile() || !shouldRead(path)) continue;
    scan(path);
  }
}

function lineNumber(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (source.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function scan(path) {
  const rel = relativePath(path);
  const name = basename(path);
  if (name.startsWith('.env') && !allowedEnvNames.has(name)) {
    findings.push(`${rel}: tracked environment file is forbidden`);
  }

  const source = readFileSync(path, 'utf8');
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const token = match[0];
      if (fixturePath.test(rel) && dummyMarker.test(token)) continue;
      findings.push(`${rel}:${lineNumber(source, match.index ?? 0)}: possible ${label}`);
    }
  }
}

walk(root);

if (findings.length) {
  process.stderr.write(`Secret scan failed (${findings.length}):\n${findings.map((finding) => `- ${finding}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Secret scan passed: no high-confidence credential material or tracked private environment files detected.\n');
