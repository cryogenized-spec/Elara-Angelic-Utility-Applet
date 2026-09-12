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
    // `intent` is the only addition, and it is accepted precisely because it
    // costs nothing at the provider. Everything else stays off the surface.
    expect(Object.keys(youtubeToolArgumentSchemas['youtube.search'].shape)).toEqual(['queries', 'intent']);
  });

  it('declares queries as required in the Gemini function schema', () => {
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    expect(declaration).toBeTruthy();
    expect(declaration!.parameters.required).toEqual(['queries']);
    expect(declaration!.parameters.additionalProperties).toBe(false);
    expect(declaration!.parameters.properties.queries).toMatchObject({ type: 'array' });
  });

  it('accepts the intent the declaration offers, and only its enum values', () => {
    // The two halves of one contract: a value the schema rejects would make the
    // model's call fail, and a value the declaration omits is one the model can
    // never send. Either drift turns an optional nicety into a broken tool call.
    expect(validateYouTubeToolArguments('youtube.search', { queries: ['jazz'], intent: 'listen' }))
      .toEqual({ queries: ['jazz'], intent: 'listen' });
    expect(validateYouTubeToolArguments('youtube.search', { queries: ['jazz'] })).toEqual({ queries: ['jazz'] });
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: ['jazz'], intent: 'karaoke' })).toThrow();
    expect(() => validateYouTubeToolArguments('youtube.search', { queries: ['jazz'], intent: 42 })).toThrow();
  });

  it('treats the shapes a model uses for "not provided" as the default, not an error', () => {
    // A model frequently sends null or "" for an optional field. Failing the whole
    // call over that would deny the user a search they did ask for.
    for (const absent of [null, '', undefined]) {
      const validated = validateYouTubeToolArguments('youtube.search', { queries: ['jazz'], intent: absent });
      expect(validated.queries).toEqual(['jazz']);
      expect(validated.intent ?? undefined).toBeUndefined();
    }
  });

  it('still rejects a wrong intent, and says what was allowed', () => {
    // Rejection here is informative rather than silent: the model is told the two
    // accepted values and can retry, instead of quietly getting the wrong surface.
    let message = '';
    try {
      validateYouTubeToolArguments('youtube.search', { queries: ['jazz'], intent: 'karaoke' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('watch');
    expect(message).toContain('listen');

    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    const intent = declaration!.parameters.properties.intent as { type: string; enum: string[] };
    expect(intent).toMatchObject({ type: 'string', enum: ['watch', 'listen'] });
    expect(declaration!.parameters.required).not.toContain('intent');
  });

  it('describes the intent to the model well enough that it is used correctly', () => {
    // A parameter whose description does not say when to use it is a parameter
    // that will be ignored, so the guidance is part of the contract under test.
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    const intent = declaration!.parameters.properties.intent as { description: string };

    expect(intent.description).toMatch(/listen/i);
    expect(intent.description).toMatch(/music|audio/i);
    expect(intent.description).toMatch(/watch/i);
    expect(intent.description.length).toBeGreaterThan(40);
  });

  it('caps the declared array length at the documented batch maximum', () => {
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    const queries = declaration!.parameters.properties.queries as { maxItems?: number; minItems?: number };
    expect(queries.maxItems).toBe(MAX_MEDIA_QUERIES_PER_CALL);
    expect(queries.minItems).toBe(1);
  });
});
