---
id: SYS-MEDIA
status: active
verified_commit: 34382bc5c01ab486444920c39df487d17f03e8b3
scope: media search, delivery, playback authority/readiness/player, persistence, cache, quota, retention and external handoff
paths: [src/media, src/domain/media.ts, src/domain/playback.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, playback, readiness, iframe, player, handoff, cache, quota, compliance, retention]
---

# Media / YouTube

## 1. Boundary

`SYS-MEDIA` owns YouTube discovery, structured media delivery, search-quota protection, API-data freshness, one global playback authority, playback readiness, the official YouTube IFrame Player adapter, and external platform handoff.

There is **one playback system**. `PlaybackProvider` owns selection, request lineage, reducer state, readiness orchestration, player election and the single global player host. Readiness/player adapters are stateless provider boundaries, not alternate authorities.

Phase 4 adds the internal player engine but does **not** route current result-card taps into it. Existing cards still perform validated external handoff. `prepare(item)` remains readiness-only; `start(item)` is the explicit composed path that may create the one global player after readiness succeeds.

Human/operator guide: [`youtube/README.md`](./youtube/README.md).

## 2. Runtime map

### 2.1 Search and delivery

```text
user request
-> Gemini youtube.search decision
-> schema validation (1 query default; hard max 3)
-> normalize/dedupe
-> cache
-> 8-search page-session guard
-> 24-search device/Pacific-day guard
-> one search.list request per cache miss
-> MediaItem[] + lean Gemini projection
-> media-resolved
-> one GenerationState / optimistic ChatMessage
-> one terminal persistence owner
-> 30-day read/startup freshness enforcement
-> MediaCard
-> exact canonical URL validation
-> HTTPS / optional Android handoff
```

Search runs in the browser execution plane only. The Worker has no shadow YouTube search executor. Text, media and artifacts share the same generation/persistence lifecycle.

### 2.2 Playback

`src/main.tsx` mounts exactly one `PlaybackProvider` above the app. Its existing reducer is the only playback lifecycle:

```text
idle
-> requested
-> checking
-> ready
-> loading
-> paused <-> playing
-> ended -> playing        # native replay

active phases -> failed
reset -> idle
```

`paused` also represents an official player that has emitted `onReady` and is waiting for the user to press YouTube's native play control.

Readiness path:

```text
PlaybackProvider.prepare(fresh MediaItem)
-> select() elects requestId
-> requested -> checking
-> canonical provider/id/webUrl validation
-> lazy YouTube readiness adapter
-> videos.list(part=id,status)
-> ready OR failed
```

Internal-player path:

```text
PlaybackProvider.start(item)
-> existing prepare(item)
-> only if readiness=ready
-> existing begin-load transition
-> one global PlaybackPlayerHost observes loading
-> provider-neutral player port revalidates canonical identity
-> lazy YouTube IFrame Player adapter
-> one official YT.Player session
-> native callbacks carry same requestId
-> paused / playing / ended / failed
```

A newer accepted selection, reset or provider unmount disposes obsolete work/player state. Abort reduces wasted provider work; **request ID lineage is the correctness authority**, so late callbacks from request A cannot mutate request B. The player host also has a host-ownership token so stale teardown cannot erase a newer player mount.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Media schema / identity / freshness | `src/domain/media.ts` |
| Playback lifecycle / decisions | `src/domain/playback.ts` |
| One global playback authority | `src/media/playback/PlaybackProvider.tsx` |
| Readiness port | `src/media/playback/readiness.ts` |
| YouTube readiness | `src/media/youtube/readiness.ts` |
| Player port | `src/media/playback/player.ts` |
| One global player host | `src/media/playback/PlaybackPlayerHost.tsx` |
| Player geometry | `src/media/playback/player-host.css` |
| Official YouTube iframe adapter | `src/media/youtube/player.ts` |
| Playback preference persistence | `src/persistence/preferences.ts` |
| Search orchestration | `src/media/search.ts` |
| YouTube search adapter | `src/media/youtube/service.ts` |
| Search budgets | `src/media/budget.ts` |
| Search cache / local media DB | `src/media/cache.ts`, `src/media/storage.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| External handoff validation | `src/media/handoff.ts` |
| Tool/model projection | `src/media/tool-handler.ts` |
| Retention | `src/media/retention.ts`, `src/persistence/conversation.ts` |
| Card UI | `src/app/components/media/` |

## 4. Contracts

### 4.1 Search

`youtube.search` accepts `watch|listen` plus at most three distinct normalized queries. One cache miss creates at most one `search.list` call with `part=snippet`, `type=video`, `maxResults=5`, `safeSearch=strict`; no pagination and no routine `videos.list` enrichment.

Local search ceilings are eight network searches per page session and 24 per device/Pacific quota day. IndexedDB transactions are the daily-accounting authority; `BroadcastChannel` is advisory only. Cache hits spend neither local search guard. Accounting failure fails closed.

Gemini receives only the lean enumerable projection needed to reason about results. Full browser metadata remains on non-enumerable fields of the same tool-result object; there is no second model/browser media authority.

### 4.2 Identity, freshness and persistence

Media identity is `provider:id`. Persisted YouTube metadata requires a trustworthy `apiDataFetchedAt`; future-dated, malformed, undated legacy and age `>=30 days` media fail closed. Startup maintenance and conversation reads independently enforce retention.

Only `ask | embedded | external` playback preference is durable, using the existing preferences database. Selection, request ID, readiness result, active player, playback phase/position and errors are session-only.

### 4.3 Readiness

Readiness accepts only a fresh YouTube video whose `provider + kind + id` reconstructs the exact persisted canonical `webUrl`. It calls `videos.list` with `part=id,status`, exact `id`, `maxResults=1`, and the named Lockbox key in `x-goog-api-key`.

```text
matching + embeddable + !madeForKids -> ready
missing                             -> blocked/unavailable
embeddable=false                    -> blocked/not-embeddable
madeForKids=true                    -> blocked/made-for-kids
invalid/missing status              -> failed/invalid-response
credential/quota/network            -> typed failure
caller cancellation                 -> aborted
```

Ready/blocked decisions may be cached only in module memory for the current browser session. Transient failures/cancellation are not cached. These `videos.list` calls do not touch the search-specific 8/24 guards.

Made-for-Kids remains external-only. The player adapter is never reached for a blocked readiness decision.

### 4.4 Official iframe player

The provider-neutral player port reuses the canonical external-destination trust boundary before loading a provider adapter. It derives YouTube playback solely from validated provider identity and video ID; persisted `embedUrl` is never consumed as player authority.

The YouTube adapter dynamically loads the official `https://www.youtube.com/iframe_api` SDK and deduplicates that page-global load. It creates one `YT.Player` inside the elected global host with:

