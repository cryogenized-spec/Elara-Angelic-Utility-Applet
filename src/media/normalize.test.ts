import { describe, expect, it } from 'vitest';
import { dedupeMediaQueries, mediaCacheKey, normalizeMediaQuery } from './normalize';

describe('media query normalization', () => {
  it('treats cosmetic differences as the same query', () => {
    const variants = [
      'Dark Ambient Music',
      'dark ambient music',
      '  dark   ambient   music  ',
      'dark ambient music!',
      'dark ambient music?',
    ];
    const normalized = new Set(variants.map(normalizeMediaQuery));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe('dark ambient music');
  });

  it('keeps meaning-bearing punctuation inside a query', () => {
    // Only the edges are stripped; "drum & bass" must survive intact.
    expect(normalizeMediaQuery(' drum & bass ')).toBe('drum & bass');
  });

  it('folds Unicode compatibility forms so one song is one cache entry', () => {
    // U+FB01 LATIN SMALL LIGATURE FI vs the two-letter sequence.
    expect(normalizeMediaQuery('\uFB01lm score')).toBe(normalizeMediaQuery('film score'));
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeMediaQuery('!!!')).toBe('');
    expect(normalizeMediaQuery('   ')).toBe('');
  });

  it('namespaces and versions the cache key', () => {
    const key = mediaCacheKey('youtube', 'Dark  Ambient');
    expect(key).toBe('youtube:v1:dark ambient');
    // A different provider must not collide with the same words.
    expect(mediaCacheKey('other', 'Dark  Ambient')).not.toBe(key);
  });

  it('deduplicates a batch while preserving first-seen order', () => {
    const result = dedupeMediaQueries([
      'Dark Ambient',
      'lofi beats',
      'dark  ambient!',
      'Dark Ambient',
      '   ',
      'jazz piano',
    ]);
    expect(result).toEqual(['Dark Ambient', 'lofi beats', 'jazz piano']);
  });

  it('drops empty and whitespace-only entries entirely', () => {
    expect(dedupeMediaQueries(['', '   ', '\n'])).toEqual([]);
  });
});
