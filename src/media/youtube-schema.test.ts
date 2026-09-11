import { describe, expect, it } from 'vitest';
import { validateYouTubeToolArguments, youtubeToolArgumentSchemas } from './youtube-schema';
import { googleGeminiFunctionDeclarations } from '../google/tools/gemini-declarations';
import { MAX_MEDIA_QUERIES_PER_CALL } from '../domain/media';

describe('youtube.search argument contract', () => {
  it('accepts a single query', () => {
    expect(validateYouTubeToolArguments('youtube.search', { queries: ['dark ambient'] }))
      .toEqual({ queries: ['dark ambient'] });
  });

  it('accepts the full batch and rejects one more', () => {
    const full = Array.from({ length: MAX_MEDIA_QUERIES_PER_CALL }, (_, index) => `query ${index}`);
    expect(validateYouTubeToolArguments('youtube.search', { queries: full }).queries).toHaveLength(MAX_MEDIA_QUERIES_PER_CALL);

    expect(() => validateYouTubeToolArguments('youtube.search', { queries: [...full, 'one too many'] })).toThrow();
  });

  it('rejects an empty batch', () => {
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: [] })).toThrow();
  });

  it('rejects blank queries', () => {
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: ['   '] })).toThrow();
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: [''] })).toThrow();
  });

  it('rejects non-string entries', () => {
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: [42] })).toThrow();
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: [{ q: 'x' }] })).toThrow();
  });

  it('rejects a queries value that is not a list', () => {
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: 'dark ambient' })).toThrow();
  });

  it('exposes no pagination surface at all', () => {
    // Paging would be a whole additional search.list call against a small
    // dedicated bucket. The contract must not offer it, so the model cannot ask.
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: ['x'], pageToken: 'abc' })).toThrow();
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: ['x'], maxResults: 50 })).toThrow();
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: ['x'], nextPageToken: 'abc' })).toThrow();
    expect(Object.keys(youtubeToolArgumentSchemas['youtube.search'].shape)).toEqual(['queries']);
  });

  it('declares queries as required in the Gemini function schema', () => {
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    expect(declaration).toBeTruthy();
    expect(declaration!.parameters.required).toEqual(['queries']);
    expect(declaration!.parameters.additionalProperties).toBe(false);
    expect(declaration!.parameters.properties.queries).toMatchObject({ type: 'array' });
  });

  it('caps the declared array length at the documented batch maximum', () => {
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    const queries = declaration!.parameters.properties.queries as { maxItems?: number; minItems?: number };
    expect(queries.maxItems).toBe(MAX_MEDIA_QUERIES_PER_CALL);
    expect(queries.minItems).toBe(1);
  });
});
