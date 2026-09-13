# YouTube Search in Elara

This guide explains what happens when you ask Elara for a song, album, music mix, or video, why the feature uses the YouTube Data API, what it costs in API quota, and what Elara does **not** do.

The short version is simple: Elara can search YouTube and show you YouTube results as cards. It does not download, stream, remix, proxy, or secretly play the media. When you tap a card, playback belongs to YouTube or to a compatible app chosen by the operating system.

> This document describes the implementation and the compliance checks made against YouTube's published developer rules. It is not legal advice. Google's and YouTube's current terms and policies always take priority over this guide.

## 1. What happens when you ask for music

A request such as “put on some dark ambient” begins as an ordinary Gemini conversation turn. Elara does not run a YouTube search merely because a message contains the word “music.” Gemini first decides whether the `youtube.search` tool is actually needed.

The normal path is:

```text
You ask for music or a video
        ↓
Gemini understands the request
        ↓
Gemini calls youtube.search when a search is needed
        ↓
Elara validates the tool arguments
        ↓
Duplicate queries are collapsed
        ↓
Elara checks its short-lived local search cache
        ↓
Only a cache miss can spend YouTube search quota
        ↓
The YouTube Data API returns search results
        ↓
Elara preserves the returned title/channel/thumbnail metadata
        ↓
The results become YouTube-attributed cards in the conversation
        ↓
You tap a card and leave Elara for the canonical YouTube destination
```

The `watch` and `listen` intents are presentation hints. They change the card action from **Watch** to **Listen**, but they do not change the YouTube search request and they do not create separate cache entries. Asking to listen to a result and later asking to watch the same search can therefore reuse one API result.

## 2. The request Elara sends to YouTube

Elara uses the YouTube Data API v3 `search.list` endpoint directly from the browser. A normal search request contains:

```text
GET https://www.googleapis.com/youtube/v3/search
part=snippet
type=video
q=<the concise search query>
maxResults=5
safeSearch=strict
```

The API key is sent in the `x-goog-api-key` request header. It is not placed in the URL, search cache, Gemini tool payload, conversation data, or diagnostics.

Elara does **not** follow `nextPageToken`. One user query therefore means at most one `search.list` request. It also does not make a follow-up `videos.list` request just to decorate every search card with a duration. `search.list` does not provide video duration, so Elara simply leaves the duration out rather than inventing one or paying for unnecessary enrichment.

## 3. How Elara protects the daily search allowance

YouTube currently gives a project a default dedicated allowance of **100 `search.list` calls per day**. Each `search.list` request spends one call from that bucket, and additional result pages would spend additional calls. The bucket resets at midnight Pacific Time.

Elara treats those 100 calls as scarce even though the number sounds generous.

The model is instructed to use **one concise search query by default**. A tool call can contain at most **three distinct queries**, and multiple queries are only appropriate when your request genuinely asks for separate searches. The runtime rejects attempts to exceed that hard cap.

A page session can spend at most **eight network searches** before Elara stops and reports that its local search budget is exhausted. Cache hits do not spend that allowance. This means an overeager single Gemini tool call can consume at most 3% of the default daily search bucket, and two such calls can consume at most 6%.

Before any network request, Elara also:

- normalizes and deduplicates equivalent queries;
- checks the local cache first;
- reuses the same cached search for `watch` and `listen` intent;
- avoids pagination completely;
- limits each query to five surfaced results;
- stops when the session search allowance is exhausted.

A successful search result is cached locally for seven days. An empty result is cached for ten minutes so repeatedly asking for the same unavailable query does not hammer the API. The cache stores result metadata only — never video/audio bytes and never an API key.

The provider's own quota remains authoritative. Elara's limits are defensive ceilings for this app instance, not a replacement for Google Cloud quota reporting.

## 4. API key setup and the Lockbox

The YouTube key lives in Elara's local Lockbox as a secondary encrypted credential. The decrypted key is available only while the Lockbox session is unlocked.

Use a YouTube Data API v3 key belonging to the Google Cloud project that operates your installation of Elara. Do not commit the key to this repository, paste it into source code, publish it in screenshots, or share it as a public credential.

For a production deployment, restrict the key in Google Cloud as tightly as the deployment allows, including API restrictions to the YouTube Data API v3 and appropriate website/referrer restrictions for the deployed origin.

The **Test Key** action deliberately uses a small `videos.list?part=id` request rather than `search.list`, so validating the credential does not consume one of the scarce daily YouTube search calls.

Public YouTube video search does not require a user's Google OAuth authorization. Elara therefore does not ask for a YouTube account token merely to perform public searches.

## 5. What is shown on a card

