---
id: SYS-MEDIA
status: active
verified_commit: 6ec51b582713bbc65e50590706984f48f663e1da
scope: media search, delivery, playback authority/readiness, persistence, cache, quota, retention and platform handoff
paths: [src/media, src/domain/media.ts, src/domain/playback.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, playback, readiness, handoff, cache, quota, compliance, retention, projection]
---

# Media / YouTube

## 1. Purpose and boundary

`SYS-MEDIA` owns structured media discovery, live delivery, API-data freshness, search-quota protection, playback authority/readiness and external handoff. YouTube is the current provider.

The current playback implementation stops at readiness. Elara has one global application-owned `PlaybackProvider` and can verify whether one selected YouTube video is eligible to proceed toward internal playback, but it does not yet create an iframe/player, stream media, extract audio or route result-card taps into that readiness path. Existing cards still hand a validated canonical YouTube URL to the browser/platform.

The human operational guide is [`youtube/README.md`](./youtube/README.md). This file is the compact engineering authority.

## 2. Runtime architecture

### 2.1 Discovery and delivery

```text
user request
-> Gemini decides whether youtube.search is needed
-> validated args (1 query by default; hard max 3)
-> normalize/dedupe queries
-> cache freshness check
-> 8-search page-session ceiling
-> 24-search device/Pacific-day ledger
-> one YouTube search.list request per cache miss
-> provider metadata stamped with apiDataFetchedAt
-> full browser MediaItem[] + lean Gemini projection
-> media-resolved event
-> merge by provider:id into GenerationState
-> one optimistic assistant projection for text + media + artifacts
-> terminal completion uses the existing single persistence boundary
-> startup + read-time 30-day freshness enforcement
-> lazy MediaCard
-> exact canonical YouTube URL validation
-> HTTPS / optional Android handoff
```

Search runs only in the browser execution plane. The Worker does not advertise `youtube.search` and has no shadow YouTube executor.

Live media does not wait for Gemini prose. A `media-resolved` event updates the same optimistic assistant message used by text and artifacts. Successful terminal completion persists that same projection. Failure/cancellation never creates a second save path.

The search tool result has one object and two views. Enumerable fields are the lean Gemini continuation payload; full card metadata stays on non-enumerable fields of that same object. There is no second model/browser media authority.

### 2.2 Playback authority and readiness

`src/main.tsx` mounts exactly one `PlaybackProvider` above the application. It owns playback preference, selected media, request lineage and the existing reducer lifecycle:

```text
idle
-> requested
-> checking
-> ready
-> loading
-> playing <-> paused
-> ended

active phases -> failed
reset -> idle
```

Only `ask | embedded | external` preference is durable, stored as one row in the existing `elara-preferences` database. Selected media, request IDs, readiness state, failures and future player state remain session-only.

Phase-3 readiness reuses that authority rather than adding another state machine:

```text
PlaybackProvider.prepare(fresh MediaItem)
-> existing select() elects requestId
-> requested
-> checking
-> stateless readiness port
-> exact canonical provider+id target validation
-> lazy YouTube readiness adapter
-> videos.list(part=id,status, id=<video>)
-> ready OR existing failed phase
```

A newer valid selection aborts obsolete readiness work and supersedes its request ID. Abort is an efficiency aid; request lineage is the correctness authority, so a late result from A cannot mutate B. Reset/unmount also abort active readiness work. A rejected stale/future selection does not disturb the current request.

The readiness adapter creates no iframe/audio/video element and loads no player SDK. Provider-specific readiness code is dynamically imported only when preparation reaches the check boundary.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Media domain / identity merge / hard caps / freshness | `src/domain/media.ts` |
| Playback domain / lifecycle / readiness decision vocabulary | `src/domain/playback.ts` |
| Global playback authority / preference / request lineage | `src/media/playback/PlaybackProvider.tsx` |
| Provider-neutral readiness port | `src/media/playback/readiness.ts` |
| YouTube playback readiness | `src/media/youtube/readiness.ts` |
| Playback preference persistence | `src/persistence/preferences.ts` |
| Gemini declaration | `src/google/tools/gemini-declarations.ts` |
| Tool description / execution plane | `src/google/tools/registry.ts` |
| Tool argument schema | `src/media/youtube-schema.ts` |
| Query normalization | `src/media/normalize.ts` |
| Session + device/Pacific-day search budget | `src/media/budget.ts` |
| IndexedDB search cache/budget schema | `src/media/storage.ts` |
| Search cache | `src/media/cache.ts` |
| Startup retention sweep | `src/media/retention.ts` |
| Search orchestration | `src/media/search.ts` |
| YouTube search adapter | `src/media/youtube/service.ts` |
| YouTube key validation | `src/media/youtube/validate.ts` |
| Handoff validation | `src/media/handoff.ts` |
| Tool handler / model projection | `src/media/tool-handler.ts` |
| Generation accumulation / optimistic projection | `src/chat/generation-state.ts`, `src/chat/generation-sync.ts` |
| Conversation cleanup | `src/persistence/conversation.ts` |
| Conversation delivery / viewport authority | `src/app/components/ConversationSurface.tsx` |
| Media card UI | `src/app/components/media/` |