```text
autoplay=0
controls=1
playsinline=1
origin=<current HTTP(S) app origin when available>
```

`index.html` declares `strict-origin-when-cross-origin` so embedded requests retain normal origin/referrer client identity. Native YouTube controls remain visible and unobstructed. The player surface reserves a 16:9 viewport with a 200px minimum dimension; Elara adds no iframe overlay or custom transport controls in this phase.

Provider states map into the existing reducer: official ready -> `paused`, state 1 -> `playing`, state 2 -> `paused`, state 0 -> `ended`. Provider error codes are converted to bounded application messages. Generic adapter-load failures do not expose raw provider details.

The adapter does not autoplay. User-visible card routing/chooser policy is a later phase, so current cards cannot invoke `start()` yet.

## 5. Invariants

- Exactly one global `PlaybackProvider`; nested providers fail loudly.
- Exactly one reducer/request lineage owns readiness and player state.
- Exactly one global player host; no card-level player instances.
- No playback DB, second store, second reducer, queue or event bus.
- `prepare()` remains readiness-only and creates no player.
- `start()` composes the existing readiness path; it does not bypass it.
- Newest accepted request ID wins; stale readiness/player callbacks are inert.
- Reset/new selection/unmount tears down obsolete provider work/session.
- Search/cache/budget/storage architecture is unchanged by playback.
- Player/readiness never use persisted `embedUrl` as authority.
- Canonical `webUrl` validation remains the privilege boundary for both handoff and internal preparation/loading.
- YouTube credentials stay in the existing named Lockbox boundary and never enter media/domain/persistent rows.
- MFK/non-embeddable/unavailable content never reaches the iframe adapter.
- Official native YouTube controls are not replaced, obscured or overlaid.
- Autoplay is off.
- Active playback state is session-only.
- Current `MediaCard` taps remain external handoff; Phase 4 does not change card behavior.
- External handoff remains independently usable when internal playback is blocked/fails and the card itself is valid.

## 6. Failure and security semantics

Persisted media is untrusted. Hostile schemes/hosts, HTTP, aliases, ID mismatches and unexpected URL shapes fail canonical validation rather than being repaired. A hostile but syntactically valid `embedUrl` has no route into readiness or player creation.

Player creation is lazy and request-scoped. A superseded player receives abort/destroy; any later provider callback retains the old request ID and cannot update current state. Destroy is idempotent, and host ownership prevents an old session from clearing a newer mount.

Provider/SDK failures are mapped to bounded application errors. No credential, raw provider body or arbitrary persisted destination is promoted into player authority.

## 7. Verification

Phase-4 coverage:

- `src/domain/playback.phase4.test.ts`
- `src/media/playback/player.test.ts`
- `src/media/playback/PlaybackProvider.phase4.test.tsx`
- `src/media/youtube/player.test.ts`

These prove readiness-only `prepare()`, explicit `start()`, one global player lane, canonical target enforcement, hostile `embedUrl` irrelevance, SDK single-load behavior, native player settings, request supersession, reset/unmount teardown, stale callback immunity, MFK blocked-before-player behavior, bounded player failure, `onReady -> paused`, ordinary play/pause/end and native replay.

Earlier Phase-2/3 playback/readiness tests remain authoritative, along with the existing media/search/handoff suites and full Playwright acceptance suite. Existing browser tests still prove result cards themselves do not create iframe players because card routing has not changed.

Phase-4 behavioral certification: CI #1687 passed the complete repository matrix on `34382bc5c01ab486444920c39df487d17f03e8b3`.

## 8. Known next boundary

The player engine exists but is intentionally not yet a user-facing card action. A later phase must decide how `ask | embedded | external` routes a user tap and how the single global player is presented in the application. That work must reuse `PlaybackProvider.start()` and `PlaybackPlayerHost`; it must not create a card-local player or second media lifecycle.

Still absent by design: custom transport controls, custom overlays, background/audio-only playback, stream extraction, offline media, hidden playback and a separate playback persistence system.
