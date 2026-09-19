import {
  DEFAULT_GENERATION_ACTIVITY_GLYPHS,
  GENERATION_ACTIVITY_GLYPH_KEYS,
  type GenerationActivityGlyphKey,
  type GenerationActivityGlyphs,
} from '../domain/preferences';

const MAX_GLYPH_CODE_UNITS = 32;

export const GENERATION_ACTIVITY_GLYPH_LABELS: Readonly<Record<GenerationActivityGlyphKey, string>> = {
  reasoning: 'Reasoning',
  tool: 'Tool execution',
  memory: 'Memory',
  authorization: 'Authorization',
  confirmation: 'Confirmation',
  calendar: 'Calendar',
  tasks: 'Tasks',
  gmail: 'Gmail',
  drive: 'Drive',
  documents: 'Documents',
  sheets: 'Sheets',
  generation: 'Writing',
};

export const GENERATION_ACTIVITY_GLYPH_SUGGESTIONS: Readonly<Record<GenerationActivityGlyphKey, readonly string[]>> = {
  reasoning: ['🧠', '💭', '◉'],
  tool: ['⚙', '🛠', '⚒'],
  memory: ['📕', '📓', '♥'],
  authorization: ['🔐', '🔒', '🔑'],
  confirmation: ['✅', '☑', '✓'],
  calendar: ['📅', '🗓', '⌚'],
  tasks: ['☑', '✅', '📌'],
  gmail: ['✉', '📨', '📩'],
  drive: ['🗂', '📁', '💾'],
  documents: ['📄', '📃', '📝'],
  sheets: ['📊', '📈', '🧮'],
  generation: ['✍', '🖋', '✎'],
};

function graphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((item) => item.segment);
  }
  return Array.from(value);
}

/**
 * Activity icons are one user-visible grapheme. U+FE0F is removed so a saved
 * value never explicitly requests platform color-emoji presentation.
 */
export function normalizeGenerationActivityGlyph(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().normalize('NFC').replace(/\uFE0F/g, '');
  if (!normalized || normalized.length > MAX_GLYPH_CODE_UNITS) return fallback;
  const segments = graphemes(normalized);
  return segments.length === 1 ? normalized : fallback;
}

export function normalizeGenerationActivityGlyphs(value: unknown): GenerationActivityGlyphs {
  const input = value && typeof value === 'object' ? value as Partial<Record<GenerationActivityGlyphKey, unknown>> : {};
  return Object.fromEntries(
    GENERATION_ACTIVITY_GLYPH_KEYS.map((key) => [
      key,
      normalizeGenerationActivityGlyph(input[key], DEFAULT_GENERATION_ACTIVITY_GLYPHS[key]),
    ]),
  ) as unknown as GenerationActivityGlyphs;
}

export function generationActivityGlyphText(glyphs: GenerationActivityGlyphs): string {
  return [...new Set(GENERATION_ACTIVITY_GLYPH_KEYS.map((key) => glyphs[key]))].join(' ');
}
