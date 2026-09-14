import type { GoogleToolHandlers } from '../google/tools/executor';
import { isMediaIntent, mergeMediaItems, type MediaItem } from '../domain/media';

const MEDIA_MODEL_RESULT = Symbol('elara.media.model-result');

interface MediaModelItem {
  readonly id: string;
  readonly kind: MediaItem['kind'];
  readonly title: string;
  readonly channel?: string;
}

interface MediaModelResult {
  readonly ok: true;
  readonly provider: 'youtube';
  readonly intent?: MediaItem['intent'];
  readonly results: readonly {
    readonly query: string;
    readonly items: readonly MediaModelItem[];
  }[];
  readonly failures: readonly {
    readonly query: string;
    readonly reason: string;
    readonly message: string;
  }[];
}

type ApplicationMediaToolResult = Record<string, unknown> & {
  readonly [MEDIA_MODEL_RESULT]: MediaModelResult;
};

function modelItem(item: MediaItem): MediaModelItem {
  return Object.freeze({
    id: item.id,
    kind: item.kind,
    title: item.title,
    ...(item.channel ? { channel: item.channel } : {}),
  });
}

/**
 * Explicit model-facing projection for the media tool.
 *
 * The application result carries thumbnails, canonical URLs, retention stamps
 * and flattened card state. Gemini needs none of those fields. Keeping this
 * projection on a non-enumerable Symbol means ordinary serialization cannot
 * accidentally duplicate the full browser payload into the continuation.
 */
export function mediaToolResultForModel(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return Object.freeze({ ok: false, error: 'MEDIA_RESULT_UNAVAILABLE' });
  }
  const projection = (value as Partial<ApplicationMediaToolResult>)[MEDIA_MODEL_RESULT];
  return projection ?? Object.freeze({ ok: false, error: 'MEDIA_RESULT_UNAVAILABLE' });
}

/**
 * Tool handler for `youtube.search`.
 *
 * This module is statically reachable from the tool loop, so it stays tiny: the
 * provider, cache, budget, and Zod graph are all reached through a dynamic
 * `import()` and therefore land in a lazy chunk instead of the initial bundle.
 * Nothing about media search loads until the model actually calls the tool.
 *
 * The application result carries a `mediaProvider` marker. The tool loop derives
 * the `media-resolved` stream event from it, so the card is driven by structured
 * data and never by parsing the assistant's prose. A separate non-enumerable
 * projection is the only representation returned to Gemini.
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

    // The flattened browser collection is collapsed by provider-scoped identity;
    // first sighting owns the slot while the latest valid representation owns its
    // data. The model projection below remains per-query and therefore faithful to
    // each provider outcome rather than reconstructing associations from the merge.
    const flattened: MediaItem[] = outcomes.flatMap((outcome) => [...outcome.items]);
    const items = mergeMediaItems([], flattened);
    const compactFailures = Object.freeze(failures.map((failure) => Object.freeze({
      query: failure.query,
      reason: failure.reason,
      message: failure.message,
    })));
    const modelResult: MediaModelResult = Object.freeze({
      ok: true,
      provider: 'youtube',
      ...(intent ? { intent } : {}),
      results: Object.freeze(outcomes.map((outcome) => Object.freeze({
        query: outcome.query,
        items: Object.freeze(outcome.items.map(modelItem)),
      }))),
      failures: compactFailures,
    });

    const applicationResult: Record<string, unknown> = {
      ok: true,
      mediaProvider: 'youtube',
      ...(intent ? { intent } : {}),
      queries: outcomes.map((outcome) => outcome.query),
      failures: compactFailures,
      // Full metadata exists exactly once for the browser/card projection.
      items,
    };
    Object.defineProperty(applicationResult, MEDIA_MODEL_RESULT, {
      configurable: false,
      enumerable: false,
      value: modelResult,
      writable: false,
    });
    return applicationResult as ApplicationMediaToolResult;
  },
};
