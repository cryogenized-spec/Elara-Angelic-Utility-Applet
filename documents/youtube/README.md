# YouTube Media in Elara

This guide explains YouTube search, cards, quota protection, external handoff, playback readiness and the official internal player engine.

The current boundary is important: **Elara now contains one official YouTube IFrame Player engine, but result cards still open YouTube externally.** The player engine is ready underneath the existing global playback authority; card/chooser routing comes in a later phase. There are no card-level mini-players, stream extractors, hidden players or second playback systems.

> Implementation/compliance guide only. Current Google/YouTube terms and policies take priority.

## 1. Search flow

A media request stays on the existing search path:

```text
request
-> Gemini decides whether youtube.search is useful
-> validate + normalize/dedupe
-> cache
-> 8-search page-session guard
-> 24-search device/Pacific-day guard
-> YouTube search.list
-> structured cards + lean Gemini result
```

Gemini should use one concise query by default; a tool call accepts at most three distinct normalized queries. One cache miss creates at most one `search.list` request with no pagination.

`watch` and `listen` are presentation intent, not different provider identities or caches.

## 2. Search request and quota

The browser uses YouTube Data API v3:

```text
part=snippet
type=video
q=<query>
maxResults=5
safeSearch=strict
```

The named YouTube Lockbox credential is sent in `x-goog-api-key`, never in the URL, conversation, Gemini continuation, media object, cache row or diagnostics.

Two local guards apply only to fresh `search.list` calls: eight per page session and 24 per device/Pacific quota day. IndexedDB transactions own the daily reservation; `BroadcastChannel` is advisory. A cache hit spends neither guard. If safe accounting is unavailable, a fresh search fails closed.

These are local defensive limits, not substitutes for Google Cloud project quota.

## 3. One media object, two views

The search tool result has one application object. Gemini receives the compact enumerable projection:

```text
provider
intent
query
id
kind
title
channel
bounded failures
```

The browser retains full card metadata such as thumbnail, canonical URL, compatibility `embedUrl`, provider fetch timestamp and full `MediaItem`. Those heavier fields are not serialized back into the Gemini continuation.

There is no separate model-side media authority.

## 4. Result cards today

Cards remain external controls in Phase 4. **Watch** and **Listen** both use the exact canonical ordinary YouTube URL; Elara does not manufacture a `music.youtube.com` destination.

Persisted card data is untrusted. Before handoff, Elara reconstructs the allowed destination from `provider + kind + id` and requires stored `webUrl` to match exactly. Hostile schemes/hosts, HTTP, aliases, malformed URLs, mismatched IDs and unexpected query parameters fail closed into an inert result.

On ordinary browsers the validated HTTPS URL opens normally. Supported Android Chromium-family flows may attempt an unpinned Android intent from the user tap with the same HTTPS URL as fallback. Android chooses the installed handler.

Phase 4 deliberately does not replace this card path with internal playback yet.

## 5. One global playback authority

Elara mounts exactly one `PlaybackProvider` above the application. It owns one reducer, selected media, request lineage, readiness and player election:

```text
idle
 ↓
requested
 ↓
checking
 ↓
ready
 ↓
loading
 ↓
paused ↔ playing
 ↓
ended ──► playing   # native replay

active phase -> failed
reset -> idle
```

Only the preference `ask | embedded | external` is persisted, using the existing preferences database. The selected video, request ID, readiness decision, player instance, current phase/position and failures are session-only.

Every accepted selection receives one request ID. The newest accepted request wins. Late provider callbacks from an older request cannot alter the current one.

There is no second playback reducer, database, queue, event bus or card-local controller.

## 6. Readiness remains the gate

`PlaybackProvider.prepare(item)` is still readiness-only. It **does not create an iframe**.

It validates the same canonical provider identity used by external handoff, then lazily calls YouTube `videos.list`:

```text
part=id,status
id=<exact 11-character video id>
maxResults=1
x-goog-api-key: <named Lockbox key>
```

The exact requested ID must return explicit boolean `status.embeddable` and `status.madeForKids` values.

```text
exists + embeddable + !MFK -> ready
missing                      -> blocked/unavailable
embeddable=false             -> blocked/not-embeddable
madeForKids=true             -> blocked/made-for-kids
invalid status               -> readiness failure
key/quota/network failure    -> readiness failure
cancelled                    -> aborted
```

These `videos.list` readiness calls do not consume or mutate the search-specific 8/24 guards.

Made-for-Kids remains external-only and therefore never reaches the player engine.

## 7. Starting internal playback

Phase 4 adds one explicit composed path:

```text
PlaybackProvider.start(item)
-> existing prepare(item)
-> if ready: existing begin-load event
-> one global PlaybackPlayerHost
-> provider-neutral player port
-> official YouTube IFrame Player adapter
```

This is the important anti-parallel-system rule: `start()` does not duplicate selection/readiness logic. It calls the already-certified `prepare()` path and then uses the existing reducer's `loading` phase.

Current cards do not call `start()` yet. That routing decision belongs to the later chooser/card phase.

## 8. Official YouTube IFrame Player

The player port validates the canonical media identity again before provider loading. It then dynamically imports the YouTube adapter. Persisted `embedUrl` is ignored entirely; the player is derived from the validated YouTube video ID.

The adapter loads the official page-global SDK:

```text
https://www.youtube.com/iframe_api
```

Concurrent player requests share one SDK-load promise rather than injecting duplicate scripts. The elected player uses YouTube's native controls with:

