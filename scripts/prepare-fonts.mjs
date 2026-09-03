import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'src', 'ui', 'generated-fonts');
const sourceDir = join(root, '.font-sources');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const latin = 'U+0020-007E,U+00A0-00FF';

const fonts = [
  { family: 'Inter', source: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf', output: 'Inter-latin.woff2', weight: '100 900' },
  { family: 'Manrope', source: 'https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf', output: 'Manrope-latin.woff2', weight: '200 800' },
  { family: 'Outfit', source: 'https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/Outfit%5Bwght%5D.ttf', output: 'Outfit-latin.woff2', weight: '100 900' },
];

function run(args) {
  execFileSync(PYTHON, args, { cwd: root, stdio: 'inherit' });
}

function ensureFontTools() {
  try {
    run(['-c', 'import fontTools; import brotli']);
  } catch {
    console.log('Fonttools/Brotli not found; installing build-time tooling...');
    run(['-m', 'pip', 'install', '--disable-pip-version-check', '--user', 'fonttools', 'brotli']);
    run(['-c', 'import fontTools; import brotli']);
  }
}

async function download(url, destination) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Elara-Angelic-Utility-Applet font build' } });
  if (!response.ok) throw new Error(`Font download failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await import('node:fs/promises').then(({ writeFile }) => writeFile(destination, buffer));
}

async function main() {
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  ensureFontTools();

  for (const font of fonts) {
    const source = join(sourceDir, `${font.family}.ttf`);
    const output = join(outputDir, font.output);
    if (!existsSync(source)) await download(font.source, source);
    execFileSync(PYTHON, [
      '-m', 'fontTools.subset', source,
      `--output-file=${output}`,
      '--flavor=woff2',
      `--unicodes=${latin}`,
      '--layout-features=*',
      '--name-IDs=*',
      '--no-hinting',
    ], { cwd: root, stdio: 'inherit' });
  }

  rmSync(sourceDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
