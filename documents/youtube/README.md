# YouTube Media in Elara

This guide explains how Elara finds YouTube music/video results, protects search allowance, sends compact results back to Gemini, validates safe external destinations, and now performs a narrow playback-readiness check for the future internal player.

The short version: **search cards still open YouTube externally today.** Elara now also has one global playback authority and a readiness boundary that can verify a selected video before a later internal-player phase, but there is still no YouTube iframe/player, stream extraction, hidden/background playback or card-level mini-player.

> This is an implementation/compliance guide, not legal advice. Current Google/YouTube terms and policies take priority.

## 1. From a request to a YouTube card

A request such as “put on some dark ambient” begins as an ordinary Gemini turn. Gemini decides whether `youtube.search` is useful.

```text
You ask for music
       ↓
Gemini decides
       ↓
youtube.search
       ↓
validate + dedupe
       ↓
cache
       ↓
search quota guards
       ↓
YouTube search.list
       ↓
result cards
```

Gemini is instructed to use one concise query by default. One tool call may contain at most three distinct searches. Equivalent queries collapse before cache/network work.

`watch` and `listen` are presentation hints. They do not change the provider request/cache identity, so the same search can be reused across intents.

Cards are first-class assistant content. They can appear before Gemini finishes prose, and a completed response can contain media without prose. Text, media and artifacts share one live assistant projection and one terminal persistence boundary.

## 2. What search sends to YouTube

Elara uses YouTube Data API v3 `search.list` directly from the browser:

```text
part=snippet
type=video
q=<concise query>
maxResults=5
safeSearch=strict
```

The API key is sent in `x-goog-api-key`, never in the URL, conversation, media card, Gemini result, cache row or diagnostics.

Elara never follows `nextPageToken`, so one cache miss produces at most one search request. It does not call `videos.list` to decorate every search result.

## 3. Search quota protection

Two local guards protect real `search.list` requests:

```text
fresh search
    ↓
8 / page session
    ↓
24 / device
Pacific quota day
    ↓
YouTube search.list
```

The eight-search page-session ceiling limits runaway tool loops. The 24-search device/day ceiling survives reloads and coordinates tabs in the same browser profile.

The daily counter is part of the existing `elara-media-cache` IndexedDB authority. Transactions serialize reservations; `BroadcastChannel` is advisory only. If Elara cannot safely account for a fresh search, the search fails closed. Cache hits spend neither local guard.

Successful searches are cached seven days; genuine empty results ten minutes. These are local defensive ceilings, not substitutes for Google Cloud project quota.

## 4. What Gemini receives

Gemini receives only the compact fields needed to reason about choices:

```text
provider
intent
query
id
kind
title
channel
bounded failures
```

The browser retains heavier card data such as thumbnails, canonical URLs, compatibility embed metadata, provider-fetch time and the full `MediaItem`.

Both views come from one tool-result object. Browser-only fields are non-enumerable so normal JSON serialization cannot accidentally send them back through the Gemini continuation.

## 5. API key and Lockbox

The YouTube API key is a named secondary credential inside Elara's existing encrypted Lockbox. The decrypted value is available only through the Lockbox session and named accessor; there is no general media secret store.

Use a YouTube Data API v3 key belonging to the deployment's intended Google Cloud project and restrict it as tightly as practical. Do not commit it or paste it into source.

The Settings **Test Key** action uses a small `videos.list?part=id` request rather than `search.list`, so testing the credential does not spend a dedicated search call.

Public YouTube search/readiness does not require a user's Google OAuth authorization.

## 6. Result cards and attribution

Each card visibly says **Source: YouTube** and presents valid title/channel/thumbnail metadata from the API. Provider titles are not cosmetically rewritten, missing dimensions are not invented, and failed thumbnails degrade without unrelated replacement artwork.

On narrow phone layouts cards stack into one column. Lazy-card geometry is reserved so image/component delivery does not unexpectedly collapse the conversation layout.