## 4. Data and contracts

### 4.1 Search

`youtube.search` accepts one or more queries plus optional `watch|listen` intent. Gemini is instructed to use one concise query by default. Runtime/schema enforcement permits at most three distinct queries; duplicate normalized queries collapse before cache/network work.

Two local ceilings protect real search requests. The page-session ceiling is eight network searches. A second device-local ledger allows at most 24 searches per YouTube Pacific quota day. Cache hits spend neither ceiling. The daily ledger lives in the existing `elara-media-cache` IndexedDB database; transactions are authoritative across tabs/reloads and `BroadcastChannel` is advisory only. Failure to account for a fresh search fails closed.

The provider uses one `search.list` request per cache miss with `part=snippet`, `type=video`, `maxResults=5` and `safeSearch=strict`. It never follows `nextPageToken` and does not call `videos.list` to decorate normal search cards.

Media identity is `provider:id`. `mergeMediaItems` is the single merge primitive for accumulated/presented media: first sighting owns position; the newest valid representation owns slot data.

Gemini receives provider, intent, query, item identity/kind/title/channel and bounded failures. Thumbnail, canonical URLs, `embedUrl`, provider-fetch timestamps and flattened browser structures are not serialized into the continuation payload.

### 4.2 Freshness and retention

Every provider result carries `apiDataFetchedAt`. Positive search cache entries live seven days and negative entries ten minutes. Persisted YouTube API metadata in conversations is displayable only while structurally valid, timestamped, not future-dated and younger than 30 days; exactly 30 days is expired. Startup maintenance and conversation reads independently enforce that boundary.

### 4.3 Playback preference and session state

Playback preference is `ask | embedded | external`; malformed/corrupt values normalize to `ask`. Preference lives in the existing preferences authority. Preference writes are serialized and a late load cannot overwrite a newer user choice.

No selected item, readiness result, request ID, phase, position or failure is persisted. Remounting the playback authority therefore restores preference but starts playback state at `idle`.

### 4.4 Readiness

Readiness runs only for a fresh selected YouTube `video`. The port first reuses the external handoff's canonical identity boundary: `provider + kind + id` must reconstruct the exact stored `webUrl`. A hostile/corrupt stored destination cannot become a more privileged internal target.

YouTube readiness accepts an exact 11-character YouTube video ID and calls `videos.list` with `part=id,status`, the selected `id` and `maxResults=1`. The API key is resolved just in time through the existing named Lockbox accessor and sent only in `x-goog-api-key`.

The response must contain the exact requested ID plus boolean `status.embeddable` and `status.madeForKids`. Decisions are:

```text
matching video + embeddable + not MFK -> ready
no matching video                    -> blocked/unavailable
embeddable=false                     -> blocked/not-embeddable
madeForKids=true                     -> blocked/made-for-kids
missing/invalid status               -> failed/invalid-response
credential/quota/network failure     -> typed failed decision
caller cancellation                  -> aborted
```

Made-for-Kids content is deliberately external-only in this phase. A later iframe phase may widen that rule only after its required tracking/data-handling behavior is implemented and certified.

Successful/blocked readiness decisions may be memoized only in a module-memory session cache keyed by video ID. This cache is derived provider metadata, not playback state, search cache, persistence or quota authority. Transient failures and cancellations are not cached.

The existing search-specific 8-session/24-device guards are not used by readiness. A readiness `videos.list` call is not a `search.list` request and must not mutate search accounting.

`MediaItem.embedUrl` remains present for compatibility with existing media rows, but it is untrusted and has no authority in readiness. Future player URLs must be derived from validated provider identity/current application origin, never from persisted `embedUrl`.

## 5. Invariants

