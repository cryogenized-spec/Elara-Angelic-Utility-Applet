---
id: SYS-MEDIA
status: active
verified_commit: 18c7678f59780eb1db6cbaa064dacf6e3c378cf8
scope: media search, delivery, playback routing/authority/readiness/player, appearance, compliance, persistence, cache, quota, retention and external handoff
paths: [src/media, src/domain/media.ts, src/domain/playback.ts, src/app/components/media]
keywords: [media, youtube, search, video, music, playback, routing, preference, readiness, iframe, player, appearance, preset, handoff, cache, quota, compliance, consent, retention]
---

# Media / YouTube

## 1. Boundary

`SYS-MEDIA` owns YouTube discovery, structured media delivery, search-quota protection, API-data freshness, policy consent, card attribution/routing, one global playback authority, playback readiness, the official YouTube IFrame Player adapter, the Elara-owned presentation shell around that player, and validated external platform handoff.

There is **one playback system**. `PlaybackProvider` owns durable-route state, selection, request lineage, reducer state, readiness orchestration, player election and the single global player host. `MediaCard` owns only temporary chooser disclosure. Readiness/player/handoff adapters remain boundaries, not alternate authorities.

The durable route values remain:

```text
ask      -> disclose Play here / Open YouTube
embedded -> PlaybackProvider.start(item)
external -> validated external handoff
```

The nine-phase YouTube playback roadmap is complete at behavioral head `18c7678f59780eb1db6cbaa064dacf6e3c378cf8`. Phase 9 closes compliance/migration debt without adding another player, route, controller, queue, state machine or persistence authority.

Human/operator guide: [`youtube/README.md`](./youtube/README.md).

## 2. Runtime map

### 2.1 Consent, search and routing

```text
Settings / Lockbox
-> versioned YouTube policy acceptance in existing preferences DB

user request
-> youtube.search
-> current policy accepted?
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

YouTube network functionality fails closed until the current policy notice is accepted. Acceptance is durable versioned state in the existing preferences database; it is deliberately separate from the encrypted YouTube API credential.

Before either playback route is usable, Elara reconstructs and validates the canonical YouTube destination. Invalid/hostile persisted media is inert. Cards visibly attribute YouTube using the official brand asset plus explicit `Source: YouTube` text.

### 2.2 Internal playback

```text
PlaybackProvider.start(item)
-> prepare(item)
-> current policy accepted?
-> canonical identity validation
-> videos.list(part=id,status)
-> existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
-> native callbacks with same requestId
```

The player remains singular, native-controlled and non-autoplaying. Made-for-Kids, unavailable and non-embeddable results remain outside the internal-player path. Close player calls existing `reset()`.

Cancellation remains authoritative before and during provider work. Synchronous adapter `load()` throws resolve to the existing failed phase; provider `destroy()` is best-effort cleanup; stale native callbacks retain their old request ID and cannot mutate a newer/reset request.

### 2.3 Data contract and migrations

`MediaItem` persists only the canonical external `webUrl`; internal playback reconstructs its target from `provider + kind + id`. The obsolete `embedUrl` field is no longer emitted, trusted or part of the domain contract.

Legacy conversation and media-cache rows are migrated by removing only `embedUrl`, after which the normal strict media validator remains authoritative. The migration does not create a compatibility schema or trust arbitrary legacy fields.

Non-authorized YouTube API metadata must be refreshed or removed before 30 calendar days. Elara does not persist YouTube video/audio bytes.

### 2.4 Appearance and minimum-player boundary

`mediaPlayerSurfacePreset` remains part of the existing `chat-appearance` preference record:

```text
chat-appearance
-> Dexie liveQuery
-> data-elara-media-player-preset
-> CSS variables on .playback-player-surface
```

`minimal | glass | cinema` alter only Elara-owned shell presentation. They cannot select, start, stop or reroute media and cannot decorate/cover native YouTube controls.

The actual provider viewport remains at least 200×200 pixels. The ordinary bordered shell reserves 202px minimum width so border-box sizing still leaves a true 200px host. At <=201px viewport width Elara drops the decorative border before sacrificing provider geometry.

### 2.5 External handoff

External routing reconstructs the exact canonical URL from provider/kind/id and requires persisted `webUrl` to match. Ordinary browsers receive canonical HTTPS. Supported Android Chromium-family flows may attempt the existing **unpinned** Android VIEW intent with the same canonical HTTPS URL encoded as fallback. Elara never package-pins YouTube.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Media schema / identity / freshness | `src/domain/media.ts` |
| Playback lifecycle / decisions | `src/domain/playback.ts` |
| Global playback authority + durable route preference | `src/media/playback/PlaybackProvider.tsx` |
| Readiness | `src/media/playback/readiness.ts`, `src/media/youtube/readiness.ts` |
| Official iframe adapter | `src/media/youtube/player.ts` |
| Global player host | `src/media/playback/PlaybackPlayerHost.tsx` |
| Appearance projection / shell | `src/media/playback/surface-preset.ts`, `src/media/playback/player-host.css` |
| Card attribution / route chooser | `src/app/components/media/MediaCard.tsx` |
| Policy consent UI | `src/app/components/media/YouTubePolicyConsent.tsx` |
| Consent + other preference persistence | `src/persistence/preferences.ts` |
| Conversation media migration/retention | `src/persistence/conversation.ts` |
| Search cache migration/storage | `src/media/storage.ts` |
| Search/cache/budget | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts` |
| External handoff | `src/media/handoff.ts` |
| Public privacy / terms | `public/privacy.html`, `public/terms.html` |

