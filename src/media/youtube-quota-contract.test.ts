import { describe, expect, it } from 'vitest';
import { MAX_MEDIA_QUERIES_PER_CALL } from '../domain/media';
import { googleGeminiFunctionDeclarations } from '../google/tools/gemini-declarations';
import { SEARCH_BUDGET_PER_SESSION } from './budget';
import { validateYouTubeToolArguments } from './youtube-schema';

describe('YouTube quota-efficiency contract', () => {
  it('hard-bounds one Gemini tool call and one browser session', () => {
    expect(MAX_MEDIA_QUERIES_PER_CALL).toBe(3);
    expect(SEARCH_BUDGET_PER_SESSION).toBe(8);

    expect(validateYouTubeToolArguments('youtube.search', {
      queries: ['one', 'two', 'three'],
      intent: 'listen',
    }).queries).toHaveLength(3);

    expect(() => validateYouTubeToolArguments('youtube.search', {
      queries: ['one', 'two', 'three', 'four'],
    })).toThrow();
  });

  it('teaches Gemini one-query-by-default instead of synonym expansion', () => {
    const youtube = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'youtube.search');
    expect(youtube).toBeDefined();
    expect(youtube?.description).toContain('one concise query by default');
    expect(youtube?.description).not.toContain('durations');

    const queries = youtube?.parameters.properties.queries as {
      maxItems?: number;
      description?: string;
    } | undefined;
    expect(queries?.maxItems).toBe(MAX_MEDIA_QUERIES_PER_CALL);
    expect(queries?.description).toContain('Use one query by default');
    expect(queries?.description).toContain('Never add synonyms or rephrasings');
  });
});
