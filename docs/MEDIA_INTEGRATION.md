# Media integration — YouTube search

## Status

Implemented, browser-direct, behind a first-class Gemini function tool.

## Why this shape

The YouTube Data API v3 changed its quota model on 2026-06-01. `search.list` no
longer draws from the shared 10,000-unit daily pool; it bills against **its own
dedicated bucket capped at roughly 100 calls per day**, resetting at midnight
Pacific. There is no paid tier — increases require a manual audit request.

Two consequences drive the whole design:

1. `maxResults` does not change the number of calls. Asking for more items is
   free; asking for another **page** costs a whole additional call.
2. A quota exhaustion locks the user's key out for the rest of the day.

So this is a call-avoidance architecture, not a caching optimization bolted onto
one. The order is always **dedupe → cache → budget → network**, and only the last
step touches the API.

There is no server in this path. The browser calls `googleapis.com` directly with
the user's own key from the Lockbox, mirroring how the browser already calls
Calendar, Chat, and Docs. There is no Worker endpoint, no KV binding, and no
second Gemini client.

## Layer boundaries

| Layer | Path | Rule |
| --- | --- | --- |
| Contract | `src/domain/media.ts` | Provider-agnostic. No YouTube types cross it. |
| Normalization | `src/media/normalize.ts` | Pure. Shared by cache key, budget, and dedupe. |
| Budget | `src/media/budget.ts` | Pure, injectable clock. Per page session. |
| Cache | `src/media/cache.ts` | Own Dexie DB, `elara-media-cache`. |
| Provider | `src/media/youtube/service.ts` | The only file that knows the YouTube response shape. |
| Orchestration | `src/media/search.ts` | Order of operations. Provider-agnostic. |
| Tool | `src/media/tool-handler.ts` | Registry entry point; dynamically imports the rest. |
| Event | `src/gemini/google-tool-loop.ts` | Derives `media-resolved` from the tool result. |
| UI | `src/app/components/media/` | `React.lazy` boundary plus the card. |

A second provider is an addition: implement `MediaProvider`, add its id to
`MEDIA_PROVIDER_IDS`, register a tool. Nothing in the loop or the card changes.

## Invariants

These are enforced by test, not by convention. Each has a mutation test that was
confirmed to fail when the invariant is broken.

**Quota**
- Exactly one `search.list` call per query.
- `nextPageToken` is ignored. There is no pagination argument in the tool schema,
  so the model cannot request one.
- No `videos.list` follow-up. `durationSeconds` is optional and unset rather than
  bought with a second call.
- A batch of up to `MAX_MEDIA_QUERIES_PER_CALL` (8) queries is deduplicated
  before anything is spent. Two phrasings of one question cost one call.
- The per-session budget (`SEARCH_BUDGET_PER_SESSION`, 12) gates network searches
  only; cached answers are free.

**Credentials**
- The key travels in the `x-goog-api-key` **header**, never the query string.
  Query strings reach proxy logs, DevTools history, and error reports; headers do
  not.
- The key never appears in a tool result, a cache value, a `media-resolved`
  event, or an error message. Provider errors are mapped onto a fixed domain
  vocabulary and the raw response body is discarded.
- Cache records contain rendered `MediaItem` data only, and the exact field set is
  asserted so a future field that smuggles a credential in fails the test.

**Execution plane**
- `youtube.search` is declared `executionPlane: 'browser'`. The Worker filters its
  declarations through `googleGeminiFunctionDeclarationsForPlane('worker')` and
  therefore never advertises it.
- This closes a pre-existing gap: the Worker imports the central registry but has
  no tool executor, so before this field any new tool was advertised by the Worker
  whether or not the Worker could run it. Tools with no declared plane run
  anywhere, which preserves existing behaviour for every OAuth-backed tool.

**Presentation**
- Media arrives as a structured `media-resolved` stream event derived from the
  tool result. Nothing regex-parses the assistant's prose.
- The card is a link, not a player. No iframe, no player script. Accidental audio
  is impossible by construction rather than prevented by a flag.
- A fallback search link is never presented as a resolved video. An empty search
  emits no event and renders no card.
- `embedUrl` is provided with `autoplay=0` for a future inline player; the
  no-autoplay property is asserted by test.

## Failure handling

The cache is best effort in both directions. A read fault is treated as a miss
and a write fault is swallowed: losing a cache entry costs one API call, while
failing the search costs the user their answer.

A failed query does not sink its batch. Each query resolves independently, so the
model can still answer with whatever did resolve. A provider failure that never
left the browser releases its budget reservation, so a misconfigured key cannot
silently drain the allowance.

Failures are reported to the model in plain language with a `MediaFailureReason`
— `no-api-key`, `budget-exhausted`, `quota-exceeded`, `rate-limited`, `network`,
`invalid-request`, `no-results`, `unknown` — so it can tell the user what to do
rather than inventing an explanation.

## Persistence

Resolved items are stored on the assistant message as `ChatMessage.media`, an
optional unindexed field. Adding it requires **no Dexie version bump**, because
Dexie does not enforce a schema on non-indexed properties. Cards therefore
survive a reload. Media values carry no credential material.

## Bundle cost

The `src/media` graph is reached only through a dynamic `import()` inside the tool
handler, and `MediaCard` sits behind `React.lazy`. Measured against the build:

| Chunk | Size | gzip |
| --- | --- | --- |
| `MediaCard-*.js` (lazy) | 0.86 kB | 0.43 kB |
| `search-*.js` (lazy) | 6.56 kB | 2.80 kB |
| `index-*.js` delta | +3.77 kB | +1.39 kB |

The main bundle grows only by the registry entry, the function declaration, the
Zod argument schema, the small handler stub, and the domain contract. None of the
provider, cache, or budget code loads until a media search actually runs.

## Deliberately not built

- No Worker endpoint and no KV cache. The original design assumed both; with
  browser-direct BYOK there is no server to hold them, and the client cache plus
  per-session budget replace them.
- No scraping, no `yt-dlp`, no `ytmusicapi`, no undocumented endpoints.
- No inline player. Add one later against `embedUrl` if it is wanted; the
  no-autoplay invariant already guards it.
- No `videos.list` enrichment. Durations stay unknown.
