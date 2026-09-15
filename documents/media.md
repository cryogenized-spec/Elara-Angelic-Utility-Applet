---
id: SYS-MEDIA
status: active
verified_commit: 5b1d962ddf76970857977790517dcf7d80fc3035
scope: media search, delivery, playback routing/authority/readiness/player, player appearance, persistence, cache, quota, retention and external handoff
paths: [src/media, src/domain/media.ts, src/domain/playback.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, playback, routing, preference, readiness, iframe, player, appearance, preset, handoff, cache, quota, compliance, retention]
---

# Media / YouTube

## 1. Boundary

`SYS-MEDIA` owns YouTube discovery, structured media delivery, search-quota protection, API-data freshness, card routing, one global playback authority, playback readiness, the official YouTube IFrame Player adapter, the Elara-owned presentation shell around that player, and validated external platform handoff.

There is **one playback system**. `PlaybackProvider` owns durable-route state, selection, request lineage, reducer state, readiness orchestration, player election and the single global player host. `MediaCard` owns only temporary chooser disclosure. Readiness/player/handoff adapters remain boundaries, not alternate authorities.

The three durable route values remain:

```text
ask      -> disclose Play here / Open YouTube
embedded -> PlaybackProvider.start(item)
external -> validated external handoff
```

Phase 7 adds presentation presets only around the existing global player. It does not add a route, player, reducer, playback preference, player state store, or iframe variant.

Human/operator guide: [`youtube/README.md`](./youtube/README.md).

## 2. Runtime map

### 2.1 Search and route selection

```text
user request
-> Gemini youtube.search decision
-> normalize/dedupe
-> cache
-> 8-search page-session guard
-> 24-search device/Pacific-day guard
-> one search.list request per cache miss
-> MediaItem[] + lean Gemini projection
-> message lifecycle / retention
-> MediaCard
-> ask | embedded | external
```

Search remains browser-only and unchanged by playback presentation work.

Before either playback route is usable, `MediaCard` reconstructs and validates the canonical YouTube destination. Invalid/hostile persisted media is inert. `PlaybackProvider` remains the only route-preference and playback-lifecycle authority.

### 2.2 Internal playback

```text
PlaybackProvider.start(item)
-> existing prepare(item)
-> canonical identity validation
-> videos.list(part=id,status)
-> existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
-> native callbacks with same requestId
```

The player remains singular, native-controlled and non-autoplaying. Close player calls existing `reset()`.

### 2.3 Appearance projection

The player appearance is part of the existing `ChatAppearancePreferences` record, not playback state:

```text
chat-appearance record
-> mediaPlayerSurfacePreset
-> existing Dexie liveQuery
-> document-root data-elara-media-player-preset
-> CSS variables on .playback-player-surface
```

Allowed values are:

```text
minimal -> compact/subtle outer shell
 glass  -> existing/default shell
cinema  -> wider, higher-emphasis outer shell
```

Old, missing or invalid persisted values normalize to `glass`.

`src/media/playback/surface-preset.ts` is a derived presentation bridge only. It observes the existing durable `chat-appearance` authority and projects one root attribute. It does not own a second preference store, React context, playback state, queue or event bus.

### 2.4 Styling boundary

Presets may change only Elara-owned presentation outside the iframe: shell width, border, radius, shadow and toolbar treatment.

They **must not**:

- target or restyle YouTube player controls;
- place overlays, pseudo-elements or frames over any part of the iframe;
- alter iframe opacity, transforms, clipping, pointer behavior or stacking;
- create a different iframe/player instance per preset;
- reduce the player below the existing 200px minimum geometry.

The player host remains 16:9 with `min-height: 200px`; the surface retains `min-width: 200px`. The toolbar remains outside the iframe.

### 2.5 External handoff

