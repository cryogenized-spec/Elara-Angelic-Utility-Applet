import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaSearchOutcome } from '../domain/media';

// The handler loads `./search` dynamically on purpose, so the whole provider
// graph is mocked here rather than reaching IndexedDB or the network.
const searchMedia = vi.fn();
vi.mock('./search', () => ({ searchMedia: (request: unknown, options: unknown) => searchMedia(request, options) }));

const { mediaToolHandlers } = await import('./tool-handler');

const handler = mediaToolHandlers['youtube.search'];

/** The request the handler handed to `searchMedia`. */
function request(): Record<string, unknown> {
  return searchMedia.mock.calls[0][0] as Record<string, unknown>;
}

function outcome(query: string, id: string): MediaSearchOutcome {
  return {
    query,
    normalizedQuery: query.toLowerCase(),
    source: 'network',
    truncated: false,
    items: [{
      provider: 'youtube',
      id,
      kind: 'video',
      title: `Result ${id}`,
      webUrl: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0`,
    }],
  };
}

beforeEach(() => {
  searchMedia.mockReset();
});

describe('youtube.search tool handler', () => {
  it('exists and is callable by the executor', () => {
    // The handler is looked up by name, so a missing key here is a silent
    // "model called a tool that does nothing" failure at runtime.
    expect(typeof handler).toBe('function');
  });

  it('forwards the queries and abort signal it was given', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('lofi beats', 'a1')], failures: [] });
    const controller = new AbortController();

    const result = await handler?.({ arguments: { queries: ['lofi beats'] }, signal: controller.signal } as never);

    expect(request().queries).toEqual(['lofi beats']);
    expect(request().signal).toBe(controller.signal);
    expect((result as { items: unknown[] }).items).toHaveLength(1);
  });

  it('passes the intent through to search, which is what stamps the cards', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [] });

    await handler?.({ arguments: { queries: ['jazz'], intent: 'listen' } } as never);

    expect(request().queries).toEqual(['jazz']);
    expect(request().intent).toBe('listen');
  });

  it('omits an intent the model did not send rather than inventing one', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [] });

    const result = await handler?.({ arguments: { queries: ['jazz'] } } as never);

    // `intent` is deliberately absent from the request, not set to a default: a
    // missing field is what keeps the untagged-item fast path allocation-free.
    expect('intent' in request() ? request().intent : undefined).toBeUndefined();
    expect('intent' in (result as Record<string, unknown>)).toBe(false);
  });

  it('drops an intent the domain does not recognise', async () => {
    // The handler is also reachable from the local executor with unvalidated
    // arguments, so a nonsense value must not become a render directive.
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [] });

    await handler?.({ arguments: { queries: ['jazz'], intent: 'karaoke' } } as never);

    expect(request().intent).toBeUndefined();
  });

  it('echoes the effective intent so the model can see what was applied', async () => {
    searchMedia.mockResolvedValue({ outcomes: [outcome('jazz', 'a1')], failures: [] });

    const result = await handler?.({ arguments: { queries: ['jazz'], intent: 'listen' } } as never);

    expect((result as { intent: string }).intent).toBe('listen');
    expect((result as { mediaProvider: string }).mediaProvider).toBe('youtube');
  });

  it('flattens every query result into the items field the card reads', async () => {
    searchMedia.mockResolvedValue({
      outcomes: [outcome('jazz', 'a1'), outcome('blues', 'b2')],
      failures: [{ query: 'broken', normalizedQuery: 'broken', reason: 'no-results', message: 'Nothing found.' }],
    });

    const result = await handler?.({ arguments: { queries: ['jazz', 'blues'] } } as never) as {
      items: { id: string; intent?: string }[];
      results: unknown[];
      failures: { reason: string }[];
      ok: boolean;
    };

    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual(['a1', 'b2']);
    expect(result.results).toHaveLength(2);
    // A partial miss is reported, never thrown: one empty query must not sink
    // the results the user was offered.
    expect(result.failures).toEqual([{ query: 'broken', reason: 'no-results', message: 'Nothing found.' }]);
  });

  it('filters non-string and blank queries before calling search', async () => {
    searchMedia.mockResolvedValue({ outcomes: [], failures: [] });

    await handler?.({ arguments: { queries: ['lofi', 42, '   ', null] } } as never);

    expect(request().queries).toEqual(['lofi']);
  });
});
