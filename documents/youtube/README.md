# YouTube Search in Elara

This guide explains what happens when you ask Elara for a song, album, music mix, or video, why the feature uses the YouTube Data API, what it costs in API quota, how long search metadata is kept, and what Elara does **not** do.

The short version is simple: Elara can search YouTube and show YouTube results as cards. It does not download, stream, remix, proxy, or secretly play the media. When you tap a valid card, playback belongs to YouTube or to a compatible app chosen by the operating system.

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
Elara timestamps and preserves valid returned metadata
        ↓
The results become YouTube-attributed cards
        ↓
You tap a validated card and leave Elara for YouTube
```

The `watch` and `listen` intents are presentation hints. They change the card action from **Watch** to **Listen**, but they do not change the YouTube search request, provider URL, or cache identity. Asking to listen to a result and later asking to watch the same search can therefore reuse one API result.

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

Elara does **not** follow `nextPageToken`. One query therefore means at most one `search.list` request. It also does not make a follow-up `videos.list` request merely to decorate every search card with a duration. `search.list` does not provide video duration, so Elara leaves it out instead of inventing one or spending unnecessary quota.

## 3. How Elara protects the daily search allowance

YouTube currently gives a project a default dedicated allowance of **100 `search.list` calls per day**. Each `search.list` request spends one call from that bucket, and additional result pages would spend additional calls. The bucket resets at midnight Pacific Time.

Elara treats those calls as scarce. Gemini is instructed to use **one concise search query by default**. One tool invocation can contain at most **three distinct queries**, and multiple queries are only appropriate when your request genuinely asks for separate searches. The runtime rejects attempts to exceed that cap.

A page session can spend at most **eight network searches** before Elara stops and reports that its local search budget is exhausted. Cache hits do not spend that allowance. An overeager maximum-sized Gemini call can therefore consume at most 3% of the default daily search bucket, and two such calls at most 6%.

Before any network request, Elara also normalizes and deduplicates equivalent queries, checks the local cache, reuses the same cached search for `watch` and `listen`, avoids pagination, limits each query to five surfaced results, and stops when the session allowance is exhausted.

A successful search result is cached locally for seven days. An empty result is cached for ten minutes so repeatedly asking for the same unavailable query does not hammer the API. The cache stores result metadata only — never video/audio bytes and never an API key.

The provider's own quota remains authoritative. Elara's limits are defensive ceilings for this installation, not a replacement for Google Cloud quota reporting.

## 4. API key setup and the Lockbox

The YouTube key lives in Elara's local Lockbox as a secondary encrypted credential. The decrypted key is available only while the Lockbox session is unlocked.

Use a YouTube Data API v3 key belonging to the Google Cloud project that operates your installation of Elara. Do not commit the key to this repository, paste it into source code, publish it in screenshots, or share it as a public credential.

For a production deployment, restrict the key in Google Cloud as tightly as the deployment allows, including API restrictions to the YouTube Data API v3 and appropriate website/referrer restrictions for the deployed origin.

The **Test Key** action deliberately uses a small `videos.list?part=id` request rather than `search.list`, so validating the credential does not consume one of the dedicated daily search calls.

Public YouTube video search does not require a user's Google OAuth authorization. Elara therefore does not ask for a YouTube account token merely to perform public searches.

## 5. What is shown on a card

Each result card visibly identifies **YouTube** as its source and uses title, channel and thumbnail metadata supplied by the API when those values are valid. Elara does not trim a title for aesthetics, rewrite a channel name, substitute another image, or invent missing thumbnail dimensions.

Unexpected fields are not accepted as trusted media metadata. This matters for security as well as correctness: a corrupted IndexedDB row cannot smuggle an API key or unrelated private field into a `MediaItem` simply because the normal fields also look valid.

If required provider data is malformed or outside defensive bounds, Elara rejects it instead of modifying it into something plausible. If a thumbnail later fails to load, the card keeps its reserved geometry and falls back to a neutral empty thumbnail area; it does not replace the YouTube image with unrelated content.

Cards stack into one column on narrow phone layouts. Wider displays may show several cards in a responsive grid. The cards are links, not embedded players: no YouTube iframe, audio element or video element is created by the media-result component.

## 6. What happens when you tap a result

Both **Watch** and **Listen** use the exact canonical YouTube URL Elara constructed for that provider result. Elara does not rewrite a listen request to a guessed `music.youtube.com` URL.

Persisted media is treated as untrusted input. Before a card becomes clickable, Elara reconstructs the only URL allowed for its YouTube `provider + kind + id` and requires the stored `webUrl` to match exactly. A `javascript:` URL, `data:` URL, ordinary HTTP URL, hostile HTTPS host, malformed URL, mismatched video ID, non-canonical host alias, or unexpected extra query string therefore fails closed. The user sees an **Unavailable** result with no `href` rather than a repaired or guessed destination.

On ordinary browsers, a valid card opens the canonical HTTPS YouTube URL. On supported Chromium-family Android browsers, Elara may make an unpinned Android `intent://` attempt from the user's tap so Android can choose among compatible handlers. The exact same HTTPS YouTube URL remains the browser fallback. Elara does not pin the intent to one app.

