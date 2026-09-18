import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATION_ACTIVITY_GLYPHS } from '../domain/preferences';
import {
  generationActivityGlyphText,
  normalizeGenerationActivityGlyph,
  normalizeGenerationActivityGlyphs,
} from './activity-glyphs';

describe('Generation Activity glyph normalization', () => {
  it('accepts one visible grapheme and removes explicit color-emoji presentation', () => {
    expect(normalizeGenerationActivityGlyph(' ❤️ ', 'x')).toBe('❤');
    expect(normalizeGenerationActivityGlyph('👩‍💻', 'x')).toBe('👩‍💻');
  });

  it('rejects empty, multi-grapheme, oversized and non-string values', () => {
    expect(normalizeGenerationActivityGlyph('', 'x')).toBe('x');
    expect(normalizeGenerationActivityGlyph('ab', 'x')).toBe('x');
    expect(normalizeGenerationActivityGlyph('🙂🙂', 'x')).toBe('x');
    expect(normalizeGenerationActivityGlyph('a'.repeat(40), 'x')).toBe('x');
    expect(normalizeGenerationActivityGlyph(7, 'x')).toBe('x');
  });

  it('normalizes every persisted slot independently without losing defaults', () => {
    const normalized = normalizeGenerationActivityGlyphs({
      memory: '♥️',
      calendar: 'bad',
      gmail: '✉',
    });
    expect(normalized.memory).toBe('♥');
    expect(normalized.calendar).toBe(DEFAULT_GENERATION_ACTIVITY_GLYPHS.calendar);
    expect(normalized.gmail).toBe('✉');
    expect(normalized.reasoning).toBe(DEFAULT_GENERATION_ACTIVITY_GLYPHS.reasoning);
  });

  it('deduplicates the subset text in stable semantic order', () => {
    const normalized = normalizeGenerationActivityGlyphs({
      reasoning: '◇',
      tool: '◇',
      memory: '♥',
    });
    const text = generationActivityGlyphText(normalized);
    expect(text.startsWith('◇♥')).toBe(true);
    expect([...text].filter((item) => item === '◇')).toHaveLength(1);
  });
});
