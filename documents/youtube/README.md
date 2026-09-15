# YouTube Media in Elara

Elara has one YouTube media system: one search path, one validated `MediaItem`, one durable playback preference, one global `PlaybackProvider`, one readiness path, one official YouTube IFrame Player host, and one validated external handoff path.

Phase 5 makes the routing user-facing. A card now follows the saved `ask | embedded | external` preference without creating a second player/controller.

> Implementation/compliance guide only. Current Google/YouTube policies take priority.

## 1. Search remains unchanged

```text
request
-> Gemini decides whether youtube.search is useful
-> normalize/dedupe
-> cache
-> 8-search page-session guard
-> 24-search device/Pacific-day guard
-> YouTube search.list
-> MediaItem[] + lean Gemini projection
-> MediaCard
```

One cache miss creates at most one `search.list` request, with no pagination. `watch` and `listen` are presentation intent, not different provider identities or caches.

## 2. Card routing

Every route starts by validating the persisted card against the canonical destination derived from `provider + kind + id`. Invalid or hostile persisted destinations are inert.

The saved preference is:

```text
ask      -> card opens a chooser
embedded -> card starts internal playback
external -> card opens YouTube externally
```

If preference loading is not ready, the card fails safe to `ask` rather than silently choosing a destination.

### Ask each time

The card exposes exactly two choices:

- **Play here** → existing `PlaybackProvider.start(item)` path.
- **Open YouTube** → existing validated external handoff path.

The open/closed chooser is local UI disclosure state only. It does not own readiness, player state, errors or request lineage.

### Play here

Internal playback calls the same singular path already certified before Phase 5:

```text
PlaybackProvider.start(item)
-> prepare(item)
-> canonical identity check
-> YouTube videos.list readiness
-> existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
```

The card reads checking/loading/playing/paused/ended/failed status from `PlaybackProvider.state`. It does not duplicate that state.

### Open YouTube

External routing retains the canonical ordinary YouTube URL. On ordinary browsers it opens HTTPS normally. On supported Android Chromium-family flows Elara may attempt the existing **unpinned** Android VIEW intent, with the exact same canonical HTTPS destination retained as fallback. No YouTube package is forced.

## 3. Reversible preference

Chat settings expose all three existing durable values:

- Ask each time
- Play here
- Open YouTube

They persist through the existing playback preference authority. No new settings store was added.

Only the preference is durable. The selected item, chooser state, request ID, readiness result, playback phase/position and player instance remain session-only.

## 4. Readiness still gates internal playback

`prepare(item)` remains readiness-only and creates no iframe. It calls YouTube `videos.list` with exact video ID and `part=id,status`.

```text
exists + embeddable + !MFK -> ready
missing                      -> blocked/unavailable
embeddable=false             -> blocked/not-embeddable
madeForKids=true             -> blocked/made-for-kids
invalid/provider failure     -> failed
cancelled                    -> aborted
```

Made-for-Kids remains external-only. Readiness calls do not spend the search-specific 8/24 guards.

## 5. Internal playback

There is exactly one global player host. It uses the official YouTube IFrame Player API with native controls, no autoplay, inline playback, and normal origin/referrer identity.

Persisted `embedUrl` is not player authority. The player target is derived from validated provider identity and video ID.

The player surface is visible inside Elara's fixed viewport and has one **Close player** action outside the iframe. Close calls the existing `reset()` authority. Elara adds no custom play/pause/seek controls and no overlay over YouTube controls.

A newer accepted media request, reset or provider unmount tears down obsolete work. Late callbacks keep their old request ID and cannot mutate a newer selection.

## 6. Failures and fallback

If internal playback fails, the card may show **Open YouTube instead**. That fallback does not reuse a failed iframe target or invent a URL; it uses the same independently validated external handoff authority.

Hostile/non-canonical `webUrl` values fail before either route. Hostile `embedUrl` values are ignored by readiness/player construction.

## 7. Storage and retention

Elara does not store YouTube video/audio bytes. Search metadata may exist in the media cache and completed conversation records.

Provider metadata must be valid and younger than 30 days. Exactly 30 days is expired; malformed, future-dated and undated legacy media fail closed.

Active playback is never persisted.

## 8. What Phase 5 does not add

- no second playback reducer/store/queue/event bus;
- no card-level iframe/player;
- no custom transport controls;
- no autoplay;
- no stream extraction or audio isolation;
- no background/hidden playback;
- no offline media library;
- no package-pinned Android YouTube launch;
- no authority for persisted `embedUrl`.

## 9. Developer map

| Concern | Source |
| --- | --- |
| Media identity/freshness | `src/domain/media.ts` |
| Playback lifecycle | `src/domain/playback.ts` |
| Global authority / `prepare` / `start` | `src/media/playback/PlaybackProvider.tsx` |
| Readiness port | `src/media/playback/readiness.ts` |
| YouTube readiness | `src/media/youtube/readiness.ts` |
| Player port | `src/media/playback/player.ts` |
| Single global player | `src/media/playback/PlaybackPlayerHost.tsx` |
| Official iframe adapter | `src/media/youtube/player.ts` |
| Card routing | `src/app/components/media/MediaCard.tsx` |
| Playback settings UI | `src/app/components/SettingsScreen.tsx` |
| Playback preference persistence | `src/persistence/preferences.ts` |
| External handoff | `src/media/handoff.ts` |
| Search/cache/budgets | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts` |

Behavioral Phase-5 head `0369919202f79eba1cff69ea9148d86129023d81` passed CI #1696 across the complete repository matrix.

Compact engineering authority: [`../media.md`](../media.md).

## 10. Next pass

The next pass should refine the **same** routing UX rather than invent another path: terminology consistency across settings/card/fallback, accessibility and chooser behavior, and preserving the current unpinned Android handoff semantics.

## Official references

- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
