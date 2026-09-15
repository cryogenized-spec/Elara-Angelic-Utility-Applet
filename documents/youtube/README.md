# YouTube Media in Elara

Elara has one YouTube media system: one search path, one validated `MediaItem`, one durable playback-route preference, one global `PlaybackProvider`, one readiness path, one official YouTube IFrame Player host, one validated external handoff path, and one Elara-owned presentation shell around the player.

The nine-phase playback roadmap is complete. Phase 9 adds compliance closure, policy consent and compatibility cleanup without creating a second player, route authority, state machine or persistence path.

> Implementation/compliance guide only. Current Google/YouTube policies take priority.

## 1. Playback routes

Shared labels remain:

- **Ask each time**
- **Play here**
- **Open YouTube**

The durable route values remain `ask | embedded | external`. Every route starts from canonical validation of `provider + kind + id + webUrl`.

## 2. Policy consent

YouTube API network features remain disabled until the current Elara YouTube privacy/terms notice is explicitly accepted in Settings → Lockbox.

Acceptance is versioned durable state in the existing preferences database. It is separate from the encrypted YouTube API credential and does not unlock or rewrite that credential.

The consent surface links to:

- the local **Elara Privacy Notice**;
- the local **Elara Terms of Use**;
- the official YouTube Terms of Service;
- the Google Privacy Policy.

A future material change to YouTube data access, collection, storage, use or sharing must increment the consent version before the changed functionality can be enabled.

## 3. Search, quota and storage

Search remains:

```text
Gemini youtube.search decision
-> current policy accepted?
-> normalize/dedupe
-> cache
-> 8-search page-session guard
-> 24-search device/Pacific-day guard
-> one search.list request per cache miss
-> MediaItem[]
```

Playback/readiness does not spend the search-specific 8/24 guards. YouTube provider metadata must be refreshed or removed before 30 calendar days. Elara does not store YouTube video/audio bytes.

The YouTube API key is supplied by the user and stored encrypted in the local Lockbox. When unlocked, the browser sends it directly to Google/YouTube in the request header; Elara does not intentionally put it in URLs, chat content, analytics or logs.

## 4. Trusted media contract and migration

`MediaItem` keeps the canonical external `webUrl`. Internal playback reconstructs the player target from provider/kind/id instead of trusting a persisted embed destination.

The old `embedUrl` field is fully retired from the domain/provider contract. Legacy conversation and media-cache rows are migrated by stripping only that field and then passing through the normal strict validator. A malformed legacy row does not become trusted merely because it was migrated.

A corrupted/non-canonical persisted `webUrl` remains inert after reload; it cannot become either an internal player target or an external link.

## 5. Play here

Internal playback remains:

```text
PlaybackProvider.start(item)
-> prepare(item)
-> current policy accepted?
-> canonical identity check
-> YouTube videos.list readiness
-> existing begin-load event
-> one global PlaybackPlayerHost
-> official YouTube IFrame Player
```

Made-for-Kids, unavailable and non-embeddable videos are blocked before the player adapter. The official player keeps native YouTube controls, `autoplay=0`, inline playback and the existing origin/referrer identity. **Close player** is an Elara control outside the iframe and calls existing `reset()`.

Cancellation during asynchronous Lockbox credential lookup stops before stale provider work can begin. Cancellation after provider work starts propagates into that request. Transient readiness failures are not cached. Synchronous adapter failure becomes the existing failed phase, teardown exceptions are contained, and stale callbacks cannot mutate a newer request.

## 6. Ask and Open YouTube

Ask mode is disclosure-only UI between **Play here** and **Open YouTube**. It owns no playback state.

External handoff reconstructs the exact canonical YouTube URL. Ordinary browsers use canonical HTTPS. Supported Android Chromium-family browsers may attempt the existing **unpinned Android VIEW intent**, preserving the same canonical HTTPS URL as fallback. No YouTube package is forced.

If internal playback fails, **Open YouTube instead** remains independently available through the validated external path.

## 7. Attribution and player appearance

Every trusted media result visibly identifies YouTube using the official YouTube brand asset plus explicit `Source: YouTube` text.

Appearance settings expose:

- **Minimal** — compact/subtle Elara shell;
- **Glass** — default/backward-compatible shell;
- **Cinema** — wider, higher-emphasis Elara shell.

