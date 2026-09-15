---
id: SYS-MEDIA
status: active
verified_commit: e1b7ede3fd9c7308edd89d9a44ed1c26cb5afa7d
scope: media search, delivery, playback routing/authority/readiness/player, persistence, cache, quota, retention and external handoff
paths: [src/media, src/domain/media.ts, src/domain/playback.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, playback, routing, preference, readiness, iframe, player, handoff, cache, quota, compliance, retention]
---

# Media / YouTube

## 1. Boundary

`SYS-MEDIA` owns YouTube discovery, structured media delivery, search-quota protection, API-data freshness, card routing, one global playback authority, playback readiness, the official YouTube IFrame Player adapter, and validated external platform handoff.

There is **one playback system**. `PlaybackProvider` owns durable-route state, selection, request lineage, reducer state, readiness orchestration, player election and the single global player host. `MediaCard` owns only temporary chooser disclosure. Readiness/player/handoff adapters remain boundaries, not alternate authorities.

The three durable route values are unchanged:

```text
ask      -> disclose Play here / Open YouTube
embedded -> PlaybackProvider.start(item)
external -> validated external handoff
```

Phase 6 unifies the UX around those existing routes; it does not add another route or controller.

Human/operator guide: [`youtube/README.md`](./youtube/README.md).

## 2. Runtime map

### 2.1 Search

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
```

Search remains browser-only and unchanged by playback UX work.

### 2.2 Route selection

Before any route is usable, `MediaCard` reconstructs and validates the canonical YouTube destination. Invalid/hostile persisted media is inert.

`PlaybackProvider` initializes preference to `ask`, so unresolved initial loading is fail-safe without the card inventing another state. Preference status distinguishes:

```text
loading -> initial durable preference read is unresolved
saving  -> a new preference write is pending; last durable preference remains active
ready   -> current durable preference is confirmed
failed  -> load/save failed; provider exposes the safe retained value + error
```

A pending save **does not temporarily switch cards to Ask**. The old durable route remains authoritative until the write succeeds. Failed saves restore/retain the last durable route.

Shared user-facing vocabulary lives in `src/media/playback/presentation.ts` so settings, chooser and fallback copy cannot silently diverge.

### 2.3 Ask chooser

`ask` remains disclosure-only UI:

```text
primary card -> chooser
Play here    -> existing PlaybackProvider.start(item)
Open YouTube -> existing external handoff
Escape       -> close chooser + return focus to primary card control
```

Each mounted card receives a unique chooser id for `aria-controls`; duplicate media identities in different messages cannot create duplicate DOM ids.

If the same item already owns an active internal request, Ask remains operable. Duplicate **Play here** is disabled, while **Open YouTube** remains available. Playback state still comes exclusively from `PlaybackProvider.state`.

### 2.4 Internal playback

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

### 2.5 External handoff

External routing reconstructs the exact canonical URL from provider/kind/id and requires persisted `webUrl` to match. Ordinary browsers receive canonical HTTPS. Supported Android Chromium-family flows may attempt the existing **unpinned** Android VIEW intent with the same canonical HTTPS URL encoded as fallback. Elara does not pin a YouTube package.

Internal failure may expose **Open YouTube instead**, but that fallback uses the independently validated external authority rather than a failed iframe target.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Media schema / identity / freshness | `src/domain/media.ts` |
| Playback lifecycle / decisions | `src/domain/playback.ts` |
| One global playback authority + durable preference state | `src/media/playback/PlaybackProvider.tsx` |
| Shared route presentation vocabulary | `src/media/playback/presentation.ts` |
| Readiness port | `src/media/playback/readiness.ts` |
| YouTube readiness | `src/media/youtube/readiness.ts` |
| Player port | `src/media/playback/player.ts` |
| One global player host | `src/media/playback/PlaybackPlayerHost.tsx` |
| Official YouTube iframe adapter | `src/media/youtube/player.ts` |
| Preference persistence | `src/persistence/preferences.ts` |
| Card routing / chooser | `src/app/components/media/MediaCard.tsx` |
| Route settings | `src/app/components/media/PlaybackPreferenceSettings.tsx` |
| External handoff | `src/media/handoff.ts` |
| Search/cache/budget | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts`, `src/media/storage.ts` |
| Retention | `src/media/retention.ts`, `src/persistence/conversation.ts` |

## 4. Invariants

- Exactly one global `PlaybackProvider` and one reducer/request lineage.
- Exactly one global player host; no card-level iframe/player.
- Exactly one durable route preference authority.
- `MediaCard` owns chooser open/closed state only.
- `embedded` routes only through `PlaybackProvider.start()`.
- `external` routes only through canonical handoff validation.
- `ask` exposes only those two routes.
- Initial unresolved preference is safe because provider default is Ask.
- Pending saves keep the last durable route active.
- Failed saves retain/restore the last durable route.
- Same-item active playback disables duplicate internal start but never removes external escape.
- Chooser ids are unique per mount; Escape closes and restores focus.
- Android handoff remains an unpinned VIEW intent with canonical HTTPS fallback.
- Hostile/non-canonical persisted destinations remain inert before either route.
- Persisted `embedUrl` has no readiness/player authority.
- Search/cache/quota/retention architecture is unchanged.
- Autoplay remains off; native YouTube controls remain unobscured.
- Active playback and chooser state are not persisted.

## 5. Security and failure semantics

Persisted media is untrusted. A malicious `webUrl` cannot become an internal or external target; a malicious `embedUrl` is ignored by readiness/player construction.

Preference-write failure does not cause a route flip. `PlaybackProvider` keeps the last durable preference and exposes the save error. Card routing consumes that same preference rather than deriving a separate fallback state.

Provider/readiness/player failures remain bounded application errors. External fallback is reconstructed and validated independently.

A superseded player/readiness attempt receives abort/destroy. Late callbacks retain their old request ID and cannot mutate the newer request.

## 6. Verification

Phase-6 tests extend the prior Phase-2–5 matrix with:

- provider-level `loading` versus `saving` semantics;
- last-durable-route retention during and after failed saves;
- one shared route vocabulary across settings and cards;
- Ask-mode external access during same-item active playback;
- duplicate internal-start suppression without disabling the chooser;
- unique chooser ids;
- Escape-to-close and focus restoration;
- disabled/focus-visible chooser CSS contracts;
- unpinned Android VIEW intent and canonical fallback preservation;
- browser-level keyboard chooser acceptance.

Behavioral Phase-6 head `e1b7ede3fd9c7308edd89d9a44ed1c26cb5afa7d` passed CI #1698 across documentation integrity, lint, TypeScript, unit tests, Worker/Durable Object tests, production build, full Playwright E2E and final reliability gate.

## 7. Next boundary

Routing UX is now unified on the existing authority. Later presentation work may style the single global player around the iframe, but must not replace native YouTube controls, cover the iframe, create card-local players, or introduce another playback lifecycle.

Still absent by design: custom transport controls, stream/audio extraction, background/hidden playback, offline media, and a separate playback persistence system.
