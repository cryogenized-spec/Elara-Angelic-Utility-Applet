---
id: SYS-MEDIA
status: active
verified_commit: 0b6f03cfc4c4ecaa014827b0d496dd20c7a54b52
scope: media search, normalization, cache, retention and platform handoff
paths: [src/media, src/domain/media.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, handoff, cache, quota, compliance, retention]
---

# Media / YouTube

## 1. Purpose and boundary

`SYS-MEDIA` owns structured media discovery, API-data freshness and handoff. YouTube is the current provider. Elara searches and presents YouTube results, then hands a validated canonical YouTube URL to the browser/platform. It does not embed, download, proxy, or claim control of playback.

The human operational guide is [`youtube/README.md`](./youtube/README.md). This file remains the compact engineering authority.

## 2. Runtime architecture

```text
user request
-> Gemini decides whether youtube.search is needed
-> validated args (1 query by default; hard max 3)
-> normalize/dedupe
-> cache freshness check
-> per-session network-search budget
-> one YouTube search.list request per cache miss
-> provider metadata stamped with apiDataFetchedAt
-> MediaItem[] / media-resolved event
-> persisted message media
-> startup + read-time 30-day freshness enforcement
-> lazy MediaCard
-> exact canonical YouTube URL validation
-> HTTPS / optional Android handoff
```

Search runs only in the browser execution plane. The Worker does not advertise `youtube.search`.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Domain / hard caps / freshness | `src/domain/media.ts` |
| Gemini declaration | `src/google/tools/gemini-declarations.ts` |
| Tool description | `src/google/tools/registry.ts` |
| Tool argument schema | `src/media/youtube-schema.ts` |
| Query normalization | `src/media/normalize.ts` |
| Budget | `src/media/budget.ts` |
| Search cache | `src/media/cache.ts` |
| Startup retention sweep | `src/media/retention.ts` |
| Search orchestration | `src/media/search.ts` |
| YouTube API | `src/media/youtube/service.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| Handoff validation | `src/media/handoff.ts` |
| Tool handler | `src/media/tool-handler.ts` |
| Conversation cleanup | `src/persistence/conversation.ts` |
| UI | `src/app/components/media/` |

## 4. Data and contracts

`youtube.search` accepts one or more queries plus optional `watch|listen` intent. Gemini is instructed to use one concise query by default. Runtime/schema enforcement permits at most three distinct queries in one tool call; duplicate normalized queries collapse before cache/network work. The page-session ceiling is eight network searches. Cache hits spend neither the session allowance nor a YouTube search call.

The provider uses one `search.list` request per cache miss with `part=snippet`, `type=video`, `maxResults=5`, and `safeSearch=strict`. It never follows `nextPageToken` and does not use `videos.list` to enrich normal search cards. Current YouTube documentation gives `search.list` a dedicated default allowance of 100 calls per day; every page/request consumes one call from that search bucket.

Every provider result carries `apiDataFetchedAt`, the wall-clock time at which the API metadata was obtained. Positive search cache entries live seven days and negative entries ten minutes. Persisted YouTube media metadata is displayable only while structurally valid, timestamped, not from the future, and younger than 30 days. Exactly 30 days is expired. Legacy rows without the timestamp fail closed.

Startup maintenance physically purges stale/corrupt media from both media-cache and conversation storage. Conversation reads independently sanitize before returning data to React and best-effort write that cleanup back. The assistant/user message itself is retained; only the expired `media` projection is removed, and cleanup does not bump thread edit timestamps.

Intent is presentation state applied after retrieval and is not part of cache identity. YouTube key validation is separate and uses a lightweight `videos.list?part=id` request, so testing a credential does not spend the dedicated `search.list` allowance. The key is a secondary encrypted Lockbox credential under `SYS-SEC / security.md`.

## 5. Invariants

- Search path is `validate -> normalize/dedupe -> cache -> budget -> network`.
- One cache miss equals at most one `search.list` request; no pagination.
- API keys are sent in `x-goog-api-key`, never URLs, cache rows, media objects, conversation data, or diagnostics.
- Media objects reject unknown fields; credential-like additions cannot survive as trusted `MediaItem` data.
- Provider-returned display text is preserved exactly when valid; it is not aesthetically trimmed or rewritten.
- Missing thumbnail dimensions are not fabricated. Invalid metadata fails validation rather than being repaired.
- Freshness is based on provider-fetch time; reading from cache never refreshes the API-data clock.
- Legacy-undated, future-dated, malformed, and >=30-day media metadata is not displayable.
- Media results are structured application data, never parsed from assistant prose.
- Cards visibly identify YouTube and link outward; no iframe/audio/video player is rendered.
- `watch` and `listen` change action wording only. Both use the exact canonical provider URL and share cache identity.
- Android intent handoff is optional, unpinned to any package, and carries that exact HTTPS URL as fallback.

## 6. Security and failure semantics

The YouTube credential is resolved only at request time from the unlocked Lockbox. Provider failures map to bounded typed failures without propagating raw provider bodies or credential material.

Persisted URLs are untrusted input. For YouTube, a navigable card is allowed only when `provider + kind + id` reconstruct the exact URL already stored in `webUrl`. `javascript:`, `data:`, HTTP, malformed URLs, hostile HTTPS hosts, host aliases, mismatched IDs and extra query parameters fail closed. The card becomes an inert `Unavailable` result with no `href` or Android intent rather than trying to repair the destination.

The ordinary valid card `href` remains HTTPS. Supported Android Chromium flows may attempt an unpinned intent only from a user tap; its browser fallback is the same validated canonical URL.

## 7. Verification and tests

Use `src/media/*.test.ts`, `src/media/youtube/*.test.ts`, `src/persistence/conversation-media-retention.test.ts`, tool declaration/handler tests, `src/app/components/media/*.test.tsx`, `e2e/media-handoff.spec.ts`, and `e2e/media-delivery.phase3.spec.ts`.

Adversarial coverage includes hostile URL schemes/hosts, malformed/mismatched destinations, missing/future/exactly-expired timestamps, credential-shaped unexpected fields, malformed thumbnail geometry, oversized provider text, stale cache rows, stale conversation media, and preservation of historical message text during cleanup.

Playwright proves model-visible quota caps, request parameters, header-only key carriage, listen/watch cache reuse, absence of embedded players, canonical Android fallback, durable `apiDataFetchedAt`, >30-day IndexedDB media removal across reload, survival of assistant prose, and the Settings links to the human guide, YouTube Terms and Google Privacy Policy. Physical Android chooser/default-handler behaviour still requires handset evidence because browser emulation cannot prove OS dispatch.

## 8. Known gaps

The search/cache/conversation retention boundary is now enforced in code rather than left to documentation. The app also exposes the human YouTube guide plus direct links to YouTube Terms and Google Privacy from Settings.

A public operator still owns deployment-level obligations that code in this repository cannot certify by itself: an appropriate application privacy policy/terms and consent treatment for the actual deployment, correct Google Cloud project/API-key ownership and restrictions, and any formal YouTube compliance/audit process applicable to the deployed API Client.

The card uses the unmodified `YouTube` trade name as visible source attribution and deliberately does not manufacture, recolour or approximate a YouTube logo asset. If an official logo asset is introduced later, it must come from YouTube's approved branding resources and follow the current branding dimensions/link rules.

There is deliberately no embedded/global playback manager. If playback is added later, provider identity, API-data policy, player requirements, bundle cost and DOM lifecycle are a new review boundary rather than an inference from this search-only design.