The attribution remains literal text. Elara does not draw or approximate a YouTube logo. Any later graphical Brand Feature must use YouTube-approved resources/rules.

## 7. What happens when you tap a card today

Both **Watch** and **Listen** still use the canonical ordinary YouTube URL. Elara does not manufacture a `music.youtube.com` URL from an ordinary Data API result.

Persisted card data is untrusted. Before a card becomes clickable, Elara reconstructs the allowed destination from provider + kind + media ID and requires stored `webUrl` to match exactly.

These fail closed: hostile schemes/hosts, HTTP, malformed URLs, mismatched IDs, aliases and unexpected query parameters. An invalid result becomes an inert **Unavailable** card rather than being repaired into a guess.

Ordinary browsers open the canonical HTTPS destination. Supported Android Chromium-family flows may attempt an unpinned `intent://` handoff from the user tap, carrying that same HTTPS URL as fallback. Android decides which installed application handles it.

Phase 3 does **not** change card click behavior. Internal readiness is an application seam for the upcoming chooser/player phase, not a second card implementation.

## 8. The playback authority now present

Elara mounts exactly one global `PlaybackProvider`. It owns the one playback lifecycle and the user's playback preference:

```text
preference: ask | embedded | external

idle
 ↓
requested
 ↓
checking
 ↓
ready
 ↓
loading
 ↓
playing ↔ paused
 ↓
ended

active state → failed
```

Only the preference is persisted in the existing preferences database. Selected track, request ID, readiness result, playback phase/position and failures are session-only.

Every accepted selection receives one request ID. A newer valid selection supersedes the previous request. Late readiness/player callbacks from the older request cannot alter the newer state. Reset/unmount clears active session state.

There is no second media state machine, playback database, queue or event bus.

## 9. Playback readiness

When the existing playback authority is explicitly asked to prepare a fresh YouTube video for future internal playback, it enters `checking` and calls one provider-neutral readiness port. That port first applies the same canonical identity trust boundary used by external handoff.

Only then is the YouTube-specific module loaded. It sends:

```text
GET youtube/v3/videos
part=id,status
id=<exact video id>
maxResults=1
x-goog-api-key: <Lockbox key>
```

This `videos.list` call is separate from `search.list` and does not consume or mutate Elara's 8-session/24-device search guards.

The response must contain the exact requested video ID and explicit boolean values for `status.embeddable` and `status.madeForKids`.

```text
exists + embeddable + not MFK -> internally ready
missing video                  -> internal playback blocked
embeddable=false               -> internal playback blocked
madeForKids=true               -> internal playback blocked for now
missing/invalid status         -> readiness failure
network/key/quota failure      -> readiness failure
cancelled request              -> aborted, no late state mutation
```

YouTube notes that `embeddable=true` still does not guarantee a future iframe will actually play: platform rules/content claims can reject playback later. Therefore Phase 3 means **eligible to attempt internal playback**, not guaranteed playback.

Made-for-Kids content remains external-only in this phase. YouTube requires special handling for an embedded MFK player, so Elara will not elect that content internally ready until the later player phase explicitly implements and tests the required behavior.

Ready/blocked decisions may be memoized only in memory for the current browser session. They are not written to IndexedDB or conversations. Transient failures/cancellation are not cached.

## 10. `embedUrl` is not trusted

Older/current `MediaItem` rows still contain an `embedUrl` compatibility field from the search adapter. The new readiness path deliberately ignores it.

Internal authority is:

```text
provider
+
validated video ID
+
canonical stored web identity check
```

A malicious but syntactically HTTPS persisted `embedUrl` therefore has no route into readiness or the future player. Player URLs will be derived at the player boundary rather than read from persisted media data.

## 11. Storage and freshness

Elara stores YouTube search metadata locally in the search cache and, for completed assistant responses, conversation records. It does not store video/audio bytes.

Fresh provider results carry `apiDataFetchedAt`. Persisted YouTube API metadata is displayable only while valid and younger than 30 days; exactly 30 days is expired. Legacy undated, future-dated, malformed and stale rows fail closed.

