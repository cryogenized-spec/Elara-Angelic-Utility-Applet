import type { GoogleToolHandlers } from '../google/tools/executor';
import { isMediaIntent, mergeMediaItems, type MediaItem } from '../domain/media';

interface MediaModelItem {
  readonly id: string;
  readonly kind: MediaItem['kind'];
  readonly title: string;
  readonly channel?: string;
}

function modelItem(item: MediaItem): MediaModelItem {
  return Object.freeze({
    id: item.id,
    kind: item.kind,
    title: item.title,
    ...(item.channel ? { channel: item.channel } : {}),
  });
}

/**
 * Tool handler for `youtube.search`.
 *
 * This module is statically reachable from the tool loop, so it stays tiny: the
 * provider, cache, budget, and Zod graph are all reached through a dynamic
 * `import()` and therefore land in a lazy chunk instead of the initial bundle.
 * Nothing about media search loads until the model actually calls the tool.
 *
 * One result object serves both consumers without duplicating authorities:
 * enumerable fields are the deliberately lean Gemini continuation payload;
 * browser-only card fields are non-enumerable properties on that same object.
 * The existing tool loop can read `mediaProvider`, `queries` and `items`
 * directly, while ordinary JSON serialization cannot send those heavy fields
 * back to Gemini accidentally.
 */
export const mediaToolHandlers: GoogleToolHandlers = {
  'youtube.search': async (context) => {
    const queries = Array.isArray(context.arguments.queries)
      ? (context.arguments.queries as unknown[]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    // Narrowed rather than trusted. The schema validates this on the Gemini path,
    // but the same handler is reachable from the local executor, and a value that
    // is merely unrecognised must fall back to the default instead of being
    // forwarded into the renderer.
    const intent = isMediaIntent(context.arguments.intent) ? context.arguments.intent : undefined;

    // Loaded here, not at module scope: see the note above.
    const { searchMedia } = await import('./search');

    const { outcomes, failures } = await searchMedia({
      queries,
      intent,
      signal: context.signal,
    });

    // Browser presentation is collapsed by provider-scoped identity; first
    // sighting owns order and the newest valid representation owns slot data.
    const flattened: MediaItem[] = outcomes.flatMap((outcome) => [...outcome.items]);
    const items = mergeMediaItems([], flattened);
    const compactFailures = Object.freeze(failures.map((failure) => Object.freeze({
      query: failure.query,
      reason: failure.reason,
      message: failure.message,
    })));

    // Gemini receives only the fields it needs to reason about what was found.
    // Per-query items come directly from each provider outcome so duplicate ids
    // across distinct searches remain faithful to that search's representation.
    const result: Record<string, unknown> = {
      ok: true,
      provider: 'youtube',
      ...(intent ? { intent } : {}),
      results: Object.freeze(outcomes.map((outcome) => Object.freeze({
        query: outcome.query,
        items: Object.freeze(outcome.items.map(modelItem)),
      }))),
      failures: compactFailures,
    };

    Object.defineProperties(result, {
      mediaProvider: { configurable: false, enumerable: false, value: 'youtube', writable: false },
      queries: {
        configurable: false,
        enumerable: false,
        value: Object.freeze(outcomes.map((outcome) => outcome.query)),
        writable: false,
      },
      items: { configurable: false, enumerable: false, value: Object.freeze(items), writable: false },
    });

    return Object.freeze(result);
  },
};