The operating system or browser ultimately decides which installed application handles the link. Elara must not claim that a song is playing, queued, liked, saved, or added to a library merely because it surfaced a result card.

## 7. Storage, retention and privacy

YouTube search metadata is stored locally on the device in two places when needed: the dedicated search cache and, when a card belongs to a saved assistant response, that conversation message. Elara does not send this local cache to an Elara server and does not store YouTube video/audio bytes.

Every fresh API result is stamped with `apiDataFetchedAt`, the time that metadata came from YouTube. Successful search-cache rows expire after seven days and negative rows after ten minutes. Conversation media has a separate hard freshness boundary: applicable YouTube API metadata is no longer displayable once it reaches **30 days** from its provider-fetch timestamp. Exactly 30 days is treated as expired.

Old records created before this timestamp existed are treated as untrusted rather than being granted a fresh 30-day period. Future-dated, malformed and structurally corrupted records also fail closed.

At application startup Elara physically sweeps the media cache and conversation database for stale or corrupt media. Conversation reads independently apply the same check before returning anything to the UI. If media expires, Elara removes only the structured YouTube card metadata: the user's message, the assistant's written answer, and the conversation itself remain intact. Retention cleanup also does not pretend the conversation was newly edited by changing its thread timestamp.

This defense-in-depth arrangement means an IndexedDB cleanup write could fail without making stale data displayable: the read path still withholds it.

Elara does not build an offline media library, proxy streams, strip advertising, bypass YouTube playback controls, or retain an API key inside media records.

## 8. Terms, privacy and production compliance

Settings → Lockbox includes direct links to this guide, the **YouTube Terms of Service**, and the **Google Privacy Policy**. This guide explains the search request, quota use, local caching, conversation persistence, retention, external handoff, and credential boundary in human-readable form.

The implementation has been reviewed against YouTube's current developer documentation and policies, including API-data handling, attribution, search quota, and credential rules. The visible card uses the unmodified `YouTube` trade name as source attribution. Elara deliberately does not draw, recolour, distort or imitate a YouTube logo. If an official logo asset is added later, it must come from YouTube's approved branding resources and follow the then-current branding rules.

A public deployment still needs whatever operator-level terms/privacy policy, consent treatment, Google Cloud credential ownership/restrictions, and formal YouTube compliance/audit process apply to that deployed API Client. Repository code cannot certify those facts about an operator's deployment by itself.

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

**“Quota exhausted.”** YouTube's search allowance is provider-side. The default dedicated search bucket resets at midnight Pacific Time. Elara cannot bypass that limit.

**“Search budget exhausted.”** Elara's page-session safety ceiling has stopped further network searches. Cached searches can still be reused.

**A thumbnail is blank.** The image may have failed to load or lacked complete dimensions. Elara deliberately does not substitute fabricated provider metadata.

**A historical card says Unavailable or disappears after a later reload.** The stored destination may have failed canonical validation, or its API metadata may have crossed the retention boundary. The surrounding conversation text should remain.

**Tapping Listen opens YouTube rather than a music-specific URL.** That is intentional. Listen is a user-intent label, not permission to rewrite a YouTube result onto another surface.

## 10. Developer map

| Concern | Source |
| --- | --- |
| Media domain, hard caps and freshness | `src/domain/media.ts` |
| Gemini tool declaration | `src/google/tools/gemini-declarations.ts` |
| Tool registry description | `src/google/tools/registry.ts` |
| Tool argument validation | `src/media/youtube-schema.ts` |
| Tool execution | `src/media/tool-handler.ts` |
| Query orchestration | `src/media/search.ts` |
| Session search budget | `src/media/budget.ts` |
| IndexedDB search cache | `src/media/cache.ts` |
| Startup retention coordinator | `src/media/retention.ts` |
| Conversation retention cleanup | `src/persistence/conversation.ts` |
| YouTube `search.list` adapter | `src/media/youtube/service.ts` |
| Key validation | `src/media/youtube/validate.ts` |
| Safe external handoff | `src/media/handoff.ts` |
| Cards / responsive rail | `src/app/components/media/` |
| Browser proof | `e2e/media-handoff.spec.ts` and `e2e/media-delivery.phase3.spec.ts` |

The canonical low-token system document remains [`../media.md`](../media.md). This README is the human-readable operational guide.
