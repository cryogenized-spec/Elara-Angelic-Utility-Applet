---
id: SYS-MEDIA
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: media search, normalization, cache and platform handoff
paths: [src/media, src/domain/media.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, handoff, cache]
---

# Media / YouTube

## 1. Purpose and boundary

`SYS-MEDIA` owns structured media discovery and handoff. YouTube is the current provider implementation. Elara searches and presents media results, then hands playback to an external browser/platform destination; it does not embed or claim control of playback.

## 2. Runtime architecture

```text
Gemini youtube.search
-> normalize/dedupe queries
-> local cache
-> session search budget
-> YouTube Data API search
-> normalized MediaItem[]
-> media-resolved event
-> MediaCard HTTPS/platform handoff
```

Search runs in the browser execution plane. The Worker does not advertise `youtube.search`.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Domain contract | `src/domain/media.ts` |
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

Search accepts an optional `watch|listen` intent. A call can contain at most eight normalized queries; duplicate queries are collapsed before cache/network work. The session budget permits 12 network searches. Search intentionally avoids pagination and `videos.list` enrichment during normal result discovery.

Results are cached in the dedicated `elara-media-cache` Dexie database without credentials. Intent is presentation/handoff state and is stamped after cache retrieval rather than included in the cache identity. Structured media may also be persisted on `ChatMessage.media`.

YouTube key validation is separate and uses a lightweight `videos.list?part=id` validation request. The key is stored as a secondary Lockbox credential under `SYS-SEC / security.md`.

## 5. Invariants

- Search path is `dedupe -> cache -> budget -> network`.
- API keys are sent in the `x-goog-api-key` header, never URLs, cache rows, tool results or diagnostics.
- Media results are structured application data, not assistant-prose parsing.
- Current UI is a link/handoff, not iframe/audio playback.
- Duration or playback state is never fabricated when the API result does not provide it.
- `watch` and `listen` do not alter search-cache identity.

## 6. Security and failure semantics

Handoff always retains a valid HTTPS destination. On supported Android flows an `intent://` attempt may be used with timed HTTPS fallback; app/package availability is a platform decision. Typed failures distinguish credential/configuration, quota/budget, provider and malformed-result cases without echoing secrets.

## 7. Verification and tests

Use `src/media/*.test.ts`, YouTube service/validation tests, tool declaration/handler tests and MediaCard tests. Physical Android chooser/handoff behavior requires handset validation; unit tests can only prove URL/fallback construction.

## 8. Known gaps

There is deliberately no embedded player or global playback manager in the current system. If one is added, keep search/cache/provider identity separate from playback state and revisit bundle/DOM/API constraints explicitly.