Startup maintenance physically sweeps stale/corrupt media from media cache/conversation storage, while conversation reads independently enforce the same freshness boundary.

Playback preference uses the existing preferences database. Playback/readiness state is not persisted. The readiness memoization is session memory only.

## 12. Compliance boundary

Current implementation has been reviewed against YouTube material relevant to search, API-data handling, credentials, attribution, MFK status, embeddability and external handoff.

Elara still does not:

- download YouTube media;
- create an offline media library;
- proxy/extract streams;
- isolate audio from video;
- strip advertising;
- bypass YouTube controls;
- create a hidden/background player;
- create an iframe/player from media cards;
- load the YouTube IFrame Player API;
- persist active playback/readiness state.

A public deployment still has operator-level privacy/terms/consent, Google Cloud ownership/restriction and applicable YouTube audit/compliance obligations that repository code cannot certify alone.

Official references:

- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [YouTube Terms of Service](https://www.youtube.com/t/terms)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [YouTube Data API quota/compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Video resource/status fields](https://developers.google.com/youtube/v3/docs/videos)
- [Finding Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
- [YouTube branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines)

## 13. Troubleshooting

**No YouTube API key is configured / readiness says key unavailable.** Unlock the Lockbox and confirm a YouTube Data API v3 key is stored.

**The YouTube API key was rejected.** Confirm YouTube Data API v3 is enabled and key restrictions permit the deployed Elara origin.

**YouTube quota is exhausted.** That is provider/project-side; Elara cannot bypass it.

**Elara's search budget is exhausted.** The eight-search page-session or 24-search device/Pacific-day guard refused another `search.list` request. Cached searches still work; this is distinct from playback-readiness checking.

**Internal readiness says unavailable/not embeddable/Made for Kids.** The result card itself is not destroyed. The normal external YouTube handoff remains independently validated.

**A thumbnail is blank.** Provider image delivery failed or metadata was incomplete; Elara intentionally does not fabricate replacement provider data.

**An old card disappeared.** Its structured YouTube metadata may have expired or failed canonical validation; surrounding conversation prose should remain.

**Listen opens ordinary YouTube.** Intent changes the label, not provider destination. Elara does not invent a YouTube Music URL.

## 14. Developer map

| Concern | Source |
| --- | --- |
| Media domain / freshness / identity | `src/domain/media.ts` |
| Playback domain / lifecycle | `src/domain/playback.ts` |
| Global playback authority | `src/media/playback/PlaybackProvider.tsx` |
| Readiness port | `src/media/playback/readiness.ts` |
| YouTube readiness adapter | `src/media/youtube/readiness.ts` |
| Gemini declaration | `src/google/tools/gemini-declarations.ts` |
| Tool execution + lean model projection | `src/media/tool-handler.ts` |
| Query orchestration | `src/media/search.ts` |
| Session + daily search budget | `src/media/budget.ts` |
| Shared search IndexedDB schema | `src/media/storage.ts` |
| Search cache | `src/media/cache.ts` |
| YouTube search adapter | `src/media/youtube/service.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| Safe external handoff | `src/media/handoff.ts` |
| Playback preference | `src/persistence/preferences.ts` |
| Startup/conversation retention | `src/media/retention.ts`, `src/persistence/conversation.ts` |
| Card UI | `src/app/components/media/` |
| Playback/readiness tests | `src/media/playback/*.test.ts*`, `src/media/youtube/readiness.test.ts` |
| Browser acceptance | `e2e/media-efficiency.phase1.spec.ts`, `e2e/media-handoff.spec.ts`, `e2e/media-delivery.phase3.spec.ts`, `e2e/media-lifecycle.acceptance.spec.ts` |

The compact engineering authority is [`../media.md`](../media.md).

Phase-3 behavioral certification candidate is `6ec51b582713bbc65e50590706984f48f663e1da`; the final documentation head is certified separately before this phase is closed.
