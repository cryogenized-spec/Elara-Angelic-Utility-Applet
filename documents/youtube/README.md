# YouTube Media in Elara

Elara has one YouTube media system: one search path, one validated `MediaItem`, one durable playback route preference, one global `PlaybackProvider`, one readiness path, one official YouTube IFrame Player host, one validated external handoff path, and one Elara-owned presentation shell around the player.

Phase 8 adversarially verifies and hardens those same authorities. It does not add another player, route authority, state machine or YouTube control layer.

> Implementation/compliance guide only. Current Google/YouTube policies take priority.

## 1. The three playback routes are unchanged

Shared labels remain:

- **Ask each time**
- **Play here**
- **Open YouTube**

The durable route values remain `ask | embedded | external`. Every route still starts from canonical validation of `provider + kind + id + webUrl`.

Player appearance is independent of route selection. Choosing Minimal, Glass or Cinema cannot select media, start playback, change readiness or alter external handoff.

## 2. Player appearance presets

Appearance settings expose:

- **Minimal** — a narrower, quieter Elara shell.
- **Glass** — the existing/default shell and the compatibility fallback for old preference rows.
- **Cinema** — a slightly wider, higher-emphasis Elara shell.

The durable value is stored as `mediaPlayerSurfacePreset` inside the **existing `chat-appearance` preference record**. No new database or preference store exists.

Old rows that predate the field normalize to `glass`. Unknown persisted values also normalize to `glass`.

## 3. What a preset is allowed to change

Presets may style only Elara-owned UI outside the official YouTube iframe:

```text
player surface width
border
corner radius
outer shadow
Elara toolbar background/border/text
```

The toolbar containing **Close player** remains above and outside the iframe.

Presets do **not** change:

```text
YouTube player instance
video id
iframe source/target
native controls
playback lifecycle
readiness
route preference
external URL
```

The actual provider viewport is kept at least 200×200 pixels. The ordinary bordered Elara shell reserves the border outside that minimum; at an extremely narrow viewport Elara drops its decorative border before it allows the provider viewport to shrink below 200px. The host retains 16:9 geometry where the available viewport permits it.

Elara does not add overlays, pseudo-elements, filters, clipping or custom visual layers over the iframe.

## 4. How the appearance reaches the global player

The globally mounted player lives outside the normal Appearance component tree, so Elara reuses the existing durable appearance authority rather than creating another context.

```text
existing chat-appearance record
-> Dexie liveQuery
-> mediaPlayerSurfacePreset
-> data-elara-media-player-preset on <html>
-> player-host.css outer-shell variables
```

This projection is decoration only. It carries no selected media, request ID, player phase or route decision.

The document root starts safely on `glass`. If reading the appearance record fails, the projection also falls back to `glass`.

Rapid appearance writes converge on the latest durable preset, and a disposed/stale binding cannot overwrite a later owner.

## 5. Play here remains the same official player

Internal playback still uses:

```text
PlaybackProvider.start(item)
-> prepare(item)
-> canonical identity check
-> YouTube videos.list readiness
-> existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
```

`prepare()` remains readiness-only. No card or appearance preset creates an iframe.

Made-for-Kids, unavailable and non-embeddable videos remain blocked before the player adapter. Persisted `embedUrl` remains non-authoritative.

The official player keeps native YouTube controls, `autoplay=0`, inline playback and the existing origin/referrer identity. Close player remains an Elara control outside the iframe and calls existing `reset()`.

Phase-8 hardening also guarantees:

- cancellation during asynchronous Lockbox credential retrieval stops before a stale `videos.list` request can begin;
- cancellation after provider work starts propagates into that request and resolves as `aborted`;
- transient network/readiness failures are not cached, so an explicit later retry can recover;
- a synchronous player-adapter failure becomes the existing failed playback state rather than escaping React;
- a broken provider `destroy()` is contained as best-effort cleanup;
- stale native callbacks after supersession/reset cannot mutate the current player request.

## 6. Ask / Open YouTube remain unchanged

Ask mode remains a disclosure UI with **Play here** and **Open YouTube**. It does not own player state.

External handoff still reconstructs the exact canonical YouTube URL. Ordinary browsers use canonical HTTPS. Supported Android Chromium-family browsers may attempt the existing **unpinned Android VIEW intent**, preserving the canonical HTTPS URL as fallback. No YouTube package is forced.

If internal playback fails, **Open YouTube instead** still uses the independently validated external route.

A corrupted/non-canonical persisted `webUrl` is inert after reload; it cannot become either an internal player target or an external link.

