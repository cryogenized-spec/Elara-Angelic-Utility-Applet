# YouTube Media in Elara

Elara has one YouTube media system: one search path, one validated `MediaItem`, one durable playback preference, one global `PlaybackProvider`, one readiness path, one official YouTube IFrame Player host, and one validated external handoff path.

Phase 6 unifies the user-facing behavior of the existing `ask | embedded | external` routes. It does **not** add another player, route authority or state machine.

> Implementation/compliance guide only. Current Google/YouTube policies take priority.

## 1. The three routes

Shared labels come from `src/media/playback/presentation.ts`:

- **Ask each time**
- **Play here**
- **Open YouTube**

The durable values remain `ask | embedded | external`.

Every route starts from the same canonical validation of `provider + kind + id + webUrl`. Invalid or hostile persisted cards remain inert.

## 2. Preference loading and saving

`PlaybackProvider` remains the only preference authority.

It distinguishes initial loading from a write in progress:

```text
loading -> stored preference has not resolved yet
saving  -> new preference is being written; old durable route stays active
ready   -> durable preference is confirmed
failed  -> provider retains the safe durable value and reports the error
```

The provider initializes to Ask, so initial loading is safe without the card inventing a second fallback rule.

When a user changes the setting, cards **continue using the last durable route until the save succeeds**. A failed save does not make cards temporarily switch to Ask; the previous saved choice remains active.

Settings and cards consume the same presentation vocabulary and the same provider state.

## 3. Ask each time

Ask mode is only a disclosure UI. The card itself does not own playback state.

```text
card -> chooser
       |- Play here    -> PlaybackProvider.start(item)
       `- Open YouTube -> validated external handoff
```

Accessibility behavior:

- every mounted card gets a unique chooser id for `aria-controls`;
- Escape closes an open chooser;
- focus returns to the card's primary control after Escape;
- chooser/fallback controls have explicit keyboard focus styling.

If that same item is already checking/loading/ready/paused/playing/ended internally, Ask mode still opens. **Play here** is disabled to prevent a duplicate internal request, but **Open YouTube** remains available as an escape route.

## 4. Play here

Internal playback still uses the single existing path:

```text
PlaybackProvider.start(item)
-> prepare(item)
-> canonical identity check
-> YouTube videos.list readiness
-> existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
```

`prepare()` remains readiness-only. No card creates an iframe or player instance.

Made-for-Kids, unavailable and non-embeddable videos remain blocked before the player adapter. Persisted `embedUrl` remains non-authoritative.

The official player keeps native YouTube controls, no autoplay, inline playback and normal origin/referrer identity. The global **Close player** control sits outside the iframe and calls existing `reset()`.

## 5. Open YouTube

External handoff is one route alongside internal playback; it does not own internal player state.

The external authority reconstructs the exact canonical YouTube URL and requires persisted `webUrl` to match it.

On ordinary browsers Elara uses that canonical HTTPS URL. On supported Android Chromium-family browsers it may attempt an **unpinned Android VIEW intent** from the user gesture. The intent:

- does not specify a YouTube package;
- keeps `android.intent.action.VIEW`;
- keeps the browsable category;
- carries the exact canonical HTTPS URL as browser fallback.

This behavior is unchanged by Phase 6.

## 6. Failure fallback

If internal playback fails, the card may expose **Open YouTube instead**. That action uses the independently validated external route; it does not trust the failed iframe target or stored `embedUrl`.

Ask mode also keeps Open YouTube available while the same item is already playing internally.

## 7. Search, quota and storage remain unchanged

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

Playback/readiness does not spend the search-specific 8/24 guards.

Only the playback preference is durable. Chooser disclosure, selected media, request ID, readiness result, active player and playback position remain session-only.

YouTube provider metadata must still be valid and younger than 30 days. Elara does not store YouTube video/audio bytes.

## 8. What Phase 6 does not add

- no second playback reducer/store/queue/event bus;
- no second route preference authority;
- no card-level iframe/player;
- no custom transport controls;
- no iframe overlay;
- no autoplay;
- no stream extraction or audio isolation;
- no background/hidden playback;
- no offline media library;
- no package-pinned Android launch;
- no authority for persisted `embedUrl`.

## 9. Developer map

| Concern | Source |
| --- | --- |
| Media identity/freshness | `src/domain/media.ts` |
| Playback lifecycle | `src/domain/playback.ts` |
| Global authority / preference status / `prepare` / `start` | `src/media/playback/PlaybackProvider.tsx` |
| Shared route labels/descriptions | `src/media/playback/presentation.ts` |
| Readiness | `src/media/playback/readiness.ts`, `src/media/youtube/readiness.ts` |
| Single global player | `src/media/playback/PlaybackPlayerHost.tsx` |
| Official iframe adapter | `src/media/youtube/player.ts` |
| Card routing + chooser | `src/app/components/media/MediaCard.tsx` |
| Playback settings UI | `src/app/components/media/PlaybackPreferenceSettings.tsx` |
| Preference persistence | `src/persistence/preferences.ts` |
| External handoff | `src/media/handoff.ts` |
| Search/cache/budgets | `src/media/search.ts`, `src/media/cache.ts`, `src/media/budget.ts` |

Behavioral Phase-6 head `e1b7ede3fd9c7308edd89d9a44ed1c26cb5afa7d` passed CI #1698 across the complete repository matrix.

Compact engineering authority: [`../media.md`](../media.md).

## Official references

- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
