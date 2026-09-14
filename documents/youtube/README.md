# YouTube Search in Elara

This guide explains how Elara finds YouTube music and video results, how it protects the YouTube search allowance, what is sent back to Gemini, how long YouTube metadata is kept, and what happens when you tap a result.

The short version is simple: **Elara searches YouTube and shows structured result cards. It does not currently stream, download, proxy, remix, or secretly play YouTube media.** A valid card hands the canonical YouTube URL to the browser or operating system.

> This is an implementation and compliance guide, not legal advice. Google's and YouTube's current terms and policies always take priority.

## 1. From your request to a YouTube card

A request such as “put on some dark ambient” begins as an ordinary Gemini turn. Elara does not search merely because the word “music” appears. Gemini decides whether the `youtube.search` tool is actually useful.

```text
You ask for music
       ↓
Gemini decides
       ↓
youtube.search
       ↓
validate + dedupe
       ↓
cache check
       ↓
quota guards
       ↓
YouTube API
       ↓
result cards
```

Gemini is instructed to use **one concise query by default**. One tool call may contain no more than three distinct searches. Equivalent queries are normalized and collapsed before cache or network work.

The `watch` and `listen` intents are presentation hints. They do not change the provider request or cache identity, so asking to listen to a search and later asking to watch the same search can reuse the same provider result.

Media cards are first-class assistant content. A card can appear before Gemini finishes its written continuation, and a completed answer may contain media without prose. Text, media and artifacts share one live assistant projection and one terminal persistence boundary.

## 2. What Elara sends to YouTube

Elara uses the YouTube Data API v3 `search.list` endpoint directly from the browser:

```text
part=snippet
type=video
q=<concise query>
maxResults=5
safeSearch=strict
```

The API key is sent in the `x-goog-api-key` header. It is not placed in the URL, conversation, media card, Gemini result, cache row, or diagnostics.

Elara does not follow `nextPageToken`, so one cache miss produces at most one search request. It also does not spend a `videos.list` request merely to decorate every result with information that `search.list` did not return.

## 3. Search quota protection

YouTube currently documents a default dedicated allowance of **100 `search.list` calls per day**, with the quota day resetting at midnight Pacific Time. Elara treats those calls as scarce.

There are two local safety ceilings:

```text
fresh search
    ↓
8 / page session
    ↓
24 / device
Pacific quota day
    ↓
YouTube
```

The **8-search session ceiling** stops one runaway Gemini tool loop from rapidly consuming the allowance.

The **24-search device/day ceiling** survives page reloads and is shared by tabs on the same browser profile. It is deliberately well below the default 100-call project allowance.

The daily counter lives in the existing `elara-media-cache` IndexedDB database. IndexedDB transactions are authoritative, so two tabs cannot independently reserve the same remaining slot. `BroadcastChannel` is used only as a fast notification mechanism; a missed or stale message cannot grant quota.

If Elara cannot safely read or update the daily ledger, a fresh network search fails closed rather than spending an unaccounted YouTube call. Corrupt same-day counters are treated as exhausted instead of becoming accidental extra allowance.

A cache hit is free. Successful searches are cached for seven days; genuine empty results are cached for ten minutes so repeated unavailable searches do not hammer the API.

These are **local defensive ceilings**, not a replacement for Google Cloud quota reporting. Another device using the same API project is outside this browser's local ledger.

## 4. What Gemini receives

Elara deliberately does not send the full browser card back through the Gemini continuation.

Gemini receives a compact result containing the information needed to reason about the choices:

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

The browser keeps the heavier card-only information:

```text
thumbnail
canonical URL
embed metadata
provider-fetch time
full MediaItem
```

Both views come from the **same tool-result object**. Browser-only fields are non-enumerable, so ordinary JSON serialization cannot accidentally send thumbnails, URLs, timestamps, or the flattened duplicate card collection back to Gemini.

This reduces model-input traffic without creating a second media authority.

## 5. API key and Lockbox

The YouTube API key is a secondary encrypted credential in Elara's local Lockbox. The decrypted value is available only while the Lockbox session is unlocked.

Use a YouTube Data API v3 key belonging to the Google Cloud project that operates your Elara installation. Do not commit it to the repository or paste it into source code.

For a deployed installation, restrict the key as tightly as practical, including an API restriction to YouTube Data API v3 and appropriate website/referrer restrictions.

The **Test Key** action uses a small `videos.list?part=id` request rather than `search.list`, so validating the credential does not consume one of the dedicated search calls.

Public YouTube search does not require a user's Google OAuth authorization.

## 6. Result cards and attribution

Each card visibly says **Source: YouTube** and uses valid title, channel and thumbnail metadata returned by the API.

Elara does not cosmetically rewrite provider titles, invent missing thumbnail dimensions, or replace a failed YouTube thumbnail with unrelated artwork. Invalid provider data is rejected rather than “fixed” into something plausible.

On narrow phone layouts the cards stack into one column. The card rail reserves geometry while its lazy component loads, and failed thumbnails degrade in place instead of collapsing the conversation layout.

