---
id: SYS-MEDIA
status: active
verified_commit: 808d9d78dd090a71b8349ba1947aa5ab8042b7af
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

Phase 8 hardens and adversarially verifies this existing architecture. It adds no route, player, reducer, playback preference, player state store, iframe variant, queue or event bus.

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

Search remains browser-only and unchanged by playback work.

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

Phase-8 hardening keeps failure and cancellation inside those same boundaries:

- asynchronous Lockbox credential resolution is followed by an abort re-check before provider work begins;
- cancellation remains authoritative while a provider request or response parse is pending;
- synchronous adapter `load()` throws resolve to the existing failed phase;
- provider `destroy()` is best-effort cleanup and cannot escape the global player boundary;
- stale native callbacks keep their old request ID and cannot mutate a newer or reset request.

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

### 2.4 Styling and minimum-player boundary

Presets may change only Elara-owned presentation outside the iframe: shell width, border, radius, shadow and toolbar treatment.

They **must not**:

- target or restyle YouTube player controls;
- place overlays, pseudo-elements or frames over any part of the iframe;
- alter iframe opacity, transforms, clipping, pointer behavior or stacking;
- create a different iframe/player instance per preset;
- reduce the actual provider viewport below 200×200 pixels.

The player host remains 16:9 with a 200px minimum width/height contract. Because global border-box sizing makes the Elara shell border consume interior pixels, the ordinary bordered surface reserves 202px minimum width so the provider host still receives a true 200px interior. At viewport widths of 201px or less, Elara removes its decorative shell border and preserves the 200px player viewport instead. The toolbar remains outside the iframe.

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
- The **actual provider viewport**, not merely the outer shell, remains at least 200×200 pixels.
- `embedded` routes only through `PlaybackProvider.start()`.
- `external` routes only through canonical handoff validation.
- `ask` exposes only those two routes.
- Android handoff remains an unpinned VIEW intent with canonical HTTPS fallback.
- Hostile/non-canonical persisted destinations remain inert before either route.
- Persisted `embedUrl` has no readiness/player authority.
- Search/cache/quota/retention architecture is unchanged.
- Active playback and chooser state are not persisted.
- Transient readiness failures are not cached; a later user retry may recover.
- Superseded/reset readiness attempts must not begin or continue provider work after cancellation is observed.

## 5. Security, compatibility and failure semantics

Persisted media is untrusted. A malicious `webUrl` cannot become an internal or external target; a malicious `embedUrl` is ignored by readiness/player construction.

Appearance persistence is normalized independently of playback. Old rows with no player preset and rows containing unknown values resolve to `glass`.

If the appearance subscription cannot read the durable record, the document-root projection falls back to `glass`. This changes decoration only; it cannot start, stop, select or reroute media.

Provider/readiness/player failures remain bounded application errors. A superseded player/readiness attempt receives abort/destroy; late callbacks retain their old request ID and cannot mutate the newer request. Adapter teardown is deliberately best-effort so a provider cleanup exception cannot destabilize React or prevent the next request from becoming authoritative.

Readiness uses an eight-second default provider timeout. Ready/blocked outcomes may be cached for the browser session; transient failures are not. An elected request cancelled while the Lockbox key is being resolved returns `aborted` before issuing `videos.list`.

## 6. Verification

Phase-8 coverage extends the Phase-2–7 matrix with:

- synchronous player-adapter failure containment;
- throwing provider teardown containment;
- repeated start/reset cycles with one global host and no elected-session leakage;
- stale native callback bursts after supersession and reset;
- serialized rapid playback-preference writes with latest-write failure fallback to the last durable value;
- hung readiness timeout;
- cancellation during asynchronous credential lookup before any provider request starts;
- cancellation propagated into an already-pending provider request;
- transient network failure remaining retryable instead of cached;
- rapid appearance-preset persistence/projection bursts and stale-binding disposal;
- browser-level offline readiness failure, exact canonical external fallback and retry;
- one visible fake-official iframe surviving live preset changes without recreation;
- narrow 220px viewport verification of a true >=200px player host;
- corrupted persisted `webUrl` becoming inert after reload;
- ten repeated Ask/Escape cycles restoring focus without multiplying chooser surfaces.

Candidate `b92fd4a4d2608834deae18c85c8226a64a297d28` passed documentation integrity, lint, TypeScript, all 1,225 unit tests, Worker/Durable Object tests and production build. Its full browser run passed 120/121 tests and deliberately exposed one real presentation defect: a 1px shell border on each side reduced the provider host to 198px at a 220px viewport.

The geometry was corrected at the existing CSS boundary rather than weakening the assertion. Behavioral Phase-8 head `808d9d78dd090a71b8349ba1947aa5ab8042b7af` then passed CI #1707 across documentation integrity, lint, TypeScript, 1,225 unit tests, Worker/Durable Object tests, production build, all 121 Playwright tests and the final reliability gate.

## 7. Final boundary

Phase 9 is the final **compliance, documentation and closeout** pass. It must not add another playback feature layer.

Phase 9 must:

- re-read current YouTube API Terms, Required Minimum Functionality, IFrame API/player guidance, branding, Made-for-Kids and quota guidance;
- audit the implemented search, card, internal playback, external handoff, privacy/retention and preference behavior against those requirements;
- reconcile the human YouTube guide and this canonical architecture authority to final runtime truth;
- scan the complete media path for obsolete compatibility fields/dead code, especially persisted `embedUrl`, and remove it through the existing schema/migration path if it no longer carries a legitimate compatibility requirement;
- finish only when the exact final head passes docs, lint, TypeScript, unit, Worker, build, Chromium/Android Playwright, the adversarial media suite and reliability gate.

Still absent by design: custom transport controls, iframe overlays, stream/audio extraction, background/hidden playback, offline media, and a separate playback persistence system.

## 8. Documentation contract

This file remains the compact engineering authority for `SYS-MEDIA`. Keep the eight numbered chapters stable so documentation integrity checks and future-agent routing remain predictable. Human-facing YouTube behavior belongs in [`youtube/README.md`](./youtube/README.md); implementation details should be updated here rather than split into phase-specific memo files.