- Exactly one global `PlaybackProvider`; nested providers fail loudly.
- No readiness store, playback database, second reducer, event bus or second media representation exists.
- Only playback preference is durable; active playback/readiness state is session-only.
- Every accepted selection gets one request ID; newest valid selection wins.
- Late readiness/player events from older request IDs cannot mutate the elected request.
- Rejected stale/future selections leave current state/readiness work untouched.
- Readiness creates no player SDK, iframe, audio or video element.
- Persisted `embedUrl` is never readiness/player authority.
- Readiness and search use the same named YouTube Lockbox credential boundary; credentials never enter domain/persistent media data.
- Readiness does not consume or modify search-specific local budgets.
- Search path remains `validate -> normalize/dedupe -> cache -> session budget -> device/day budget -> network`.
- One search cache miss equals at most one `search.list` request; no pagination.
- One page session can spend at most eight searches; one device can reserve at most 24 searches in one Pacific quota day.
- Gemini receives the lean enumerable tool projection; full browser card metadata does not cross the continuation boundary.
- Freshness is based on provider-fetch time; reading from cache never refreshes the API-data clock.
- Text, media and artifacts share one `GenerationState -> ChatMessage` optimistic projection and one terminal persistence owner.
- Existing MediaCards remain external handoff controls in this phase; readiness is not yet wired to card taps.
- External handoff remains independent of readiness failure and uses the exact canonical YouTube URL.
- Android intent handoff remains optional, unpinned and carries the exact HTTPS fallback.

## 6. Security and failure semantics

The YouTube credential is resolved only at request time from the unlocked Lockbox. Search/readiness provider failures map to bounded application decisions without propagating raw provider bodies or credential material.

Persisted URLs are untrusted. For YouTube, navigation/readiness is allowed only when provider+kind+id reconstructs the exact stored canonical `webUrl`. `javascript:`, `data:`, HTTP, hostile HTTPS hosts, aliases, mismatched IDs and unexpected query parameters fail closed.

A readiness block/failure never deletes or rewrites the selected media card. External handoff remains separately validated and available where the original card is valid.

Persisted quota rows remain untrusted. Invalid same-day counters cannot manufacture allowance; cross-tab messages are advisory only.

## 7. Verification and tests

Playback/readiness coverage is in `src/domain/playback.phase2.test.ts`, `src/media/playback/PlaybackProvider.phase2.test.tsx`, `src/media/playback/PlaybackProvider.phase3.test.tsx`, `src/media/playback/readiness.test.ts` and `src/media/youtube/readiness.test.ts`.

The Phase-3 adversarial set proves one lifecycle owner, request supersession, abort/reset behavior, stale-selection non-interference, no player DOM, canonical-target enforcement, hostile `embedUrl` irrelevance, strict video IDs, exact `videos.list` request shape, header-only credentials, session caching, MFK/non-embeddable/unavailable decisions, malformed status failure, provider failure mapping and cancellation semantics.

Search/delivery coverage remains in `src/media/*.test.ts`, `src/media/youtube/*.test.ts`, `src/chat/generation-media-*.test.ts`, `src/persistence/conversation-media-retention.test.ts`, tool declaration/handler tests, `src/app/components/media/*.test.tsx`, `e2e/media-efficiency.phase1.spec.ts`, `e2e/media-handoff.spec.ts`, `e2e/media-delivery.phase3.spec.ts`, and `e2e/media-lifecycle.acceptance.spec.ts`.

Browser automation continues proving the existing media/search/handoff architecture and the absence of embedded players. Physical Android handler selection remains handset acceptance; Playwright cannot certify which installed application wins an OS intent.

Phase-3 behavioral certification candidate: `6ec51b582713bbc65e50590706984f48f663e1da`.

## 8. Known gaps

There is still no user-facing internal player. Result cards continue to open externally; the `ask | embedded | external` preference and readiness seam are foundations for the later chooser/player phases.

There is no YouTube IFrame Player API integration, player shell, playback transport, background playback, player appearance system or card-level player. No code in this phase should be interpreted as permission to create any of those outside the one global playback authority.

`MediaItem.embedUrl` is compatibility metadata that the new playback path deliberately refuses to trust. Its eventual removal requires a separate compatibility/persistence migration decision.

The 24-search device/day ledger cannot enforce a project-wide allowance across unrelated browsers/devices; Google Cloud remains authoritative for project quota.

A public operator still owns deployment-level privacy/terms/consent, Google Cloud project/key restrictions and any applicable YouTube compliance/audit obligations.

The card uses literal `Source: YouTube` text and does not manufacture/recolour an unofficial YouTube logo. Any later graphical Brand Feature must use approved assets/rules.