```text
autoplay=0
controls=1
playsinline=1
origin=<current HTTP(S) Elara origin when available>
```

Elara explicitly keeps page referrer policy at `strict-origin-when-cross-origin` so embedded requests retain normal client/origin identity. The player surface is 16:9 and never smaller than YouTube's 200px minimum. Elara puts no custom overlay in front of the iframe and does not replace YouTube's transport controls.

Autoplay is off. The official player's `onReady` therefore maps to Elara's existing `paused` state: loaded and ready for the user's native play gesture, but not yet playing.

Provider state mapping is:

```text
YT ready   -> paused
YT state 1 -> playing
YT state 2 -> paused
YT state 0 -> ended
```

A native replay may move `ended -> playing` without electing a new application request.

## 9. Cancellation and single-player ownership

There is one global player host. When a newer valid selection wins, the older request is aborted and its player session is destroyed. Reset and provider unmount perform the same teardown.

Abort is an efficiency mechanism; request ID lineage is the correctness mechanism. If the provider sends a late callback after request A has been superseded by B, the callback still carries A's request ID and the reducer ignores it.

The player mount also carries a host-owner token. A stale session's cleanup cannot remove the DOM owned by a newer session.

Destroy is idempotent.

## 10. Player errors

Known YouTube IFrame API errors are translated into bounded application messages rather than raw provider details. Examples include invalid video ID, unavailable video, embedded playback disabled and missing client identity/referrer information.

If the SDK or adapter cannot load, Elara moves the existing request into the existing `failed` phase using a safe generic message. It does not create a fallback player system.

A failed internal attempt does not mutate the original valid card. External handoff remains a separately validated path.

## 11. `embedUrl` compatibility field

`MediaItem.embedUrl` still exists for compatibility with older/current media rows, but it has **no playback authority**.

Neither readiness nor the player adapter reads it to choose a destination. Even a syntactically valid hostile HTTPS `embedUrl` cannot become an internal iframe target.

Current authority is:

```text
provider + kind + video id
+
exact canonical stored webUrl validation
```

Removal of the compatibility field is a separate persistence/migration decision.

## 12. Storage and retention

Elara does not store YouTube video/audio bytes. Search metadata may exist in the search cache and in completed conversation records.

Provider metadata carries `apiDataFetchedAt`. Persisted YouTube API metadata is displayable only while valid and younger than 30 days; exactly 30 days is expired. Undated legacy, malformed and future-dated media fail closed. Startup maintenance and conversation reads both enforce the boundary.

Player state is never written to conversations or IndexedDB. Readiness's positive/blocked memoization is browser-session memory only; transient failures are not cached.

## 13. What Elara does not do

Phase 4 still does not:

- download, proxy or extract YouTube streams;
- isolate audio from video;
- create an offline media library;
- remove or cover YouTube controls/branding;
- autoplay the embedded player;
- create hidden/background playback;
- create card-level players;
- add custom transport controls or iframe overlays;
- persist active playback state;
- route result-card taps to the internal player yet;
- maintain a second playback lifecycle alongside `PlaybackProvider`.

## 14. Troubleshooting

**No API key / rejected key.** Unlock the Lockbox and verify a YouTube Data API v3 key for the intended Google Cloud project, with suitable API/origin restrictions.

**Search budget exhausted.** This is Elara's eight-session or 24-device/Pacific-day `search.list` protection. It is separate from readiness.

**Readiness says unavailable / not embeddable / Made for Kids.** Internal playback is blocked. The original valid card can still use normal external handoff.

**Player API fails to load.** The existing request becomes `failed`; no alternate or hidden player is created.

**Player is loaded but not playing.** That is expected in Phase 4: autoplay is off and official `onReady` maps to `paused` until the user acts on native YouTube controls.

**Listen still opens ordinary YouTube.** Expected today. Cards have not yet been routed through the `ask | embedded | external` chooser.

**Old card disappeared.** Its provider metadata may have expired or failed canonical validation; surrounding conversation text should remain.

## 15. Developer map

| Concern | Source |
| --- | --- |
| Media identity/freshness | `src/domain/media.ts` |
| Playback lifecycle | `src/domain/playback.ts` |
| Global authority / `prepare` / `start` | `src/media/playback/PlaybackProvider.tsx` |
| Readiness port | `src/media/playback/readiness.ts` |
| YouTube readiness | `src/media/youtube/readiness.ts` |
| Player port | `src/media/playback/player.ts` |
| Single global host | `src/media/playback/PlaybackPlayerHost.tsx` |
| Host geometry | `src/media/playback/player-host.css` |
| Official iframe adapter | `src/media/youtube/player.ts` |
| Playback preference | `src/persistence/preferences.ts` |
| External handoff | `src/media/handoff.ts` |
| Search / cache / budgets | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts` |
| Search provider | `src/media/youtube/service.ts` |
| Card UI | `src/app/components/media/` |
| Phase-4 tests | `src/domain/playback.phase4.test.ts`, `src/media/playback/player.test.ts`, `src/media/playback/PlaybackProvider.phase4.test.tsx`, `src/media/youtube/player.test.ts` |

Compact engineering authority: [`../media.md`](../media.md).

Phase-4 behavioral certification: CI #1687 passed the complete repository matrix on `34382bc5c01ab486444920c39df487d17f03e8b3`.

## Official references

- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Video status fields](https://developers.google.com/youtube/v3/docs/videos)
- [Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
- [YouTube branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines)
