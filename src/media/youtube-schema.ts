import { z } from 'zod';
import { MAX_MEDIA_QUERIES_PER_CALL } from '../domain/media';

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
 */
export const youtubeToolArgumentSchemas = {
  'youtube.search': z.object({
    queries: z.array(z.string().trim().min(1).max(200))
      .min(1)
      .max(MAX_MEDIA_QUERIES_PER_CALL),
  }).strict(),
} as const;

export type YouTubeToolName = keyof typeof youtubeToolArgumentSchemas;
export type YouTubeToolArguments<T extends YouTubeToolName> = z.infer<(typeof youtubeToolArgumentSchemas)[T]>;

export function validateYouTubeToolArguments<T extends YouTubeToolName>(tool: T, value: unknown): YouTubeToolArguments<T> {
  return youtubeToolArgumentSchemas[tool].parse(value) as YouTubeToolArguments<T>;
}
