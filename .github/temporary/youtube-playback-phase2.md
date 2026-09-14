# YouTube Playback Phase 2 — authority contract

Base: `feature/youtube-playback-phase1-efficiency@b78f2b17d4bf2f2197f1c6d3be114518df157885` (Phase 1 exact-head CI #1675 green).

Status: implementation ledger. Delete/consume during the playback roadmap closeout; canonical media docs are reconciled only after runtime behaviour is certified.

## Scope

Phase 2 introduces the application-owned playback domain and exactly one global playback authority. It persists only the user's playback preference. It does **not** load YouTube's player SDK, create an iframe/audio/video element, call `videos.list`, check embeddability/Made-for-Kids status, change media-card click behaviour, add the playback chooser, or implement player styling.

## Invariants

1. Exactly one `PlaybackProvider` may own playback state. Nested providers fail loudly rather than creating competing authorities.
2. Playback preference is `ask | embedded | external`; unknown/corrupt values normalize to `ask`.
3. Preference lives in the existing `elara-preferences` database. Selected media, request IDs, phase, playback position and failures are session state only and are never persisted.
4. Every accepted media selection receives one request ID. Selecting B supersedes A. Late lifecycle events carrying A's request ID cannot mutate B.
5. Selection accepts only structurally valid, currently fresh `MediaItem` data. Rejected/stale selections leave the current selection untouched.
6. Lifecycle transitions are explicit and fail closed. Illegal/out-of-order events are no-ops.
7. Error text is bounded application state; provider bodies/credentials are not accepted as playback-state authority.
8. Preference loading cannot overwrite a newer user choice. Preference writes are serialized so rapid changes cannot land out of order.
9. A failed preference write does not pretend the failed value became durable.
10. Mounting the authority creates no media network traffic, iframe, audio, video or player SDK work.
11. Existing search, card rendering and external handoff remain unchanged throughout Phase 2.

## Lifecycle

```text
idle
  ↓ select
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
```

`failed` is reachable only from an active request's working phases. `reset` returns any state to `idle`. `select` from any phase supersedes the previous request. Phase 2 owns the state machine but does not yet drive `checking` or later states from a real YouTube readiness/player implementation; those commands exist as the typed seam for later phases.

## Adversarial matrix

- malformed request ID;
- structurally malformed media;
- stale/exactly-expired/future media;
- select B while A is checking/loading/playing;
- late ready/fail/play/pause/end from A after B owns the authority;
- illegal transitions such as idle→playing or requested→playing;
- reset during every phase;
- oversized/malformed error strings;
- corrupt persisted preference;
- preference load resolves after a newer user choice;
- two rapid preference saves resolve/fail in awkward order;
- persistence failure;
- nested providers;
- unmount/remount: preference survives, selected track/state does not;
- DOM audit: provider alone renders no iframe/audio/video;
- full existing Chromium, Android portrait and onboarding Playwright regression suite.

## Certification history

- `87242e0a9723712712700b95d7a952274ac1d1b3` — CI #1677 stopped at two Phase-2 lint errors; both were corrected without weakening lint.
- `fc14aac972a8c0bbffdf86e0bc883e7635bfa0a1` — lint passed; CI #1678 exposed a test-only type-narrowing issue after provider remount.
- `e533214fc6b4acad7c2048ec824085fe018b1c5f` — lint + typecheck passed; CI #1680 reached units with 1,157 passing and one failing test-only assertion that required incidental React `console.error` logging in addition to the actual nested-provider exception contract.
- Current behavior keeps the nested-provider exception and removes only that incidental logging assertion. Full exact-head certification remains required.

## Exit criteria

- playback reducer/domain tests green;
- persistence tests green without a new database/store;
- provider authority/adversarial tests green;
- source audit shows no player SDK, iframe/readiness call or card-routing change;
- docs integrity, lint, typecheck, full unit suite, Worker/DO suite, build, Chromium/Android/onboarding Playwright and final reliability gate green on the exact behavioral head;
- canonical media + human YouTube docs reconciled afterward, then the documentation head passes the same exact-head matrix;
- Phase 2 PR remains draft/unmerged.