`mediaPlayerSurfacePreset` lives in the existing `chat-appearance` record. The global player observes that preference through a derived document-root attribute. Appearance does not own selected media, request lineage, readiness or route choice.

Presets style only Elara-owned UI outside the iframe. They do not target YouTube controls, place overlays over the iframe, alter iframe opacity/pointer behavior, or create a new player instance.

The actual provider viewport remains at least 200×200 pixels. The ordinary bordered shell reserves the border outside that minimum; at an extremely narrow viewport Elara drops its decoration before reducing the provider viewport.

## 8. Privacy and user controls

The public `privacy.html` and `terms.html` pages describe the current integration and third-party policy links.

Current local controls include removing the encrypted YouTube API key, deleting conversations containing media metadata, and clearing application/site storage to remove caches and policy-consent state.

The current integration does not request YouTube OAuth Authorized Data. If that changes, the policy documents and consent version must change first.

## 9. Compliance guardrails

Elara preserves these embedded-player constraints:

- actual embedded viewport >=200×200 pixels;
- native YouTube controls remain visible/unobscured;
- normal origin/referrer client identity;
- no overlay/frame/custom visual element over any portion of the player;
- no custom stream/audio extraction;
- no hidden/background playback;
- no autoplay introduced by Elara;
- user-selected internal playback only;
- MFK content remains external-only in the current implementation;
- non-authorized API metadata is refreshed or removed before 30 days.

Current Google/YouTube policy remains the external authority over this guide.

## 10. Verification

The completed roadmap retains all earlier search/quota, routing, mobile, player, preference, appearance and adversarial coverage and adds Phase-9 checks for:

- default-unaccepted and durable versioned policy consent;
- browser proof that acceptance requires an explicit checked control and persists across reload;
- local privacy/terms page availability and official policy links;
- fail-closed search/readiness/key-validation before consent;
- visible YouTube attribution;
- absence of `embedUrl` from newly produced media;
- migration of legacy conversation/cache rows while preserving strict validation;
- continued hostile-URL, MFK, offline/retry, stale-callback, narrow-viewport, Android and one-global-player behavior.

CI #1716 passed every non-browser gate and 121/122 browser tests; its one failure was a stale generic image selector after official logo attribution introduced a second image. That test was narrowed to the thumbnail contract.

Behavioral final head `18c7678f59780eb1db6cbaa064dacf6e3c378cf8` then passed CI #1717 across docs integrity, lint, TypeScript, all 1,233 unit tests, Worker/Durable Object tests, production build, all 122 Playwright tests and final reliability.

## 11. Developer map

| Concern | Source |
| --- | --- |
| Media identity/freshness | `src/domain/media.ts` |
| Playback lifecycle | `src/domain/playback.ts` |
| Global playback authority | `src/media/playback/PlaybackProvider.tsx` |
| Readiness | `src/media/playback/readiness.ts`, `src/media/youtube/readiness.ts` |
| Single global player | `src/media/playback/PlaybackPlayerHost.tsx` |
| Official iframe adapter | `src/media/youtube/player.ts` |
| Card attribution/routing | `src/app/components/media/MediaCard.tsx` |
| Policy-consent UI | `src/app/components/media/YouTubePolicyConsent.tsx` |
| Preference/consent persistence | `src/persistence/preferences.ts` |
| Legacy conversation migration | `src/persistence/conversation.ts` |
| Search-cache migration/storage | `src/media/storage.ts` |
| Appearance projection | `src/media/playback/surface-preset.ts` |
| External handoff | `src/media/handoff.ts` |
| Public policy pages | `public/privacy.html`, `public/terms.html` |

Compact engineering authority: [`../media.md`](../media.md).

## 12. Roadmap closeout

There is no planned Phase 10 in this YouTube playback roadmap. Further improvements are normal system maintenance and repository-wide reliability work rather than another playback layer.

Still absent by design: custom transport controls, iframe overlays, stream/audio extraction, background/hidden playback, offline YouTube media, package-pinned Android handoff, YouTube OAuth Authorized Data, and separate playback persistence.

## Official references

- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Embedded Players and Player Parameters](https://developers.google.com/youtube/player_parameters)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API `search.list`](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Data API `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Made-for-Kids status](https://developers.google.com/youtube/v3/guides/made_for_kids_status)
