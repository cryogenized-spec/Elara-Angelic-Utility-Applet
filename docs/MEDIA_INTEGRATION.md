# Media integration — YouTube search

## Status

Implemented, browser-direct, behind a first-class Gemini function tool. Results
are handed to the platform for playback; the applet never plays media itself.

The tool takes an optional `intent` (`watch` | `listen`) so a request for music and
a request for video can be routed to different platform surfaces. See
[Hand-off](#hand-off).

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
| Hand-off | `src/media/handoff.ts` | Pure. Turns an item plus a platform into a destination URL. No DOM, no provider knowledge. |
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
  is impossible by construction rather than prevented by a flag. This holds for
  `listen` as well as `watch`: an audio intent is a reason to hand off, not a
  licence to add an `<audio>` element.
- The whole card is one `<a>`. There is no nested anchor or button, so there is no
  dead zone in the tap target and no second control to miss.
- The card's promise and its behaviour are asserted to agree: the tooltip names
  the same destination the `href` will actually open (`in your music app` on
  Android, `in YouTube Music` elsewhere, `on YouTube` for video), derived from one
  platform read shared with the href builder.
- No duration overlay is rendered, because the provider never returns one. A
  `0:00` badge would be a fabricated number; the absence is pinned by test so a
  future edit cannot add it back without also buying `videos.list` calls.
- A fallback search link is never presented as a resolved video. An empty search
  emits no event and renders no card.
- `embedUrl` is provided with `autoplay=0` for a future inline player; the
  no-autoplay property is asserted by test. No current UI reads it.
- Layout invariants that React output cannot show are asserted against the sheet
  itself: 16:9 thumbnail frame (`high` arrives letterboxed inside a 4:3 frame, so
  cover-cropping removes the bars), a 44px minimum action row, single-column rail
  under 560px, and a `prefers-reduced-motion` rule.
- `MediaItem.intent` is optional and `isMediaItem` accepts its absence, because
  items are persisted inside conversation messages: requiring it would silently
  erase the cards of every message written before the field existed. A present but
  unrecognised value is still rejected, and `mediaIntentOf` resolves only the
  absent case to `watch`.

## Hand-off

Tapping a card resolves the item outside the applet. There is no iframe, no
facade player, and no player script, for video as well as audio.

The reason is not taste. An embedded player would import roughly a megabyte of
provider JavaScript to deliver a worse version of what the user's own apps already
do, and on Android it would trap playback inside a chat window — no background
audio, no picture-in-picture, no hardware controls, no queue. Hand-off costs one
URL and gives all of it back. `MediaItem.embedUrl` is still produced and still
carries its `autoplay=0` test, so an inline player remains a lazy module away if
that is ever decided otherwise.

`src/media/handoff.ts` is pure and holds the whole policy:

| Condition | Result |
| --- | --- |
| Android | `intent://host/path?query#Intent;scheme=https;S.browser_fallback_url=…;action=…VIEW;category=…BROWSABLE;end` |
| Anywhere else | the destination URL verbatim |
| Unparseable or non-https link | the item's `webUrl` verbatim, never an intent |

Android needs the `intent://` form because it is the only mechanism a web app has
to ask for resolution across *all* installed handlers rather than the default
browser. More than one candidate yields the system's own picker, which is exactly
the requested behaviour for "let me choose my music player". Two details are
load-bearing and both are asserted: the `;end` terminator (without it the URI is
inert) and the **absence** of a `package=` component (pinning a handler would
suppress the chooser, which is the one thing this must not do).

`listen` additionally routes a single video to `music.youtube.com`, preserving any
start offset, so a music request is not handed to a video watch page. A playlist, a
non-YouTube host, or a link whose shape is not recognised is passed through
untouched: the destination is rewritten only where it is known, and `kind` is
trusted over URL shape when the two disagree.

**The intent never enters the cache key.** `mediaCacheKey` stays
provider + normalized query, and stamping happens *after* `writeMediaCache`. One
paid `search.list` answer serves both intents, so a user who asks to listen and
later asks to watch the same thing spends one call, not two — which is what keeps
this feature from becoming a quota leak. Cache records therefore contain no
`intent`; the E2E asserts that absence by reading IndexedDB directly.

**Intent is an explicit argument, not a guess.** Nothing in a `search.list`
response identifies music — no duration, no topic id — and the quota forbids the
`videos.list` call that would supply one. The model, which read the user's actual
sentence, is the only reliable classifier, so it declares the intent and defaults to
`watch` when it does not. Per call, not per query.

Optional means optional: a wrong-but-present value (`'karaoke'`) is rejected with a
message naming the two allowed values, so the model can correct itself, while
`null` and `""` — which models emit for "not provided" — are treated as absent
rather than failing a search the user did ask for.

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

| Chunk | Before | After | Δ raw | Δ gzip |
| --- | --- | --- | --- | --- |
| `MediaCard-*.js` (lazy) | 866 B | 2 401 B | +1 535 B | +624 B |
| `search-*.js` (lazy) | 6 996 B | 7 199 B | +203 B | +69 B |
| `index-*.js` (**initial**) | 1 306 680 B | 1 307 652 B | +972 B | +420 B |

Measured as `wc -c` on the built assets and `gzip -c` at level 6, comparing this
tree against the commit it branched from in an isolated worktree. The hand-off
pass therefore costs **420 bytes gzipped on first load**; everything else it added
is inside chunks that only exist once a media search or a media card actually
happens.

The main bundle grows only by the registry entry, the function declaration, the
Zod argument schema, the small handler stub, and the domain contract. None of the
provider, cache, budget, or hand-off code loads until a media search actually
runs. `src/media/handoff.ts` is imported by the card, so it sits in the lazy
`MediaCard` chunk and appears nowhere in the entry chunk.

## Deliberately not built

- No Worker endpoint and no KV cache. The original design assumed both; with
  browser-direct BYOK there is no server to hold them, and the client cache plus
  per-session budget replace them.
- No scraping, no `yt-dlp`, no `ytmusicapi`, no undocumented endpoints.
- No inline player, for video either. Chosen deliberately rather than deferred: a
  facade player would still load provider code on tap and still lose Android's
  native playback controls. If it is wanted, it is one lazy module against
  `embedUrl`, and the no-autoplay invariant already guards it.
- No `videos.list` enrichment. Durations stay unknown, and nothing in the UI
  implies otherwise.
- No per-provider deep-link table. `intent://` is a platform mechanism, not a
  provider one; naming specific player packages would be guessing, and would
  defeat the chooser.

## Verified where

Unit and contract coverage exists for every layer, including a mutation-checked
suite for `handoff.ts`. `e2e/media-handoff.spec.ts` drives the real chain in a
real browser: it asserts the model is offered the `intent` enum, that one search
serves both intents, that the card is a link with no media element, and that the
cache row carries no `intent`.

Not verifiable from a browser: whether Android shows its app chooser or opens a
single default handler. That is the platform's decision. It needs a physical-device
check, which is listed as outstanding and is not claimed here.

Correction (2026-09-12): CI now executes `e2e/media-handoff.spec.ts` on chromium and
android-portrait. The prior CI run aborted at the worker-test flake before the E2E
step ran, so this was re-triggered to obtain a full verification.
