# YouTube media hardening — temporary execution ledger

Base: `main@3cfa4b8661f4fde19fd71f316c9b6dd960621bdb`
Status: Phase 0 / audit + contracts
Canonical docs stay untouched until closeout.

## Authority

YouTube API Services Terms, Developer Policies, Branding Guidelines and Required Minimum Functionality are external policy authority. Implementation is conservative: no scraping, no audiovisual caching/download, no hidden playback, no fabricated API metadata, no unsafe navigation, no persistence of non-authorized API data beyond the permitted refresh/delete window, and clear YouTube attribution.

## Confirmed defects / risks

1. Assistant messages with empty text are discarded even when `media` is valid, so media-only replies disappear.
2. `media-resolved` updates reducer state but not the optimistic chat message; cards appear only on terminal completion.
3. The media reducer does not update its seen set while consuming one incoming batch and drops later duplicate intent/metadata across events.
4. Conversation autoscroll observes the scroll container rather than content growth; lazy cards/images can increase `scrollHeight` without reconciliation.
5. Thumbnail URL failure has no visual fallback; Suspense has a null fallback.
6. Persisted `ChatMessage.media` can outlive YouTube's non-authorized API-data retention window.
7. Cache expiry is logical on read but physical purge is not guaranteed until later cache activity.
8. Handoff fails open for malformed/non-HTTPS `webUrl` values.
9. `listen` rewrites a Data API video result onto `music.youtube.com` without an explicit Data API contract for that cross-product destination; use the canonical YouTube result URL unless policy authority clearly supports the rewrite.
10. Current text badge needs a branding review against YouTube's requirement for applicable Brand Features on API-result surfaces.
11. Browser E2E asserts Android handoff attributes but does not prove the click path or physical app dispatch.
12. Repository search finds no YouTube Terms of Service link or user-facing privacy-policy disclosure for YouTube API use. Developer Policies require both for an API Client, so this is a compliance closeout item rather than optional documentation polish.
13. The provider adapter defensively trims/slices returned search text and fabricates fallback thumbnail dimensions. YouTube policy says search result text/images/information must not be modified or replaced; defensive handling should validate/reject malformed values or constrain them in CSS rather than mutate provider data.

## Invariants

- One generation reducer remains the authority for transcript/artifacts/media lifecycle.
- One terminal conversation persistence barrier remains the authority for durable assistant completion.
- `media-resolved` may project immediately into the existing optimistic assistant; it must not create a second persistence queue.
- Failed/cancelled turns do not invent durable success. Live resolved media may remain visible with a failed partial turn, but terminal persistence semantics remain explicit and tested.
- Media identity is `provider:id`. Stable order is first-seen; latest valid item data/intent wins for an existing identity.
- Tool/model output never chooses arbitrary navigation schemes or provider hosts.
- YouTube audiovisual content is never downloaded, proxied, cached or made available offline.
- Search-result title/channel/thumbnail data is not synthesized or replaced.
- Non-authorized API metadata is refreshed or removed before the policy retention ceiling; stale data is never silently presented as current.
- YouTube-origin content carries clear, approved provider attribution without altering YouTube Brand Features.
- The API Client exposes the required YouTube Terms and privacy disclosures before final compliance sign-off.
- Manual user scrolling always beats late media/layout autoscroll.
- Android physical app chooser acceptance remains a handset-only acceptance check.

## Phases

### Phase 0 — contract + red tests

Add focused tests for media-only renderability, live media projection contract, duplicate merge semantics, safe URL handling, retention bounds and stale cleanup. No runtime fix until the intended failures are captured. Run docs check, lint, typecheck, unit, Worker/DO, build and full Playwright matrix.

### Phase 1 — singular live media projection

Create one projection helper from `GenerationState` to the existing optimistic assistant. Use it for text/media/artifact incremental events so later text deltas cannot erase already-resolved structured content. Render assistant entries based on renderable content, not text alone. Preserve the existing terminal save owner.

Adversarial: media-only completion; media resolves before text; continuation stalls; continuation fails; cancellation; stale generation event; navigation during active turn; media followed by text followed by media.

### Phase 2 — deterministic identity + dedupe

Introduce one media merge primitive. Dedupe within a single batch and across events; preserve first-seen ordering; replace existing identity with the newest valid metadata/intent. Keep per-query provider results unmodified while deduping only the flattened presentation collection.

Adversarial: duplicate IDs in one batch; duplicates across two tool calls; watch→listen and listen→watch; duplicate React keys; repeated cache result; mixed queries returning same video.

### Phase 3 — resilient card/layout delivery

Give the lazy boundary a reserved/skeleton presentation, thumbnail on-error fallback, and content-growth viewport reconciliation by observing the stream/content owner rather than only the scroll viewport. Never move a user who has deliberately entered manual scroll mode.

Adversarial: delayed lazy import; 404 thumbnail; missing thumbnail; very slow image; narrow Android portrait; bottom-follow vs manual scroll; card appearing after text.

### Phase 4 — policy/security hardening

Make YouTube destinations canonical and fail closed to HTTPS/provider-safe targets. Remove unsupported YouTube-Music URL rewriting unless official policy/docs establish it. Preserve provider-returned search data rather than trimming/synthesizing it; malformed values fail validation instead of being rewritten. Add explicit API-data freshness metadata and startup/read cleanup so persisted search metadata cannot be displayed beyond its allowed freshness window. Review/implement approved YouTube attribution without modifying provider branding. Add the required user-facing YouTube Terms link and privacy disclosure/links for YouTube API use in the appropriate legal/settings surface.

Adversarial: `javascript:`, `data:`, `http:`, hostile host, malformed URL, corrupted IndexedDB row, stale >30-day message media, stale cache, missing timestamps, invalid thumbnail dimensions, oversized/malformed provider text, credential-shaped strings, missing legal links, altered attribution asset.

### Phase 5 — browser + platform acceptance harness

Expand Playwright to prove media-only replies, pre-completion visibility, failure/stall behavior, thumbnail fallback, dedupe, reload semantics, cache retention and real click-path behavior where Chromium can observe it. Keep physical Android app dispatch explicitly separate from browser certification.

### Phase 6 — closeout

Reconcile `documents/media.md` and any directly affected canonical reliability/security docs, update verified commits, delete this ledger, dead-code/legacy audit, then exact-head full CI + adversarial rerun. PR remains draft until exact-head certification; merge only on explicit instruction.

## Per-pass gate

Every runtime pass must pass, on its exact head: `docs:check`, lint, typecheck, full unit suite, Worker/Durable Object suite, production build, Chromium + Android portrait + onboarding Playwright, plus the phase-specific adversarial cases. A red gate is investigated and fixed before the next phase begins; no carrying known reds forward.