External routing reconstructs the exact canonical URL from provider/kind/id and requires persisted `webUrl` to match. Ordinary browsers receive canonical HTTPS. Supported Android Chromium-family flows may attempt the existing **unpinned** Android VIEW intent with the same canonical HTTPS URL encoded as fallback. Elara does not pin a YouTube package.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Media schema / identity / freshness | `src/domain/media.ts` |
| Playback lifecycle / decisions | `src/domain/playback.ts` |
| One global playback authority + durable route preference | `src/media/playback/PlaybackProvider.tsx` |
| Shared route presentation vocabulary | `src/media/playback/presentation.ts` |
| Readiness | `src/media/playback/readiness.ts`, `src/media/youtube/readiness.ts` |
| Player port / adapter | `src/media/playback/player.ts`, `src/media/youtube/player.ts` |
| One global player host | `src/media/playback/PlaybackPlayerHost.tsx` |
| Player shell preset projection | `src/media/playback/surface-preset.ts` |
| Player shell styling | `src/media/playback/player-host.css` |
| Existing appearance schema / defaults | `src/domain/preferences.ts` |
| Existing preference persistence | `src/persistence/preferences.ts` |
| Appearance settings UI | `src/app/components/ChatAppearanceSettings.tsx` |
| Card routing / chooser | `src/app/components/media/MediaCard.tsx` |
| Route settings | `src/app/components/media/PlaybackPreferenceSettings.tsx` |
| External handoff | `src/media/handoff.ts` |
| Search/cache/budget | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts`, `src/media/storage.ts` |
| Retention | `src/media/retention.ts`, `src/persistence/conversation.ts` |

## 4. Invariants

- Exactly one global `PlaybackProvider` and one reducer/request lineage.
- Exactly one global player host; no card-level iframe/player.
- Exactly one durable route preference authority.
- Player visual preset lives in the existing `chat-appearance` record, not playback persistence.
- `minimal | glass | cinema` are presentation only; `glass` is the backward-compatible default.
- The root preset attribute is a derived projection, not state authority.
- Presets style only `.playback-player-surface` and the Elara toolbar outside the iframe.
- No preset selector may target the iframe/host to add decoration or overlays.
- YouTube native controls remain visible and unobscured.
- Existing `autoplay=0`, origin/referrer behavior and official IFrame Player adapter remain unchanged.
- Player viewport remains at least 200px with 16:9 host geometry.
- `embedded` routes only through `PlaybackProvider.start()`.
- `external` routes only through canonical handoff validation.
- `ask` exposes only those two routes.
- Android handoff remains an unpinned VIEW intent with canonical HTTPS fallback.
- Hostile/non-canonical persisted destinations remain inert before either route.
- Persisted `embedUrl` has no readiness/player authority.
- Search/cache/quota/retention architecture is unchanged.
- Active playback and chooser state are not persisted.

## 5. Security, compatibility and failure semantics

Persisted media is untrusted. A malicious `webUrl` cannot become an internal or external target; a malicious `embedUrl` is ignored by readiness/player construction.

Appearance persistence is normalized independently of playback. Old rows with no player preset and rows containing unknown values resolve to `glass`, so adding Phase 7 requires no schema fork or migration-only state path.

If the appearance subscription cannot read the durable record, the document-root projection falls back to `glass`. This changes decoration only; it cannot start, stop, select or reroute media.

Provider/readiness/player failures remain bounded application errors. A superseded player/readiness attempt receives abort/destroy; late callbacks retain their old request ID and cannot mutate the newer request.

## 6. Verification

Phase-7 coverage extends the Phase-2–6 matrix with:

- normalization of missing/invalid player presets to `glass`;
- persistence round-trip through the existing `chat-appearance` record;
- live Dexie projection from the existing appearance authority to the document root;
- guarded projection cleanup so an older binding cannot erase a newer value;
- Appearance-settings radio behavior for Minimal / Glass / Cinema;
- static CSS guards proving presets target the outer surface rather than iframe/host decoration;
- guards for absence of player overlays/pseudo-elements and preservation of 200px/16:9 geometry;
- browser acceptance proving Glass on a fresh state, live switch to Cinema, and Cinema persistence after reload.

The first Phase-7 candidate `c7e08e450aea0386825808d5b1de0c1996f4dced` passed documentation integrity, lint and typecheck, and all 1,211 executed unit tests; CI #1701 stopped because the new static CSS test attempted to read its fixture through Vitest's transformed `import.meta.url`. The test path was corrected to the repository-root file path without changing runtime code.

Behavioral Phase-7 head `5b1d962ddf76970857977790517dcf7d80fc3035` passed CI #1702 across documentation integrity, lint, TypeScript, unit tests, Worker/Durable Object tests, production build, full Playwright E2E and final reliability gate.

## 7. Next boundary

Phase 8 is adversarial verification. It should attack the **existing** playback stack rather than add features: rapid route changes, preference/preset races, stale readiness/player callbacks, repeated open/close cycles, malformed persisted media, offline/provider failure, viewport extremes, keyboard/focus behavior and Android fallback should all continue to resolve through the same authorities.

Still absent by design: custom transport controls, iframe overlays, stream/audio extraction, background/hidden playback, offline media, and a separate playback persistence system.

## 8. Documentation contract

This file remains the compact engineering authority for `SYS-MEDIA`. Keep the eight numbered chapters stable so documentation integrity checks and future-agent routing remain predictable. Human-facing YouTube behavior belongs in [`youtube/README.md`](./youtube/README.md); implementation details should be updated here rather than split into phase-specific memo files.
