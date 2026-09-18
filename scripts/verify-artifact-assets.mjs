import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const fontDirectory = join(root, 'src', 'ui', 'generated-fonts');
for (const font of ['Inter-latin.woff2', 'Manrope-latin.woff2', 'Outfit-latin.woff2']) {
  if (!existsSync(join(fontDirectory, font))) throw new Error(`Missing bundled font asset: ${font}`);
}

const configured = process.env.BUSYTEX_ASSET_DIR || join(root, 'public', 'core', 'busytex');
const requiredBusyTexFiles = ['busytex.js', 'busytex.wasm', 'busytex_worker.js'];
const available = existsSync(configured) ? new Set(readdirSync(configured)) : new Set();
const missing = requiredBusyTexFiles.filter((file) => !available.has(file));
if (missing.length && process.env.REQUIRE_BUSYTEX_ASSETS === '1') {
  throw new Error(`Missing BusyTeX assets in ${resolve(configured)}: ${missing.join(', ')}. Run npm run busytex:prepare.`);
}
if (missing.length) {
  process.stdout.write(`Bundled fonts verified. BusyTeX assets are not present locally; deployment must populate ${resolve(configured)} with npm run busytex:prepare.\n`);
} else {
  process.stdout.write(`Bundled fonts and BusyTeX assets verified at ${resolve(configured)}.\n`);
}
