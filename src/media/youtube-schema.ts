import { z } from 'zod';
import { isMediaIntent, MAX_MEDIA_QUERIES_PER_CALL, MEDIA_INTENTS } from '../domain/media';

/**
 * Reads the shapes a model emits for "not provided".
 *
 * `null` and `""` are common in generated arguments, and a search the user asked
 * for must not fail because an optional decoration of that search arrived empty.
 * A value that is *wrong* rather than absent (`'karaoke'`) is deliberately left
 * untouched so the enum still rejects it and the model is told why.
 */
function readIntentArgument(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

/**
 * Argument contract for the `youtube.search` tool.
 *
 * Mirrors the shape of the other per-domain schema modules so the executor can
 * validate it through the same dispatch as every other tool.
 *
 * There is deliberately no `pageToken` and no `maxResults` argument. Paging is
 * forbidden because each page is a whole additional `search.list` call against a
 * small dedicated daily bucket, and letting the model choose `maxResults` would
 * invite it to ask for more than the budget can serve.
 *
 * `intent` is the one argument that changes nothing about the provider request,
 * so it is safe to accept: it selects how the app hands the result to the user,
 * not what YouTube is asked for.
 */
export const youtubeToolArgumentSchemas = {
  'youtube.search': z.object({
    queries: z.array(z.string().trim().min(1).max(200))
      .min(1)
      .max(MAX_MEDIA_QUERIES_PER_CALL),
    // Enumerated from the domain constant, so a new intent is one edit in
    // `domain/media` and cannot arrive here as a value the renderer ignores.
    intent: z.preprocess(readIntentArgument, z.enum(MEDIA_INTENTS).optional()),
  }).strict(),
} as const;

export type YouTubeToolName = keyof typeof youtubeToolArgumentSchemas;
export type YouTubeToolArguments<T extends YouTubeToolName> = z.infer<(typeof youtubeToolArgumentSchemas)[T]>;

export function validateYouTubeToolArguments<T extends YouTubeToolName>(tool: T, value: unknown): YouTubeToolArguments<T> {
  return youtubeToolArgumentSchemas[tool].parse(value) as YouTubeToolArguments<T>;
}
