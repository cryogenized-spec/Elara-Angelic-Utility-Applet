---
id: SYS-MEDIA
status: active
verified_commit: 0369919202f79eba1cff69ea9148d86129023d81
scope: media search, delivery, playback routing/authority/readiness/player, persistence, cache, quota, retention and external handoff
paths: [src/media, src/domain/media.ts, src/domain/playback.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, playback, routing, preference, readiness, iframe, player, handoff, cache, quota, compliance, retention]
---

# Media / YouTube

## 1. Boundary

`SYS-MEDIA` owns YouTube discovery, structured media delivery, search-quota protection, API-data freshness, card routing, one global playback authority, playback readiness, the official YouTube IFrame Player adapter, and validated external platform handoff.

There is **one playback system**. `PlaybackProvider` owns selection, request lineage, reducer state, readiness orchestration, player election and the single global player host. `MediaCard` owns only local chooser disclosure; it never owns playback lifecycle state.

Phase 5 routes validated cards through the existing durable `ask | embedded | external` preference:

```text
ask      -> disclose Play here / Open YouTube
embedded -> PlaybackProvider.start(item)
external -> existing validated external handoff
```

All three routes begin from the same validated `MediaItem`. No second media representation, player authority, reducer, queue, event bus or persistence path was added.

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
```

Search remains browser-only. Text, media and artifacts share the existing generation/persistence lifecycle.

### 2.2 Card routing

Before any route is usable, `MediaCard` reconstructs and validates the canonical YouTube destination. Invalid/hostile persisted media is inert regardless of preference.

```text
validated MediaItem
-> preference status ready? use saved preference : fail-safe to ask

ask:
  primary card button -> local chooser
  Play here           -> PlaybackProvider.start(item)
  Open YouTube        -> canonical external handoff

embedded:
  primary card button -> PlaybackProvider.start(item)

external:
  card anchor         -> canonical external handoff
