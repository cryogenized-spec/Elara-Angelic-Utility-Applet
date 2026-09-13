---
id: SYS-MEDIA
status: active
verified_commit: 7e095344c1cf0f9babd0f76632393fbce09b33e5
scope: media search, normalization, cache and platform handoff
paths: [src/media, src/domain/media.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, handoff, cache, quota, compliance]
---

# Media / YouTube

## 1. Purpose and boundary

`SYS-MEDIA` owns structured media discovery and handoff. YouTube is the current provider implementation. Elara searches and presents YouTube results, then hands the selected canonical YouTube URL to the browser/platform. It does not embed, download, proxy, or claim control of playback.

The human operational guide is [`youtube/README.md`](./youtube/README.md). This file remains the compact engineering authority.

## 2. Runtime architecture

```text
user request
-> Gemini decides whether youtube.search is needed
-> validated tool args (1 query by default; hard max 3)
-> normalize/dedupe
-> local cache
-> per-session network-search budget
-> one YouTube search.list request per cache miss
-> provider metadata -> MediaItem[]
-> media-resolved event
-> message media
-> lazy MediaCard -> canonical YouTube handoff
```

Search runs only in the browser execution plane. The Worker does not advertise `youtube.search`.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Domain contract / hard caps | `src/domain/media.ts` |
| Gemini declaration | `src/google/tools/gemini-declarations.ts` |
| Tool description | `src/google/tools/registry.ts` |
| Tool argument schema | `src/media/youtube-schema.ts` |
| Query normalization | `src/media/normalize.ts` |
| Budget | `src/media/budget.ts` |
| Cache | `src/media/cache.ts` |
| Search orchestration | `src/media/search.ts` |
| YouTube API | `src/media/youtube/service.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| Handoff | `src/media/handoff.ts` |
| Tool handler | `src/media/tool-handler.ts` |
| UI | `src/app/components/media/` |

## 4. Data and contracts

`youtube.search` accepts one or more queries plus optional `watch|listen` intent. Gemini is instructed to use one concise query by default. Runtime/schema enforcement permits at most three distinct queries in one tool call; duplicate normalized queries collapse before cache/network work. The page-session ceiling is eight network searches. Cache hits spend neither the session allowance nor a YouTube search call.

The provider uses one `search.list` request per cache miss with `part=snippet`, `type=video`, `maxResults=5`, and `safeSearch=strict`. It never follows `nextPageToken` and does not use `videos.list` to enrich normal search cards. Current YouTube documentation gives `search.list` a dedicated default allowance of 100 calls per day; every page/request consumes one call from that search bucket.

Successful search metadata is cached for seven days; empty results for ten minutes. Intent is presentation state applied after retrieval and is not part of cache identity. `ChatMessage.media` may also persist structured media with the conversation.

YouTube key validation is separate and uses a lightweight `videos.list?part=id` request, so testing the credential does not spend the dedicated `search.list` allowance. The key is a secondary encrypted Lockbox credential under `SYS-SEC / security.md`.

## 5. Invariants

- Search path is `validate -> normalize/dedupe -> cache -> budget -> network`.
- One cache miss equals at most one `search.list` request; no pagination.
- API keys are sent in `x-goog-api-key`, never URLs, cache rows, tool results, conversation data, or diagnostics.
- Provider-returned display text is preserved exactly when valid; it is not aesthetically trimmed or rewritten.
- Missing thumbnail dimensions are not fabricated. Invalid optional metadata is omitted; invalid required metadata drops the result.
- Media results are structured application data, never parsed from assistant prose.
- Cards identify YouTube and link outward; no iframe/audio/video player is rendered.
- Duration and playback state are never fabricated.
- `watch` and `listen` change presentation/action wording only. Both preserve the provider's canonical result URL and share search-cache identity.
- Android intent handoff is optional, unpinned to any package, and carries the exact HTTPS YouTube URL as fallback.

## 6. Security and failure semantics

The YouTube credential is resolved only at request time from the unlocked Lockbox. A malformed, absent, rejected, rate-limited, quota-exhausted, or network-failed request maps to a bounded typed failure without propagating provider response bodies or credential material.

Handoff never replaces the normal card `href` with `intent://`. The ordinary link remains the canonical HTTPS provider destination. Supported Android Chromium flows may attempt an unpinned intent from the user's tap; browser/platform handler selection remains outside Elara's authority.

## 7. Verification and tests

Use `src/media/*.test.ts`, `src/media/youtube/*.test.ts`, tool declaration/handler tests, `src/app/components/media/*.test.tsx`, `e2e/media-handoff.spec.ts`, and `e2e/media-delivery.phase3.spec.ts`.

The browser suite proves model-visible quota caps, exact search request parameters, header-only key carriage, cache reuse across listen/watch intent, absence of embedded players, canonical URL handoff, Android fallback construction, lazy-card geometry, thumbnail failure recovery, and late-content scroll authority. Physical Android chooser/default-handler behaviour still requires handset evidence because browser emulation cannot prove OS dispatch.

## 8. Known gaps

The seven-day search cache is within YouTube's temporary non-authorized-data retention window, but media metadata can also survive longer inside persisted conversation messages. Production compliance therefore still requires the conversation-persistence lifecycle to refresh or delete applicable YouTube API data within the policy window.

A public API Client also needs its own user-facing privacy/terms disclosures and consent handling as required by YouTube policy; links to YouTube Terms and Google Privacy are present in Settings, but those links alone are not a complete privacy policy. Credential ownership/restrictions must match the actual deployment model. These are explicit close-out obligations, not silently assumed complete.

There is deliberately no embedded/global playback manager in the current system. If playback is added later, provider identity, API-data policy, player requirements, bundle cost, and DOM lifecycle must be reviewed as a new boundary rather than inferred from this search-only design.