Each result card is explicitly attributed to **YouTube** and uses the title, channel and thumbnail metadata supplied by the API when those values are valid. The adapter does not trim a title for aesthetics, rewrite the channel name, substitute another image, or invent missing thumbnail dimensions.

If required provider data is malformed or outside a defensive safety bound, Elara drops that value or result instead of modifying it into something that looks plausible. If a thumbnail later fails to load, the card keeps its reserved geometry and falls back to a neutral empty thumbnail area; it does not replace the YouTube image with unrelated content.

Cards stack into one column on narrow phone layouts. Wider displays may show several cards in a responsive grid. The cards are links, not embedded players: no YouTube iframe, audio element or video element is created by the media-result component.

## 6. What happens when you tap a result

Both **Watch** and **Listen** preserve the canonical YouTube result URL. Elara no longer rewrites a listen request to a guessed `music.youtube.com` URL.

On ordinary browsers, the card opens the canonical HTTPS YouTube URL. On supported Chromium-family Android browsers, Elara may make an unpinned Android `intent://` attempt from the user's tap so Android can choose among compatible handlers. The exact canonical HTTPS YouTube URL remains the browser fallback. Elara does not pin the intent to one app.

The operating system or browser ultimately decides which installed application handles the link. Elara must not claim that a song is playing, queued, liked, saved, or added to a library merely because it surfaced a result card.

## 7. Storage and privacy boundaries

The dedicated media-search cache keeps successful API metadata for seven days and negative results for ten minutes, both comfortably inside YouTube's general 30-day limit for temporarily stored non-authorized API data.

Search result metadata can also currently be persisted with a conversation message so the card survives a reload. That longer-lived conversation copy is a separate persistence boundary and must not be treated as covered merely because the search cache expires after seven days. Before treating a public production deployment as fully closed on YouTube data-retention policy, the conversation-persistence lifecycle must also enforce refresh or deletion within the applicable YouTube policy window.

Elara does not store YouTube video/audio bytes. The search feature does not download media, build an offline library, proxy streams, strip advertising, or bypass YouTube playback controls.

## 8. Terms, privacy and production compliance

The implementation has been reviewed against YouTube's current developer documentation and policies, including search quota, API-data handling, attribution, and credential rules.

Important production obligations still belong to the operator of the API Client. In particular, YouTube's policies require an API Client to provide appropriate terms/privacy disclosures and accessible links, and to handle stored API data within the allowed retention rules. A repository README is useful documentation, but it is not a substitute for the application's own user-facing privacy policy and consent flow where those rules apply.

Official references:

- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [YouTube Terms of Service](https://www.youtube.com/t/terms)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [YouTube Data API quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- [YouTube Data API `search.list` reference](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines)

## 9. Troubleshooting

**“No YouTube API key is configured.”** Open Settings → Lockbox, unlock the Lockbox, and save a YouTube Data API v3 key.

**“The YouTube API key was rejected.”** Check that the key belongs to the intended Google Cloud project, that the YouTube Data API v3 is enabled, and that key restrictions allow the deployed Elara origin and YouTube Data API.

**“Quota exhausted.”** YouTube's search allowance is provider-side. The default dedicated search bucket resets at midnight Pacific Time. Elara cannot bypass or purchase around that limit.

**“Search budget exhausted.”** Elara's own page-session safety ceiling has stopped more network searches before they can consume more of the provider quota. Cached searches can still be reused.

**A thumbnail is blank.** The search result remains valid. The image may have failed to load or lacked complete dimensions; Elara deliberately does not substitute fabricated provider metadata.

**Tapping Listen opens YouTube rather than a music-specific URL.** That is intentional. Listen is a user-intent label, not permission to rewrite a YouTube search result onto a different provider surface.

## 10. Developer map

For maintainers, the main implementation lives here:

| Concern | Source |
| --- | --- |
| Media domain and hard caps | `src/domain/media.ts` |
| Gemini tool declaration | `src/google/tools/gemini-declarations.ts` |
| Tool registry description | `src/google/tools/registry.ts` |
| Tool argument validation | `src/media/youtube-schema.ts` |
| Tool execution | `src/media/tool-handler.ts` |
| Query normalization and orchestration | `src/media/search.ts` |
| Session search budget | `src/media/budget.ts` |
| IndexedDB search cache | `src/media/cache.ts` |
| YouTube `search.list` adapter | `src/media/youtube/service.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| External handoff | `src/media/handoff.ts` |
| Cards / responsive rail | `src/app/components/media/` |
| Browser proof | `e2e/media-handoff.spec.ts` and `e2e/media-delivery.phase3.spec.ts` |

The canonical low-token system document remains [`../media.md`](../media.md). This README is the human-readable operational guide.