The attribution is intentionally plain text. Elara does not draw or approximate a YouTube logo. If an official graphical Brand Feature is added later, it must come from YouTube's approved resources and follow the current branding rules.

## 7. What happens when you tap a card

Both **Watch** and **Listen** currently use the canonical YouTube URL for the selected result. Elara does not guess a `music.youtube.com` URL from an ordinary YouTube Data API result.

Persisted card data is treated as untrusted input. Before a card becomes clickable, Elara reconstructs the allowed destination from the provider, kind and media ID and requires the stored URL to match exactly.

These fail closed:

- `javascript:` and `data:` URLs;
- ordinary HTTP;
- hostile or unexpected HTTPS hosts;
- malformed destinations;
- mismatched video IDs;
- unexpected query parameters or aliases.

An invalid result becomes an inert **Unavailable** card instead of being repaired into a guessed destination.

On ordinary browsers, a valid card opens the canonical HTTPS YouTube URL. On supported Android Chromium-family browsers, Elara may attempt an unpinned Android `intent://` handoff from the user's tap. The same canonical HTTPS URL remains the browser fallback.

Android decides which compatible installed app handles the URL. Elara does not claim that YouTube Music, YouTube, or any other particular application will win that choice.

## 8. Storage and freshness

Elara stores YouTube search metadata locally when needed in the search cache and, for a completed assistant response, in the conversation record. It does not store YouTube video or audio bytes.

Fresh API results carry `apiDataFetchedAt`, recording when the metadata came from YouTube.

Search-cache entries are intentionally much shorter lived than the policy maximum. Persisted YouTube API metadata in conversations is displayable only while valid and younger than **30 days**. Exactly 30 days is treated as expired.

Legacy records without a trustworthy timestamp, future-dated records, malformed records, and stale records fail closed.

Startup maintenance physically sweeps stale/corrupt media from the media cache and conversation database. Conversation reads independently enforce the same freshness rule before returning data to the UI. If a card expires, the surrounding conversation text remains.

## 9. Compliance boundary

The current implementation has been reviewed against YouTube's published developer material for search, quota, API-data handling, credentials, attribution and external handoff.

Elara does not currently:

- download YouTube media;
- create an offline media library;
- proxy or extract streams;
- isolate audio from video;
- strip advertising;
- bypass YouTube controls;
- create a hidden player;
- create an iframe/player from the search-card component.

A public deployment still has operator-level obligations that repository code cannot certify by itself: application privacy/terms treatment, consent where applicable, Google Cloud project/key ownership and restrictions, and any formal YouTube compliance or quota-audit process applicable to that deployed API Client.

Official references:

- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [YouTube Terms of Service](https://www.youtube.com/t/terms)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [YouTube Data API quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- [YouTube Data API `search.list` reference](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines)

## 10. Troubleshooting

**No YouTube API key is configured.** Open Settings → Lockbox, unlock it, and save a YouTube Data API v3 key.

**The YouTube API key was rejected.** Confirm the API is enabled for the intended project and that key restrictions permit the deployed Elara origin.

**YouTube quota is exhausted.** That is provider-side. Elara cannot bypass Google's project allowance.

**Elara's search budget is exhausted.** Either the eight-search page-session ceiling or the 24-search device/Pacific-day ceiling has refused another network search. Cached searches remain usable.

**A thumbnail is blank.** The image failed or provider metadata was incomplete. Elara intentionally does not fabricate replacement provider data.

**An old card disappeared.** Its structured YouTube metadata may have expired or failed canonical validation. The conversation prose should remain.

**Listen opens ordinary YouTube.** Intent changes the action label, not the provider destination. Elara intentionally does not manufacture a YouTube Music URL.

## 11. Developer map

| Concern | Source |
| --- | --- |
| Media domain / freshness / identity | `src/domain/media.ts` |
| Gemini declaration | `src/google/tools/gemini-declarations.ts` |
| Tool argument validation | `src/media/youtube-schema.ts` |
| Tool execution + lean model projection | `src/media/tool-handler.ts` |
| Query orchestration | `src/media/search.ts` |
| Session + daily budget | `src/media/budget.ts` |
| Shared media IndexedDB schema | `src/media/storage.ts` |
| Search cache | `src/media/cache.ts` |
| YouTube adapter | `src/media/youtube/service.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| Safe external handoff | `src/media/handoff.ts` |
| Startup retention | `src/media/retention.ts` |
| Conversation retention | `src/persistence/conversation.ts` |
| Card UI | `src/app/components/media/` |
| Browser acceptance | `e2e/media-efficiency.phase1.spec.ts`, `e2e/media-handoff.spec.ts`, `e2e/media-delivery.phase3.spec.ts`, `e2e/media-lifecycle.acceptance.spec.ts` |

The compact engineering authority is [`../media.md`](../media.md).

Phase-1 behavioral certification passed the complete CI matrix as run #1673 on `f888bb18da2563a32bcc4cfaceab8d0651c2c016`. The documentation commit that contains this guide is certified separately on its own exact head before Phase 2 begins.