## 7. Preference boundaries

There are two separate durable preferences, both using existing authorities:

```text
media-playback record -> ask | embedded | external
chat-appearance record -> mediaPlayerSurfacePreset + existing appearance fields
```

They do not control one another. Playback state remains session-only; the selected video, request ID, readiness decision, player instance and playback position are never added to `chat-appearance`.

Rapid playback-route writes are serialized. If a newer save fails, Elara returns to the most recent successfully durable choice rather than pretending the failed choice was saved.

## 8. Search, quota and storage remain unchanged

Search remains:

```text
Gemini youtube.search decision
-> normalize/dedupe
-> cache
-> 8-search page-session guard
-> 24-search device/Pacific-day guard
-> one search.list request per cache miss
-> MediaItem[]
```

Playback/readiness does not spend the search-specific 8/24 guards. Player appearance performs no YouTube request.

YouTube provider metadata must still be valid and younger than 30 days. Elara does not store YouTube video/audio bytes.

## 9. Compliance guardrails

Elara preserves these embedded-player constraints:

- an actual embedded viewport of at least 200×200 pixels;
- native YouTube player controls;
- normal origin/referrer client identity;
- no overlays, frames or visual elements in front of any portion of the embedded player;
- no custom stream/audio extraction;
- no background/hidden playback;
- no autoplay introduced by the Elara shell.

Preset styling remains strictly outside the iframe.

Phase 9 is the final compliance pass and must re-check the current official sources before release closeout; this document is not a substitute for current YouTube policy.

## 10. Verification

Phase-8 tests cover:

- synchronous adapter-load failure containment;
- throwing provider teardown containment;
- repeated start/reset cycles with one global host;
- stale native callback bursts after supersession and reset;
- rapid route-preference writes and durable fallback when the newest write fails;
- provider timeout and cancellation both before and after network start;
- transient readiness failure retry;
- rapid preset writes and stale-binding disposal;
- browser-level offline readiness and exact external fallback;
- one visible iframe surviving live preset changes without recreation;
- a 220px browser viewport preserving a true >=200px provider host;
- corrupted persisted media becoming inert after reload;
- repeated chooser open/Escape cycles restoring focus without duplicate chooser surfaces.

Candidate `b92fd4a4d2608834deae18c85c8226a64a297d28` passed every non-browser gate and 120/121 Playwright tests. Its one browser failure revealed that the bordered outer shell left only 198px of actual provider width at a 220px viewport.

The CSS contract was corrected without weakening the test. Behavioral Phase-8 head `808d9d78dd090a71b8349ba1947aa5ab8042b7af` then passed CI #1707 across docs integrity, lint, TypeScript, all 1,225 unit tests, Worker/Durable Object tests, production build, all 121 Playwright tests and final reliability.

## 11. Developer map

| Concern | Source |
| --- | --- |
| Media identity/freshness | `src/domain/media.ts` |
| Playback lifecycle | `src/domain/playback.ts` |
| Global playback authority | `src/media/playback/PlaybackProvider.tsx` |
| Readiness | `src/media/playback/readiness.ts`, `src/media/youtube/readiness.ts` |
| Single global player | `src/media/playback/PlaybackPlayerHost.tsx` |
| Official iframe adapter | `src/media/youtube/player.ts` |
| Player preset projection | `src/media/playback/surface-preset.ts` |
| Player shell CSS | `src/media/playback/player-host.css` |
| Appearance schema/defaults | `src/domain/preferences.ts` |
| Appearance persistence | `src/persistence/preferences.ts` |
| Appearance settings | `src/app/components/ChatAppearanceSettings.tsx` |
| Card routing + chooser | `src/app/components/media/MediaCard.tsx` |
| Playback route settings | `src/app/components/media/PlaybackPreferenceSettings.tsx` |
| External handoff | `src/media/handoff.ts` |
| Search/cache/budgets | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts` |

Compact engineering authority: [`../media.md`](../media.md).

## 12. Final pass

Phase 9 is **compliance, documentation and final closeout** rather than another feature layer.

It must re-read the current YouTube API Terms, Required Minimum Functionality, IFrame/player documentation, branding, Made-for-Kids and quota guidance; audit the implemented search/card/playback/handoff/privacy/retention/preferences stack against them; remove dead compatibility code through the existing migration path where justified (especially persisted `embedUrl`); reconcile this guide and the canonical architecture document to final runtime truth; and finish only on an exact head that passes the complete repository matrix.

## Official references

- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
