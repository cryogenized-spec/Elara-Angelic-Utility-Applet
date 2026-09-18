import type { GenerationActivityGlyphs } from '../domain/preferences';
import { generationActivityGlyphText } from './activity-glyphs';

export const NOTO_EMOJI_FAMILY = 'Elara Noto Emoji';
export const NOTO_EMOJI_PREVIEW_FAMILY = 'Elara Noto Emoji Preview';
export const NOTO_EMOJI_WEIGHT = 300;
const CACHE_NAME = 'elara-noto-emoji-v1';
const GOOGLE_FONTS_CSS_ORIGIN = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_BINARY_ORIGIN = 'https://fonts.gstatic.com';
const MAX_FONT_BYTES = 1_000_000;

let committedFace: FontFace | null = null;
let previewFace: FontFace | null = null;
let committedReady = false;
const listeners = new Set<() => void>();

export function subscribeNotoEmojiReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotoEmojiReady(): boolean {
  return committedReady;
}

function setCommittedReady(value: boolean): void {
  if (committedReady === value) return;
  committedReady = value;
  for (const listener of listeners) listener();
}

function subsetId(text: string): string {
  let hash = 0x811c9dc5;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-${text.length}`;
}

function syntheticCacheUrl(text: string): string {
  const origin = typeof location === 'undefined' ? 'https://elara.invalid' : location.origin;
  return new URL(`/__elara-cache/noto-emoji/300/${subsetId(text)}.woff2`, origin).toString();
}

export function notoEmojiCssUrl(text: string): string {
  const url = new URL('/css2', GOOGLE_FONTS_CSS_ORIGIN);
  url.searchParams.set('family', 'Noto Emoji:wght@300');
  url.searchParams.set('display', 'swap');
  url.searchParams.set('text', text);
  return url.toString();
}

function extractFontUrl(css: string): string {
  const urls = [...css.matchAll(/url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^)'"]+)\1\)/g)].map((match) => match[2]);
  const unique = [...new Set(urls)];
  if (unique.length !== 1) throw new Error('Noto Emoji stylesheet did not resolve to exactly one reviewed font asset.');
  const url = new URL(unique[0]!);
  if (url.protocol !== 'https:' || url.origin !== GOOGLE_FONTS_BINARY_ORIGIN || url.username || url.password) {
    throw new Error('Noto Emoji font asset resolved outside the reviewed Google Fonts origin.');
  }
  return url.toString();
}

async function fetchSubsetBytes(text: string): Promise<ArrayBuffer> {
  const cssUrl = notoEmojiCssUrl(text);
  const cssResponse = await fetch(cssUrl, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'text/css' },
  });
  if (!cssResponse.ok) throw new Error(`Noto Emoji stylesheet request failed (${cssResponse.status}).`);
  const css = await cssResponse.text();
  if (!css.includes("font-family: 'Noto Emoji'") || !css.includes('font-weight: 300')) {
    throw new Error('Noto Emoji stylesheet did not preserve the reviewed family and weight.');
  }

  const fontUrl = extractFontUrl(css);
  const fontResponse = await fetch(fontUrl, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!fontResponse.ok) throw new Error(`Noto Emoji font request failed (${fontResponse.status}).`);
  const bytes = await fontResponse.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FONT_BYTES) {
    throw new Error('Noto Emoji subset size was outside the accepted bounds.');
  }
  return bytes;
}

async function installFace(family: string, bytes: ArrayBuffer, kind: 'committed' | 'preview'): Promise<boolean> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return false;
  const face = new FontFace(family, bytes.slice(0), { style: 'normal', weight: String(NOTO_EMOJI_WEIGHT) });
  await face.load();
  document.fonts.add(face);
  if (kind === 'committed') {
    if (committedFace) document.fonts.delete(committedFace);
    committedFace = face;
    setCommittedReady(true);
  } else {
    if (previewFace) document.fonts.delete(previewFace);
    previewFace = face;
  }
  return true;
}

/** Network-only preview. Never writes CacheStorage. */
export async function previewNotoEmoji(glyphs: GenerationActivityGlyphs): Promise<boolean> {
  const text = generationActivityGlyphText(glyphs);
  if (!text) return false;
  return installFace(NOTO_EMOJI_PREVIEW_FAMILY, await fetchSubsetBytes(text), 'preview');
}

/**
 * Settings-exit commit boundary. The final subset is cached atomically after
 * retrieval, older subsets are removed, and the committed face is installed.
 */
export async function commitNotoEmoji(glyphs: GenerationActivityGlyphs): Promise<boolean> {
  const text = generationActivityGlyphText(glyphs);
  if (!text) return false;
  const bytes = await fetchSubsetBytes(text);

  if (typeof caches !== 'undefined') {
    const cache = await caches.open(CACHE_NAME);
    const key = syntheticCacheUrl(text);
    await cache.put(key, new Response(bytes.slice(0), {
      headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' },
    }));
    for (const request of await cache.keys()) {
      if (request.url !== key) await cache.delete(request);
    }
  }

  return installFace(NOTO_EMOJI_FAMILY, bytes, 'committed');
}

/**
 * Startup path. Cache is authoritative for offline use. A cache miss may use a
 * transient network font for this session, but never creates durable cache.
 */
export async function restoreNotoEmoji(glyphs: GenerationActivityGlyphs): Promise<boolean> {
  const text = generationActivityGlyphText(glyphs);
  if (!text) return false;
  setCommittedReady(false);

  if (typeof caches !== 'undefined') {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(syntheticCacheUrl(text));
    if (cached) {
      const bytes = await cached.arrayBuffer();
      if (bytes.byteLength > 0 && bytes.byteLength <= MAX_FONT_BYTES) {
        return installFace(NOTO_EMOJI_FAMILY, bytes, 'committed');
      }
    }
  }

  try {
    return await installFace(NOTO_EMOJI_FAMILY, await fetchSubsetBytes(text), 'committed');
  } catch {
    return false;
  }
}