## 4. Invariants

- Exactly one global `PlaybackProvider`, reducer/request lineage and visible player host.
- Exactly one durable playback-route preference authority.
- Player appearance stays in existing appearance state, never playback state.
- YouTube network features require current versioned policy acceptance.
- Policy acceptance does not decrypt, replace or duplicate the YouTube API credential.
- YouTube result cards visibly identify their source and keep the official brand asset unobscured.
- Internal playback uses only the official IFrame Player with native controls and `autoplay=0`.
- No overlay/custom control may cover any portion of the iframe.
- The actual provider viewport, not merely the outer shell, remains >=200×200.
- `embedded` routes only through `PlaybackProvider.start()`; `external` routes only through canonical handoff validation; `ask` exposes only those two choices.
- Android handoff remains an unpinned VIEW intent with canonical HTTPS fallback.
- Persisted `webUrl` is untrusted and must exactly match the canonical provider destination.
- `embedUrl` is retired from the trusted/persisted media contract; legacy rows are stripped before strict validation.
- Active playback, chooser state, request lineage and playback position are not persisted.
- Transient readiness failures are not cached; later explicit retry may recover.
- Non-authorized YouTube API metadata is refreshed or removed before 30 days.
- Elara never stores YouTube video/audio content.

## 5. Security, privacy and failure semantics

The browser sends the user-supplied YouTube API key directly to Google/YouTube from the unlocked local Lockbox; Elara does not intentionally place it in request URLs, chat content, analytics or logs. Search, key validation and playback-readiness network work remain disabled before policy acceptance.

The first-party [`privacy.html`](../public/privacy.html) and [`terms.html`](../public/terms.html) surfaces describe current data handling and link to the official YouTube Terms of Service and Google Privacy Policy. Removing the YouTube credential, deleting conversations, and clearing app/site storage provide the current local-data controls; the integration does not request YouTube OAuth Authorized Data.

Persisted media is untrusted. A malicious/non-canonical `webUrl` cannot become an internal target or external link. Legacy `embedUrl` has been removed rather than retained as dormant authority.

Provider/readiness/player failures remain bounded application errors. Cancellation is re-checked after asynchronous Lockbox credential retrieval and while provider responses are pending. Adapter teardown is deliberately best-effort so cleanup exceptions cannot destabilize React or prevent the next elected request from becoming authoritative.

## 6. Verification

The final roadmap matrix covers the earlier search/quota, routing, player, mobile, preference, appearance and adversarial contracts plus Phase-9 compliance/migration behavior:

- policy consent persists durably and defaults to unaccepted;
- fresh-browser E2E proves the consent control is disabled until checked, local privacy/terms pages load, acceptance survives reload and official policy links remain present;
- YouTube search/readiness/key-validation paths fail closed without consent;
- provider results carry visible YouTube attribution;
- `embedUrl` is absent from new provider/domain data and stripped from legacy conversation/cache rows;
- malformed migrated media still fails the normal strict validator;
- existing hostile-URL, MFK, offline/retry, stale-callback, rapid-preference, preset, viewport, Android handoff and single-player tests remain intact.

Phase-9 candidate `1ff05c4f8245dbbf4bcf5dc010a8adb5d874de6f` passed every non-browser gate; CI #1716 then exposed one stale browser selector after official logo attribution added a second image to each media card. The selector was narrowed to the thumbnail contract rather than weakening product behavior.

Behavioral Phase-9 head `18c7678f59780eb1db6cbaa064dacf6e3c378cf8` passed CI #1717 across documentation integrity, lint, TypeScript, all 1,233 unit tests, Worker/Durable Object tests, production build, all 122 Playwright tests and final reliability.

## 7. Release state

The YouTube playback roadmap is closed after Phase 9. No Phase 10 feature layer is planned by this document.

Further work belongs to normal repository evolution rather than another playback phase. In particular, repository-wide lint/TypeScript/test/CI hardening is owned by `SYS-REL`, not `SYS-MEDIA`.

Still absent by design: custom transport controls, iframe overlays, stream/audio extraction, hidden/background playback, offline YouTube media, package-pinned Android handoff, YouTube OAuth Authorized Data, and a separate playback persistence system.

Any future material change to YouTube data access/storage/sharing must update the privacy/terms surfaces and increment the policy-consent version before the changed functionality can be enabled.

## 8. Documentation contract

This file is the compact engineering authority for `SYS-MEDIA`. Keep the eight numbered chapters stable so documentation integrity checks and future-agent routing remain predictable. Human-facing YouTube implementation/compliance guidance belongs in [`youtube/README.md`](./youtube/README.md); implementation truth belongs here rather than in phase-specific status or handoff documents.
