import type { GoogleToolHandlers } from '../google/tools/executor';
import type { MediaItem } from '../domain/media';

/**
 * Tool handler for `youtube.search`.
 *
 * This module is statically reachable from the tool loop, so it stays tiny: the
 * provider, cache, budget, and Zod graph are all reached through a dynamic
 * `import()` and therefore land in a lazy chunk instead of the initial bundle.
 * Nothing about media search loads until the model actually calls the tool.
 *
 * The result carries a `mediaProvider` marker. The tool loop derives the
 * `media-resolved` stream event from it, so the card is driven by structured
 * data and never by parsing the assistant's prose.
 */
export const mediaToolHandlers: GoogleToolHandlers = {
  'youtube.search': async (context) => {
    const queries = Array.isArray(context.arguments.queries)
      ? (context.arguments.queries as unknown[]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    // Loaded here, not at module scope: see the note above.
    const { searchMedia } = await import('./search');

    const { outcomes, failures } = await searchMedia({
      queries,
      signal: context.signal,
    });

    const items: MediaItem[] = outcomes.flatMap((outcome) => [...outcome.items]);

    return {
      ok: true,
      mediaProvider: 'youtube',
      queries: outcomes.map((outcome) => outcome.query),
      results: outcomes.map((outcome) => ({
        query: outcome.query,
        source: outcome.source,
        items: outcome.items,
      })),
      failures: failures.map((failure) => ({
        query: failure.query,
        reason: failure.reason,
        message: failure.message,
      })),
      // Flattened for convenience, and the field the media card reads.
      items,
    };
  },
};
