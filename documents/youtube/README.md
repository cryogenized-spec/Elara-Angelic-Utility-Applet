# YouTube Media in Elara

Elara has one YouTube media system: one search path, one validated `MediaItem`, one durable playback route preference, one global `PlaybackProvider`, one readiness path, one official YouTube IFrame Player host, one validated external handoff path, and one Elara-owned presentation shell around the player.

Phase 7 adds **visual presets around that existing iframe**. It does not add another player, route authority, state machine or YouTube control layer.

> Implementation/compliance guide only. Current Google/YouTube policies take priority.

## 1. The three playback routes are unchanged

Shared labels remain:

- **Ask each time**
- **Play here**
- **Open YouTube**

The durable route values remain `ask | embedded | external`. Every route still starts from canonical validation of `provider + kind + id + webUrl`.

Player appearance is independent of route selection. Choosing Minimal, Glass or Cinema cannot select media, start playback, change readiness or alter external handoff.

## 2. Player appearance presets

Appearance settings now expose:

- **Minimal** — a narrower, quieter Elara shell.
- **Glass** — the existing/default shell and the compatibility fallback for old preference rows.
- **Cinema** — a slightly wider, higher-emphasis Elara shell.

The durable value is stored as `mediaPlayerSurfacePreset` inside the **existing `chat-appearance` preference record**. No new database or preference store exists.

Old rows that predate Phase 7 have no field; they normalize to `glass`. Unknown persisted values also normalize to `glass`.

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

The player host remains 16:9, with at least 200px minimum geometry. Elara does not add overlays, pseudo-elements, filters, clipping or custom visual layers over the iframe.

## 4. How the appearance reaches the global player

The globally mounted player lives outside the normal Appearance component tree, so Phase 7 reuses the existing durable appearance authority rather than creating another context.

```text
existing chat-appearance record
-> Dexie liveQuery
-> mediaPlayerSurfacePreset
-> data-elara-media-player-preset on <html>
-> player-host.css outer-shell variables
```

This projection is decoration only. It carries no selected media, request ID, player phase or route decision.

The document root starts safely on `glass`. If reading the appearance record fails, the projection also falls back to `glass`.

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

## 6. Ask / Open YouTube remain unchanged

Ask mode remains a disclosure UI with **Play here** and **Open YouTube**. It does not own player state.

External handoff still reconstructs the exact canonical YouTube URL. Ordinary browsers use canonical HTTPS. Supported Android Chromium-family browsers may attempt the existing **unpinned Android VIEW intent**, preserving the canonical HTTPS URL as fallback. No YouTube package is forced.

If internal playback fails, **Open YouTube instead** still uses the independently validated external route.

## 7. Preference boundaries

There are two separate durable preferences, both using existing authorities:

```text
media-playback record -> ask | embedded | external
chat-appearance record -> mediaPlayerSurfacePreset + existing appearance fields
```

They do not control one another. Playback state remains session-only; the selected video, request ID, readiness decision, player instance and playback position are never added to `chat-appearance`.

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

Current YouTube embedded-player guidance was rechecked for Phase 7. Elara continues to preserve:

- an embedded viewport of at least 200×200 pixels;
- native YouTube player controls;
- normal origin/referrer client identity;
- no overlays, frames or visual elements in front of any portion of the embedded player;
- no custom stream/audio extraction.

Because Phase 7 decorates only the outer Elara shell, preset styling must never migrate into iframe-targeting CSS.

## 10. Verification

Phase-7 tests cover:

- missing/invalid preset normalization to Glass;
- persistence through the existing chat-appearance record;
- live preset projection through Dexie;
- Appearance-setting selection for Minimal / Glass / Cinema;
- CSS guards that prevent preset selectors from decorating the iframe/host;
- absence of overlay pseudo-elements;
- preservation of 200px/16:9 player geometry;
- browser-level switch to Cinema and persistence across reload.

The first candidate `c7e08e450aea0386825808d5b1de0c1996f4dced` reached unit tests after green docs/lint/typecheck; CI #1701 stopped only because the new static CSS test used Vitest's transformed `import.meta.url` as a filesystem URL. The fixture path was corrected without changing runtime code.

Behavioral Phase-7 head `5b1d962ddf76970857977790517dcf7d80fc3035` passed CI #1702 across the complete repository matrix.

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

## 12. Next pass

Phase 8 should be adversarial testing of the existing stack rather than another feature layer: rapid preference/preset changes, repeated start/close cycles, stale callbacks, malformed stored media, provider/network failures, extreme mobile geometry and keyboard/focus races should all continue to resolve through the same authorities.

## Official references

- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