```

The `ask` chooser is disclosure state only. Current `requested/checking/ready/loading/paused/playing/ended/failed` status comes from `PlaybackProvider.state`, not card-local state.

When internal playback fails, the same card exposes **Open YouTube instead** through the already-validated external route. The original `MediaItem` is not rewritten.

### 2.3 Playback

`src/main.tsx` mounts exactly one `PlaybackProvider`. Its reducer remains the only lifecycle:

```text
idle
-> requested
-> checking
-> ready
-> loading
-> paused <-> playing
-> ended -> playing
active phase -> failed
reset -> idle
```

Internal playback:

```text
PlaybackProvider.start(item)
-> existing prepare(item)
-> canonical identity validation
-> videos.list(part=id,status)
-> if ready: existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
-> native callbacks with same requestId
```

A newer accepted selection, reset or provider unmount disposes obsolete work/player state. Request ID lineage is the correctness authority for late callbacks.

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
| Player geometry / dismiss surface | `src/media/playback/player-host.css` |
| Official YouTube iframe adapter | `src/media/youtube/player.ts` |
| Playback preference persistence | `src/persistence/preferences.ts` |
| Card routing UI | `src/app/components/media/MediaCard.tsx` |
| Card styles | `src/app/components/media/media-card.css` |
| Playback preference settings | `src/app/components/SettingsScreen.tsx` |
| External handoff validation | `src/media/handoff.ts` |
| Search orchestration | `src/media/search.ts` |
| YouTube search adapter | `src/media/youtube/service.ts` |
| Search budgets/cache | `src/media/budget.ts`, `src/media/cache.ts`, `src/media/storage.ts` |
| Tool/model projection | `src/media/tool-handler.ts` |
| Retention | `src/media/retention.ts`, `src/persistence/conversation.ts` |

## 4. Contracts

### 4.1 Search

`youtube.search` accepts `watch|listen` plus at most three distinct normalized queries. One cache miss creates at most one `search.list` call with `part=snippet`, `type=video`, `maxResults=5`, `safeSearch=strict`; no pagination and no routine `videos.list` enrichment.

Local search ceilings remain eight network searches per page session and 24 per device/Pacific quota day. Playback/readiness does not spend these search guards.

### 4.2 Identity, freshness and persistence

Media identity is `provider:id`. Persisted YouTube metadata requires trustworthy `apiDataFetchedAt`; age `>=30 days`, future-dated, malformed and undated legacy media fail closed.

Only `ask | embedded | external` playback preference is durable. It is exposed in Chat settings and persisted through the existing preference authority. Selection, chooser disclosure, request ID, readiness result, active player, phase/position and failures are session-only.

If preference loading has not completed successfully, cards fail safe to `ask` rather than silently choosing internal or external playback.

### 4.3 External handoff

External routing reconstructs the exact canonical URL from provider/kind/id and requires stored `webUrl` to match. Ordinary browsers open canonical HTTPS. Supported Android Chromium-family flows may attempt the existing **unpinned** Android VIEW intent, with the exact canonical HTTPS destination retained as fallback. Elara does not pin a YouTube package.

`watch` and `listen` both use the ordinary canonical YouTube destination; intent affects presentation, not destination identity.

### 4.4 Readiness and player

Readiness remains mandatory before internal playback. It uses `videos.list(part=id,status)` and blocks unavailable, non-embeddable and Made-for-Kids videos. Made-for-Kids remains external-only.

The official iframe adapter remains lazy, uses native controls, `autoplay=0`, `playsinline=1`, and current HTTP(S) `origin` when available. Persisted `embedUrl` is never playback authority.

The global player surface is now user-visible inside the fixed application viewport. It has one **Close player** action outside the iframe; that action calls the existing `reset()` authority. Elara does not add custom transport controls or place an overlay over the YouTube player.

## 5. Invariants

- Exactly one global `PlaybackProvider` and one reducer/request lineage.
- Exactly one global player host; never a card-level iframe/player.
- `MediaCard` may own chooser open/closed state only, not playback lifecycle.
- `embedded` routes only through `PlaybackProvider.start()`.
- `external` preserves the existing canonical handoff path.
- `ask` exposes only those two existing routes.
- Preference-loading uncertainty fails safe to `ask`.
- Hostile/non-canonical persisted destinations remain inert before either route.
- Current playback status is read from the global authority.
- A card cannot start duplicate internal playback while it already owns an active player request.
- Failed internal playback preserves an independently validated external fallback.
- Close player uses existing `reset()`; no new dismiss lifecycle exists.
- Android external handoff remains unpinned and keeps canonical HTTPS fallback.
- Search/cache/quota architecture is unchanged by card routing.
- Persisted `embedUrl` has no readiness/player authority.
- Autoplay remains off; native YouTube controls remain unobscured.
- Active playback state is not persisted.

## 6. Failure and security semantics

Persisted media is untrusted. Canonical validation occurs before the card can expose either route. A malicious `webUrl` cannot become an external or internal target, and a malicious `embedUrl` is ignored by readiness/player construction.

Provider/readiness/player failures use bounded application messages. Internal failure does not damage the original valid card and does not manufacture a fallback URL; the fallback uses the same independently validated external handoff authority.

A superseded player/readiness attempt receives abort/destroy. Late callbacks retain their old request ID and cannot mutate the newer request.

## 7. Verification

Phase-5 coverage extends the existing Phase-2/3/4 suites with:

- MediaCard preference-routing tests: `ask`, `embedded`, `external`.
- preference-loading fail-safe behavior.
- hostile/stale destination rejection across routes.
- global-authority status projection and active-player duplicate suppression.
- internal-failure external fallback.
- Chat-settings preference persistence.
- global player dismiss/reset and fixed-viewport geometry.
- canonical external-link behavior and unpinned Android VIEW-intent fallback.
- updated browser acceptance so non-routing tests assert the media card rather than hard-code an anchor element.

Behavioral Phase-5 head `0369919202f79eba1cff69ea9148d86129023d81` passed CI #1696 across documentation integrity, lint, TypeScript, unit tests, Worker/Durable Object tests, production build, full Playwright E2E and final reliability gate.

## 8. Next boundary

Phase 5 makes routing operable and reversible. The next pass should **unify and harden that UX**, not create another route: terminology, chooser/settings consistency, fallback behavior, Android external semantics, and accessibility should all continue to resolve through the same three preference values and the same `PlaybackProvider.start()` / handoff authorities.

Still absent by design: custom transport controls, iframe overlays, audio extraction, background/hidden playback, offline media and a separate playback persistence system.
