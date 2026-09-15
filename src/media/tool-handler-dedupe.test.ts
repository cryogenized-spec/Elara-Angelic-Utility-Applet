import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem, MediaSearchOutcome } from '../domain/media';
import type { MediaSearchBatchResult } from './search';

const searchMedia = vi.fn();
vi.mock('./search', () => ({ searchMedia: () => searchMedia() as Promise<MediaSearchBatchResult> }));

const { mediaToolHandlers } = await import('./tool-handler');
const handler = mediaToolHandlers['youtube.search'];

function item(id: string, title: string): MediaItem {
  return {
    provider: 'youtube',
    id,
    kind: 'video',
    title,
    webUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

function outcome(query: string, items: MediaItem[]): MediaSearchOutcome {
  return { query, normalizedQuery: query, source: 'network', truncated: false, items };
}

beforeEach(() => searchMedia.mockReset());

describe('youtube tool flattened presentation identity', () => {
  it('deduplicates the flattened card collection but preserves per-query provider results', async () => {
    searchMedia.mockResolvedValue({
      outcomes: [
        outcome('first', [item('same', 'First copy'), item('a', 'A')]),
        outcome('second', [item('same', 'Latest copy'), item('b', 'B')]),
      ],
      failures: [],
      networkCalls: 2,
    });

    const result = await handler?.({ arguments: { queries: ['first', 'second'] } } as never) as {
      items: MediaItem[];
      results: Array<{ items: readonly MediaItem[] }>;
    };

    expect(result.items.map((entry) => `${entry.id}:${entry.title}`)).toEqual([
      'same:Latest copy',
      'a:A',
      'b:B',
    ]);
    expect(result.results[0].items.map((entry) => entry.title)).toEqual(['First copy', 'A']);
    expect(result.results[1].items.map((entry) => entry.title)).toEqual(['Latest copy', 'B']);
  });
});