import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSearchOutcome } from '../domain/media';
import type { MediaSearchBatchResult } from './search';

// The handler loads `./search` dynamically on purpose, so the whole provider
// graph is mocked here rather than reaching IndexedDB or the network.
const searchMedia = vi.fn();
vi.mock('./search', () => ({ searchMedia: (request: unknown, options: unknown) => searchMedia(request, options) as Promise<MediaSearchBatchResult> }));

const { mediaToolHandlers } = await import('./tool-handler');

const handler = mediaToolHandlers['youtube.search'];

/** The request the handler handed to `searchMedia`. */
function request(): Record<string, unknown> {
  return searchMedia.mock.calls[0][0] as Record<string, unknown>;
}

function outcome(query: string, id: string, title: string = `Result ${id}`): MediaSearchOutcome {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    source: 'network',
    truncated: false,
    items: [{
      provider: 'youtube',
      id,
      kind: 'video',
      title,
      channel: 'Channel',
      thumbnail: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 },
      webUrl: `https://www.youtube.com/watch?v=${id}`,
      apiDataFetchedAt: 1_800_000_000_000,
    }],
  };
}

beforeEach(() => {
  searchMedia.mockReset();
});

describe('youtube.search tool handler', () => {
  it('exists and is callable by the executor', () => {
    expect(typeof handler).toBe('function');
  });

  it('forwards the queries and abort signal it was given', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('lofi beats', 'a1')], failures: [], networkCalls: 1 });
    const controller = new AbortController();

    const result = await handler?.({ arguments: { queries: ['lofi beats'] }, signal: controller.signal } as never);

    expect(request().queries).toEqual(['lofi beats']);
    expect(request().signal).toBe(controller.signal);
    expect((result as { items: unknown[] }).items).toHaveLength(1);
  });

  it('passes the intent through to search and exposes only the effective intent to Gemini', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [], networkCalls: 1 });

    const result = await handler?.({ arguments: { queries: ['jazz'], intent: 'listen' } } as never) as Record<string, unknown>;

    expect(request().queries).toEqual(['jazz']);
    expect(request().intent).toBe('listen');
    expect(result.intent).toBe('listen');
    expect(result.provider).toBe('youtube');
    expect((result as { mediaProvider: string }).mediaProvider).toBe('youtube');
  });

  it('omits an intent the model did not send rather than inventing one', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [], networkCalls: 1 });

    const result = await handler?.({ arguments: { queries: ['jazz'] } } as never) as Record<string, unknown>;

    expect('intent' in request() ? request().intent : undefined).toBeUndefined();
    expect('intent' in result).toBe(false);
  });

  it('drops an intent the domain does not recognise', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [], networkCalls: 1 });

    await handler?.({ arguments: { queries: ['jazz'], intent: 'karaoke' } } as never);

    expect(request().intent).toBeUndefined();
  });

  it('keeps full browser media accessible while excluding it from JSON sent to Gemini', async () => {
    searchMedia.mockResolvedValue({
      outcomes: [outcome('jazz', 'a1'), outcome('blues', 'b2')],
      failures: [{ query: 'broken', normalizedQuery: 'broken', reason: 'no-results', message: 'Nothing found.' }],
      networkCalls: 2,
    });

    const result = await handler?.({ arguments: { queries: ['jazz', 'blues'] } } as never) as Record<string, unknown> & {
      items: Array<{ id: string }>;
      queries: string[];
    };

    expect(result.items.map((item) => item.id)).toEqual(['a1', 'b2']);
    expect(result.queries).toEqual(['jazz', 'blues']);
    expect(Object.prototype.propertyIsEnumerable.call(result, 'items')).toBe(false);
    expect(Object.prototype.propertyIsEnumerable.call(result, 'queries')).toBe(false);
    expect(Object.prototype.propertyIsEnumerable.call(result, 'mediaProvider')).toBe(false);

    const wire = JSON.stringify(result);
    expect(wire).toContain('"provider":"youtube"');
    expect(wire).toContain('"title":"Result a1"');
    expect(wire).not.toContain('thumbnail');
    expect(wire).not.toContain('webUrl');
    expect(wire).not.toContain('embedUrl');
    expect(wire).not.toContain('apiDataFetchedAt');
    expect(wire).not.toContain('mediaProvider');
    expect(wire).not.toContain('"items":[{"provider"');
  });

  it('preserves per-query provider representations while browser dedupe keeps the newest one', async () => {
    searchMedia.mockResolvedValue({
      outcomes: [
        outcome('first', 'same-id', 'First representation'),
        outcome('second', 'same-id', 'Refreshed representation'),
      ],
      failures: [],
      networkCalls: 2,
    });

    const result = await handler?.({ arguments: { queries: ['first', 'second'] } } as never) as Record<string, unknown> & {
      items: Array<{ id: string; title: string }>;
      results: Array<{ query: string; items: Array<{ title: string }> }>;
    };

    expect(result.items).toEqual([expect.objectContaining({ id: 'same-id', title: 'Refreshed representation' })]);
    expect(result.results.map((entry) => entry.items[0].title)).toEqual([
      'First representation',
      'Refreshed representation',
    ]);
  });

  it('reports partial failures in the lean model payload without duplicating full results', async () => {
    searchMedia.mockResolvedValue({
      outcomes: [outcome('jazz', 'a1')],
      failures: [{ query: 'broken', normalizedQuery: 'broken', reason: 'no-results', message: 'Nothing found.' }],
      networkCalls: 1,
    });

    const result = await handler?.({ arguments: { queries: ['jazz', 'broken'] } } as never) as Record<string, unknown> & {
      failures: Array<{ reason: string }>;
    };

    expect(result.failures).toEqual([{ query: 'broken', reason: 'no-results', message: 'Nothing found.' }]);
    expect(Object.keys(result).sort()).toEqual(['failures', 'ok', 'provider', 'results']);
  });

  it('filters non-string and blank queries before calling search', async () => {
    searchMedia.mockResolvedValue({ outcomes: [], failures: [], networkCalls: 0 });

    await handler?.({ arguments: { queries: ['lofi', 42, '   ', null] } } as never);

    expect(request().queries).toEqual(['lofi']);
  });
});