# Implementation Log

This file is the durable implementation handoff record for completed roadmap prompts.

## 2026-09-03 — Prompts 5–7

### Prompt 5 — Gemini Integration Strategy
**Commit:** `d40fc88372e144d95fe6b7de5ff5e81f4f7481c3`  
**Changed:** `docs/GEMINI_INTEGRATION_STRATEGY.md`  
**Result:** One canonical Interactions provider boundary; no GenerateContent fallback or duplicate Gemini path.  
**CI:** run `33706691127` (#11) — success.

### Prompt 6 — Current Gemini Model Registry
**Commit:** `fda1dd7f296315755924c9a561dc1d90709601cb`  
**Changed:** `docs/GEMINI_MODEL_REGISTRY.md`  
**Result:** Live model registry with lifecycle and capability metadata.  
**CI:** run `33706746836` (#12) — success.

### Prompt 7 — Gemini Settings Engine
**Commit:** `091492a55498038fedd4d05be0c60a32d97846b2`  
**Changed:** `docs/GEMINI_SETTINGS_ENGINE.md`  
**Result:** Model-aware settings gate; unsupported settings cannot reach the provider.  
**CI:** run `33706769076` (#13) — success.

## 2026-09-03 — Prompts 8–12

### Prompt 8 — Streaming Architecture
**Commit:** `dd23e8b0f00598f02cc13aa162238132035dbce2`  
**Changed:** `docs/GEMINI_STREAMING_ARCHITECTURE.md`  
**Result:** Canonical Interactions SSE/step lifecycle and normalized event boundary covering text, thoughts, tool calls, completion, cancellation and failure.

### Prompt 9 — Thinking Display
**Commit:** `179e33639b384d344b628017348a411a6158c349`  
**Changed:** `docs/GEMINI_THINKING_DISPLAY.md`  
**Result:** Thought summaries are separate optional presentation data; hidden reasoning is never reconstructed and no duplicate reasoning store is created.

### Prompt 10 — Conversation Data Model
**Commit:** `04b422573efae69e7d2f4c49f65d6aec71c8da9b`  
**Changed:** `docs/CONVERSATION_DATA_MODEL.md`  
**Result:** Minimal conversations/messages/typed-parts model with explicit request state and provider continuity metadata. Tool calls/results are first-class parts; tool declarations stay separate. Future memory notes remain a separate domain.

### Prompt 11 — Local Persistence
**Commit:** `4ff1b14c66d40e9f215e1b55f0101a1b482f9396`  
**Changed:** `docs/LOCAL_PERSISTENCE.md`  
**Result:** Dexie/IndexedDB is the sole client persistence authority with explicit schema/migration/recovery/transaction boundaries.

### Prompt 12 — API Lockbox
**Commit:** `03a3e3db7dbd86d2a846e4311405276892ddbc6c6`  
**Changed:** `docs/API_LOCKBOX.md`  
**Result:** Central secret/configuration ownership and explicit separation of Gemini/OAuth secrets, future tool schemas, Workspace access, character system prompt, and memory notes.

### Related correction
**Commit:** `58909eb1b7c42ff16cb65a8cc7e1f9cc362a852a`  
**Changed:** `docs/SYSTEM_BOUNDARIES.md`  
**Result:** Restored the full Prompt 4 responsibility/ownership ADR after an intermediate documentation edit.

## 2026-09-03 — Prompts 13–17

### Prompt 13 — Gemini Credential Architecture
**Commit:** `6ee196007b941d736ae5e7237e63484db3b0b938`  
**Changed:** `docs/GEMINI_CREDENTIAL_ARCHITECTURE.md`  
**Result:** Browser never owns the application Gemini secret; protected credentials belong behind the Worker/security boundary.

### Prompt 14 — Mobile-First Shell
**Commit:** `8f4cb7ac2e0a06f8110e8d19244e8bc9e10bef72`  
**Changed:** `docs/MOBILE_FIRST_SHELL.md`  
**Result:** Android portrait is the canonical layout with one conversation scroll surface, keyboard-safe composer placement, safe-area handling, accessibility requirements, and shared responsive components.

### Prompt 15 — ChatGPT-Style Composer
**Commit:** `90204d91680ec899ccd970a17305f35924efb92f`  
**Changed:** `docs/CHAT_COMPOSER.md`  
**Result:** Multiline composer, explicit send/cancel behavior, bounded growth, attachment/voice affordances, accessible states, and strict separation from persistence/provider/tool execution are defined.

### Prompt 16 — Voice-to-Text
**Commit:** `59fa246b7c8027a80ba7a1ac8e9280eba6036e4e`  
**Changed:** `docs/VOICE_TO_TEXT.md`  
**Result:** Optional SpeechRecognition capability boundary with runtime feature detection, explicit states, cleanup, privacy, and graceful unsupported/permission/error handling.

### Prompt 17 — Attachment System
**Commit:** `8c370bcf0872b1f76d97f75efa110ac1d0e42349`  
**Changed:** `docs/ATTACHMENT_SYSTEM.md`  
**Result:** One attachment lifecycle for selection, validation, metadata, preview, progress, failure/removal, persistence references, and provider handoff.

## 2026-09-03 — Prompts 18–22

### Prompt 18 — Image Input
**Commit:** `c33efca9bb1cc303b54aa05ef96291382353142f`  
**Changed:** `docs/GEMINI_IMAGE_INPUT.md`  
**Result:** Images use the shared attachment lifecycle, stable logical attachment IDs, provider-owned transport selection, and no Gemini-specific logic in UI/persistence.

### Prompt 19 — Document Input
**Commit:** `ede536c8e2750c2b122430e58d893996539bd8ec`  
**Changed:** `docs/GEMINI_DOCUMENT_INPUT.md`  
**Result:** PDF-first document support is transport-neutral, with inline handling for smaller transient files and Files API/reference handling for larger or reused files.

### Prompt 20 — Character Portrait
**Commit:** `3d842b3782c92c3844250a5d12fd9f0ead138617`  
**Changed:** `docs/CHARACTER_PORTRAIT.md`  
**Result:** Durable default/custom/replacement/removal portrait state, accessible enlargement, and bounded 1x–3x presentation scaling.

### Prompt 21 — Appearance System
**Commit:** `3fbf1b3755165a0eda64859fc5a78a6887f92b56`  
**Changed:** `docs/APPEARANCE_SYSTEM.md`  
**Result:** One appearance boundary owns light/dark/system theme, custom background, readability treatment, and portrait presentation state.

### Prompt 22 — Performance Budget
**Commit:** `d29c66ba26d7e5f7005edbaabb277b9942cfc4a1`  
**Changed:** `docs/PERFORMANCE_BUDGET.md`  
**Result:** Android-first budgets established for Core Web Vitals, initial JavaScript, startup, streaming, persistence, attachments, memory, and layout stability. citeturn646477search1

## 2026-09-03 — Prompts 23–27

### Prompt 23 — Modular Code Rules
**Commit:** `734d62f3ef4a49a75f459b7d3fa180a173a7498d`
**Changed:** `docs/MODULAR_CODE_RULES.md`
**Result:** Binding rules for single-responsibility modules, dependency direction, ownership boundaries, side-effect control, anti-patterns, UI composition, provider/persistence/security separation, testing, and review.

### Prompt 24 — Testing Strategy
**Commit:** `942e2337610d16345c0ae5a236d71862e487ba24`
**Changed:** `docs/TESTING_STRATEGY.md`
**Result:** Layered unit, adapter/integration, browser, and Playwright E2E strategy with mandatory runtime gates.

### Prompt 25 — Minimal Vertical Slice
**Implementation commits:** `9c6410a804016715eeb506e842589a52e5e5e3a9`, `a3ac5eb16b8d0eaff7804b626ab28e3d3ab2614b`, `adebd402b5e69d9f155758f9cdf461c9bcd22d87`, `63916e2532ea3f5722cde10a38eb69e5a7fa80cb`, `b732afe70f6432b314bd315609c6a08b3feb4c3c`  
**Changed:** Vite/React/TypeScript runtime scaffold, ESLint/TypeScript/Vitest/Playwright config, Android-first chat shell, application turn port, deterministic demo stream, Dexie persistence, unit test, E2E smoke test, and real CI gates.
**Result:** First executable clean-room spine is present. It proves UI → application turn boundary → normalized stream events → local persistence. The demo transport is explicitly non-Gemini and exists only until the protected canonical Gemini provider is wired.

### Prompt 26 — Gemini Safety Policy
**Commit:** `f5119076372ca0c3517fa04309a8f2ef5fd6f9e4`
**Changed:** `docs/GEMINI_SAFETY_POLICY.md`
**Result:** Layered safety policy covering provider constraints, roleplay boundaries, tool authorization, Workspace authorization, memory/privacy, diagnostics, and safety-focused tests.

### Prompt 27 — Creative-Context System Instruction
**Commit:** `23925759b25d7699fca2bc4de0b4baebf1764bfd`
**Changed:** `docs/CREATIVE_CONTEXT_SYSTEM_INSTRUCTION.md`
**Result:** Production Elara master system instruction covering identity, personality, roleplay, truthfulness, emotional boundaries, tools, Workspace, memory, privacy, and instruction integrity. It is application-owned configuration, separate from ordinary conversation content and tool schemas.

## 2026-09-03 — Prompts 28–37

### Prompts 28–32
**Commits:** `89cc6a5a5af5075ed760789c5918c1c75eeaf9bd`, `e55464ba211fa36696b93f37d8a21cd397642beb`, `3eed597eaac97a38caef7e541dc0581c669a458d`, `4f1398e28f36b752f1e765036334dfe90ba8ec01`, `4421d5e32d018ce8f6173b332640275332a8996b`
**Result:** Canonical Gemini request contract, provider error normalization, HTTP diagnostics, developer diagnostics UI contract, and timing/timeout contract.

### Prompts 33–37
**Commits:** `c4369eb507a30c13b8e8a03b9c28dfb16bccfa43`, `2d606e4ad3576d3361b30ccb167d56adcada406a`, `c799837672905a2a8888657da648db5c1e61cec3`, `6a6ed6c6ed7a17d7e3036d6d15f371e1faaf6df9`, `967a78c89c60a1c729f42d313b317ea1c08ce9c9`
**Result:** Bounded retry policy, request lifecycle state machine, privacy-conscious analytics architecture/dashboard, and one-authority Google OAuth architecture.

## 2026-09-03 — Prompts 38–42

### Prompt 38 — Google Scope Registry
**Commit:** `0a39cf32a94c8b8e310884f78660f079d8a60db0`
**Changed:** `docs/GOOGLE_SCOPE_REGISTRY.md`
**Result:** One authoritative registry for Workspace capability keys, provider scopes, access levels, sensitivity, ownership, and least-privilege review. Calendar read is initially isolated from Calendar write and future Tasks/Docs/Chat capabilities.
**Live verification:** Google's current Calendar scope guidance recommends narrow scopes and lists dedicated read/write/event/calendar-list scopes; sensitive or restricted scopes can introduce verification requirements. citeturn616269search0turn616269search1turn616269search8

### Prompt 39 — Incremental Authorization
**Commit:** `9cbddd6ea5e5fc6e7e12a053c1eb523da5a7d1e9`
**Changed:** `docs/INCREMENTAL_AUTHORIZATION.md`
**Result:** Demand-driven consent flow. Missing capabilities are authorized in context, denials are respected without loops, and write upgrades never silently broaden access.
**Live verification:** Google currently recommends contextual incremental authorization and requesting access when required. citeturn616269search5turn616269search1

### Prompt 40 — Stay Connected Semantics
**Commit:** `e8b5c8a153f60fbd55346fa3bbcaaf43850366bd`
**Changed:** `docs/STAY_CONNECTED_SEMANTICS.md`
**Result:** Defined explicit disconnected/connected/needs-consent/token-recovery/reauthorization/partial/revoked states. "Stay connected" is token-recovery preference, not perpetual authorization.

### Prompt 41 — Google OAuth Settings UI
**Commit:** `b6b913bdc55573c37798c7b0fb2b181b07b2df7e`
**Changed:** `docs/GOOGLE_OAUTH_SETTINGS_UI.md`
**Result:** Defined the user-facing connection settings surface with per-capability status, contextual authorization, explicit disconnect, and safe failure states; no tokens or OAuth internals enter component state.

### Prompt 42 — Google Calendar Service
**Commits:** `9bdcfcecd8a1301d5f398054525f503ca12ae3fb`, `f64e20c7b09cb992f7b2728384993ce7b2dcb35d`, `5589251ac653928a1f3ae986148b06105f563e15`, `2b69bc2bba1e41854f808c88f0084eb1d8b24808`
**Changed:** Central Google OAuth request contract, Calendar service boundary, event mapping, and a contract test proving the service requests the registered Calendar read capability. The service receives an authorized request capability rather than a raw token and does not own OAuth.
**Live verification:** Google Calendar currently separates event-read and event-write scopes, and event mutation requires appropriate write authorization and calendar write access. citeturn616269search0turn616269search3

## 2026-09-03 — Prompts 43–47

### Prompt 43 — Google Tasks Service
**Commits:** `9b50df55a4bd80de3d380800978f29932d0035e2`, `8706f7e50e7a706dcc22a7f55ed11f002261bd4e`, `ede460a6b2f45862e0ad29710a23aa07e2c07a54`, `ecd0d8af3ace3e7706213512430ed2f3218a8b31`
**Changed:** `src/google/tasks/service.ts`, Tasks service tests, and `docs/GOOGLE_TASKS_SERVICE.md`.
**Result:** Dedicated task-list/task retrieval plus create/update/delete/move/clear operations. Moving a task is a first-class operation because Google Tasks supports parent and sibling-position changes.
**Live verification:** Google currently documents separate Tasks read-only and full-management scopes and exposes task move semantics for hierarchy/order control. citeturn756805search0turn455180search6turn455180search12

### Prompt 44 — Google Docs Service
**Commits:** `49758babaeab41fa2171ebf0e05d2a7f595ed0cd`, `de61c6be01b671d518c2efc812f1adf0c7f6c505`, `dfc1474a3954912a38da3153bfcace42627463c0`
**Changed:** focused Docs get/create/batchUpdate boundary, test, and `docs/GOOGLE_DOCS_SERVICE.md`.
**Result:** Docs editing is represented as explicit API update requests rather than hidden behind a monolithic editor abstraction.
**Live verification:** Google's current Docs API exposes `documents.get`, `documents.create`, and atomic `documents.batchUpdate`. citeturn909083search1turn909083search3

### Prompt 45 — Google Chat Service + Gmail acceleration
**Commits:** `f58ddf9f0e6ac04cee0499e93d7811799c391c3c`, `f37f565100d30acc061a2969c45119731b66f3b8`, `515b5ad588827f4ab4938ac40e1ec786318c8c8f`, `f7175f68641b1df03e275440dd9e00a38ed18929`, `ef60d36c551199920894e031f436a1d6692da616`, `a5a60cf0d7e7b62f3bec9f20d1a0ab7e1955ebe6`
**Changed:** focused Chat service/test, granular Gmail service/test, Gmail capabilities in the OAuth contract, and `docs/GOOGLE_GMAIL_SERVICE.md`.
**Result:** Chat has separate list/get/create/update/delete message operations. Gmail is explicitly promoted to an orchestration-critical service with separate message/thread retrieval, label operations, label modification, trash/untrash, and send boundaries.
**Live verification:** Google's current Gmail API exposes message/thread/label/draft resources with granular list/get/modify/trash/untrash/send operations and distinct Gmail scopes such as `gmail.readonly`, `gmail.modify`, `gmail.send`, and `gmail.labels`. citeturn909083search0turn909083search5turn909083search7turn757480search0

### Prompt 46 — Google Tool Boundary
**Commits:** `5bcff03c60b7f99e85d274eaaf779b958c061445`, `d36b7c88ba929d48d654e2ec2af4408e2f857be8`, `8e29de8f7b2c41bf025905f912805f6bb01c40da9`, `248a54d22fdec225731d4b17d814c9eda9907fd9`, `08912d047f0308fb3c3dc4010e1cb0c76208aa9b`
**Changed:** `src/google/tools/contracts.ts`, `src/google/tools/registry.ts`, and `docs/GOOGLE_TOOL_BOUNDARY.md`.
**Result:** Explicit model-visible allow-list across Calendar, Tasks, Docs, Chat, and Gmail. No arbitrary Google HTTP tool, OAuth tokens, provider endpoint URLs, or scope strings are exposed to the model. Tool risk classification maps separately to OAuth capability and later confirmation policy.

### Prompt 47 — Google Write Confirmation
**Commits:** `e419d2ae794760da102563304ee64e19a44e273f`, `5ef1dc6ea062d428b38d2d6ed7e1a4c5024f8e6a`, `c93178e3286d4c1df6ad03036cf89f7f0bcdbb46`
**Changed:** `src/google/confirmation/policy.ts`, confirmation tests, and `docs/GOOGLE_WRITE_CONFIRMATION.md`.
**Result:** Read operations bypass confirmation; writes, destructive mutations, and sends require a bounded confirmation decision. Authorization grants and per-action approval are explicitly separate controls. This provides the safety seam for the future orchestration/Kanban layer.

## 2026-09-03 — Prompts 48–50

### Prompt 48 — OAuth Failure Diagnostics
**Commits:** `17981690f3bc1aa4a8bf32b28285798aacc916a5`, `36fa07595acc54952149a05acdbbcc2362327ec8`, `98845f1ffc2cc97bc47f609d50e03a42b1c303e3`
**Changed:** structured Google OAuth failure classifier, tests, and `docs/GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md`.
**Result:** Authorization failures now have explicit user-action/retry semantics for denial, invalid grants, interaction-required states, configuration errors, temporary outages, and network failures. Diagnostics remain safe and contain no credentials or private payloads.
**Live verification:** Google's current OAuth guidance documents invalidated refresh tokens and requires declined scopes to disable related functionality; incremental authorization should remain contextual. citeturn383674search6

### Prompt 49 — Gemini Native Background Execution
**Commits:** `50a79855ddd355ef4f3aeab54899ae24c9e3d37e`, `09485185fc5a3a85387e597b9d30614798fcc700`, `afd38c6b8654857dc0fccb617d17eca26b9544d8`
**Changed:** background interaction reference/state contract, tests, and `docs/GEMINI_BACKGROUND_EXECUTION.md`.
**Result:** Long-running Gemini Interactions are represented through the same canonical provider boundary, with normalized server interaction IDs and lifecycle states. Reconnection, cancellation, `requires_action`, and completed-interaction chaining are explicitly defined for future orchestration/Kanban work.
**Live verification:** Gemini's current Interactions documentation supports background execution, polling/reconnection, cancellation, and `previous_interaction_id` chaining subject to lifecycle constraints. citeturn383674search0turn383674search1turn383674search3

### Prompt 50 — End-to-End Reliability Gate
**Commits:** `00f3f6c8726ddd2f98862d826caaf05a53e460b9`, `9965db30cb051166cd5dee1564c53076208c1a1a`, `d6d9cf755a2adf0476f616f584819d84e202ec3b`, `000b9f18ac89579f70fdef4d074293d3fbc5d697`, `246920f43ffb8489bd420ecacb49845063706c49`, `fba17059adf8aa1ffb27e2262acf4c4241f31262`
**Changed:** final reliability-check script, npm reliability command, CI enforcement, reliability gate documentation, and final README roadmap/status update.
**Result:** CI now covers Node 24, foundation-document verification, install, lint, typecheck, unit tests, build, Playwright E2E, and the final architecture reliability gate. The final gate rejects accidental legacy `generateContent()` calls in production source and verifies the required architecture documents remain present.

## 2026-09-11 — Forensic re-baseline and Lockbox credential authority

### Pass 0 — Re-baseline against `bc6cfc9`

**Scope:** reconcile every status claim in `docs/` against source, tests, and CI before any further implementation; produce a contract/runtime/proof matrix for the Google authorization, Workspace tooling, media, Lockbox, autonomy, artifact, and UI surfaces.

**Why:** the roadmap, the parallel `docs/oauth/` pass series, and the handoff prose disagreed about what had been built. Three specific claims were wrong in ways that would have misdirected the next pass.

**Findings (verified, not inferred):**

- `docs/ACTIVE_IMPLEMENTATION_ROADMAP.md` marked Pass 1 (remove the abandoned Cloudflare OAuth architecture) as NOT STARTED. The Worker exposes only `/health`, `/autonomy/*`, `/api/gemini`, and `/api/transcribe` — there was never a Worker OAuth path in this tree to delete. `docs/oauth/PASS_01_STATUS.md` had it right.
- The handoff stated the quick-action rail still runs on a deterministic demo adapter. `demoQuickActionPort`, the `QuickActionPort` seam, and `QuickActionSurface` have **zero** consumers; `TopToolRail` → `WorkspaceMenu` → `App.runWorkspaceShortcut` dispatches a real generation turn narrowed to the shortcut's registered tools. The rail is live.
- `docs/oauth/PASS_02_STATUS.md` recorded the authorization-code boundary as implemented. `src/google/oauth/code-flow.ts` exists and is unit-tested but is imported only by its own test; the live authority still uses the GIS token client, and no exchange endpoint exists.
- Google account identity is unreachable. `GoogleOAuthStatus.account` is read and rendered, but no code path writes it — no ID token, no `enableGsi`, no `userinfo`. `e2e/google-oauth-settings.spec.ts` seeds `version: 2` plus a hand-written `account` into `localStorage`, so it exercises the legacy-migration branch and asserts a UI state production cannot produce. This is a test passing for the wrong reason.
- The active roadmap and `docs/GOOGLE_OAUTH_ARCHITECTURE_FREEZE.md` conflict on the authorization transport. The freeze declares itself the authoritative contract, sanctions the GIS token client as the current transport, and defers a durable authority to a later separate subsystem; the roadmap requires building it as the next pass. Unresolved — recorded as Pass 2's first decision rather than settled by whoever writes code.

**Verification:** `npm run typecheck`, `npm test` (114 files / 964 tests), `npm run test:workers` (88 tests), `npm run build`, and `npm run reliability:check` all green locally. GitHub CI green on `bc6cfc9` including all Playwright projects. `npm run lint` also exits 0, but see **Verification integrity** in `docs/ACTIVE_IMPLEMENTATION_ROADMAP.md`: that command ignores every TypeScript file and lints only the `.mjs` scripts, so it is not evidence about this change. Playwright could not be executed in this environment — Chromium download is blocked — so no local E2E claim is made.

### API Lockbox — secondary credential authority

**Scope:** targeted security audit of the generalized multi-credential Lockbox introduced by PR #19, followed by the smallest change that closes the persistence boundary. `src/persistence/gemini-api-key.ts` plus regression coverage.

**Why:** the roadmap makes durable refresh-token storage a later pass, and that store is this same Lockbox. Auditing it before building on top of it turned up three live defects, one of which leaked a credential.

**Defects found (each reproduced against unmodified `bc6cfc9` before fixing):**

1. **Secondary writes did not verify the Lockbox credential.** `saveYouTubeApiKey(value, credential)` accepted any non-empty string and encrypted the record with it. `docs/API_LOCKBOX.md` claimed saving a secondary "requires the current Lockbox credential"; only the Settings UI enforced anything. A mistyped credential silently produced a permanently unreadable record. `src/persistence/lockbox-youtube.test.ts` had a test asserting the resulting `mismatch` was honestly *reported* — which documented the symptom while legitimising the write that caused it.
2. **Re-arming security left a secondary permanently readable with no credential.** `off` → `enableGeminiLockboxWithPin` migrated the Gemini record but skipped the secondary, whose stale `off` stamp made every read path decrypt it with a device-local key held inside the same record. Observed directly: `gemini-api-key {mode: "pin"}` alongside `youtube-api-key {mode: "off", hasLocalKey: true}`, key returned in plaintext after `lockGeminiApiKey()`, surviving reload. Cause: `reencryptSecondarySecrets()` skipped records stamped `off`, and both `readSecret()` and `getSecretStatus()` consulted the record's own copy of the mode instead of the authority's.
3. **A secondary could be created with no security authority.** With no Gemini record, `mode` defaulted to `password` and the write still succeeded, producing an orphan with nothing to inherit protection from and nothing able to re-arm it.

**Architectural decision:** the Gemini record's mode becomes the only mode that governs access. A secondary's stored mode copy is advisory — never a grant of weaker protection. One writer (`storeSecondary`) produces every secondary record in both protection classes, so the stamp cannot diverge from the protection by construction. Secondary writes require proof of possession of the current credential, verified by decrypting the authority record, and only from an already-unlocked session: an unthrottled verification call would otherwise become a PIN-guessing oracle beside the primary's deliberate backoff. Records that cannot be opened are left byte-for-byte alone and reported as `mismatch` rather than re-encrypted under a credential nobody can re-derive — fail closed, destroy nothing.

**Also fixed in passing:** `saveGeminiApiKey()` replaced the authority credential without re-sealing secondaries, orphaning them against the old passphrase; it now rotates them like the PIN path does. `disableGeminiLockboxSecurity()`'s comment claimed "either all are `off` or none are", which was false for an unopenable secondary; the code is unchanged there (sealing is the safe direction) and the comment now describes what actually happens.

**Files changed:** `src/persistence/gemini-api-key.ts`; new `src/persistence/lockbox-credential-authority.test.ts` and `src/persistence/lockbox-test-fixtures.ts` (test-only raw-storage fixtures, since the public API can no longer create these states); `src/persistence/lockbox-youtube.test.ts` and `src/app/components/GeminiApiLockbox.test.tsx` updated to reach `mismatch` through damaged storage instead of through the hole; `docs/API_LOCKBOX.md` rewritten to state the enforced contract.

**Test evidence:** 10 new tests. **6 fail against unmodified `bc6cfc9` and pass after the fix** — the four that pass in both states pin behaviour the fix must not regress. New UI test asserts the refusal message reaches the user without echoing either secret and leaves the authority intact.

**Result:** lint, typecheck, and `npm test` green — 115 files / 975 tests. `npm run build`, `npm run test:workers`, and `npm run reliability:check` were green at baseline and the change is confined to persistence and tests.

**Unresolved risks:** no E2E coverage was added, because the browser cannot run in this environment; CI is the authority for the Playwright projects. `clearYouTubeApiKey()` deliberately remains callable from a locked session, so a user is never stuck unable to remove a credential.

**Next recommended work:** resolve the Pass 2 transport conflict, then build the durable authority on this boundary so it inherits credential verification and authority-derived protection instead of adding a second store.

## 2026-09-12 — YouTube results handed off to the platform

**Scope:** the media feature made operable end to end — `src/domain/media.ts`, `src/media/{search,tool-handler,youtube-schema,handoff}.ts`, `src/app/components/media/`, the Gemini tool declaration and registry description, `e2e/media-handoff.spec.ts`, `docs/MEDIA_INTEGRATION.md`.

**Why:** the graph could already search and render a card, and every layer had tests. What it did not do was what was asked for: tapping a result had to hand playback to the user's own app — Android's picker for music, never audio inside the applet — and the model had to be able to say which kind of result it meant.

**What changed:**
- `intent: 'watch' | 'listen'` on `MediaItem` and on the tool call, optional and defaulting to `watch`. It is an explicit argument because `search.list` carries no duration and no topic id, and the quota forbids the `videos.list` call that would supply one; the model that read the user's sentence is the only reliable classifier. Absent-on-old-data is valid (items are persisted inside messages, so requiring it would erase the cards of every existing conversation), wrong-but-present is rejected.
- New pure `src/media/handoff.ts`. Android gets an `intent://` URI with a browser fallback, the `;end` terminator, and deliberately no `package=` component — pinning a handler would suppress the chooser, which is the one behaviour this must not do. Every other platform gets the canonical URL verbatim. `listen` routes a single video to YouTube Music, preserving a start offset, and passes through playlists, unfamiliar hosts, and unparseable or non-https links untouched.
- No iframe and no inline player for video either, chosen rather than deferred: an embed imports roughly a megabyte of provider JavaScript to deliver a worse version of what the user's own apps already do, and traps playback in a chat window on Android.
- The intent is stamped **after** the cache write and never enters the cache key, so one billed `search.list` answer serves both intents. This is the quota-relevant ordering; without it the feature would double its own cost.
- Card: verb and destination derive from one shared platform read so the tooltip cannot promise something the `href` does not do; the whole card stays a single anchor. Fixed the thumbnail frame, which had reserved 4:3 and therefore rendered the provider's letterbox bars. 44px minimum action row. Dropped the duration overlay before shipping it — the provider never returns a duration, so it could only ever have shown a fabricated or permanently absent number.

**Verification:** `npm run lint`, `typecheck`, `test` (118 files / 1 035 tests), `test:workers`, `build`, `reliability:check` green locally; 60 tests added and mutation-checked at 14/14, i.e. each invariant was confirmed to fail when broken. Playwright cannot run in this environment (browser download blocked), so E2E is CI-only. First CI run **failed** on all four new tests; the cause was the suite, not the feature — see the `headerValue` finding in `ACTIVE_IMPLEMENTATION_ROADMAP.md` → Verification integrity.

**Not claimed:** whether Android shows its app chooser or opens a single default handler. That is the platform's decision, needs a physical device, and is listed as outstanding.

## 2026-09-12 — Worker suite determinism (Pass 2)

**Scope:** two intermittent worker tests that made main CI red at random — `worker/test/routine-run-workflow.test.ts:115` (expected 200 got 500) and `worker/test/autonomy-engine.test.ts:295` (scheduledFor mismatch ~97s early). Zero production files under `worker/` changed in the earlier media/Lockbox work, so these were pre-existing flakes.

**Flake 1 — routine-run-workflow: completing same runKey twice is a no-op**

- **Root cause:** test waited for RUN ROW via `/autonomy/runs?since=0` for runKey, then POSTed `/run/complete` without a structured result. Engine `engine.ts:679` missing-envelope and `:686` missing-result return 500 `retryable-error` until the run's envelope exists and a C1 result is supplied. Row can exist before envelope and before Workflow result, so readiness predicate was wrong.
- **Invariant pinned:** a run cannot be completed before its frozen envelope exists and before a structured C1 result is supplied; completing an already-terminal runKey is idempotent `already-completed` even without a result.
- **Fix:** wait on real precondition `envelopePresent(runKey)` via harness, then complete first time with `{disposition:'noop'}`; second completion without result asserts `alreadyCompleted:true` and `status:already-completed`. No sleep/retry dodge, no loosened assertion.

**Flake 2 — autonomy-engine: scheduled-run budget enforced**

- **Root cause:** after processing `firstDue = now-5min`, scheduler advances to next interval grid tick `anchor + n*30min` (anchor `1_700_000_000_000` ends with 0000, so grid ticks end with 0000). `firstDue` is ~5s before a grid tick, so next tick `1789215200000` is still ~5min in past and immediately due. Under load, alarm fires for that intermediate tick before test ensures `secondDue = now-2min`, producing 3 records: first completed, intermediate budget refusal at `5200000`, second budget refusal at `secondDue`. `records.find(errorCode===SCHEDULER_BUDGET_CODE)` returned first budget (5200000) not secondDue, causing `scheduledFor` mismatch. No rounding bug in `ensureScheduled`/`store`/`schedule` — wrong-record attribution.
- **Invariant pinned:** budget enforcement must produce an explicit, inspectable skipped run with `SCHEDULER_BUDGET_EXCEEDED`; both caller-supplied dues must appear once; at least one budget refusal exists as `skipped`. Exact `scheduledFor == secondDue` is not the product guarantee when intermediate grid dues are also past and budget-refused.
- **Fix:** drop exact `scheduledFor: secondDue` matcher; assert `budgetRefusals.length>=1` with `state:skipped, outcome:skipped, errorCode:SCHEDULER_BUDGET_CODE`; assert `records.filter(scheduledFor===firstDue)` and `records.filter(scheduledFor===secondDue)` each length 1; `records.length>=2`.

**Verification:**

- Repro: isolated `vitest run worker/test/autonomy-engine.test.ts` always passed; full suite `npm run test:workers` flaked ~55% (11/20) under parallel `npm run build` load. Debug instrumentation `DEBUG_BUDGET:` JSON captured 3-record case with intermediate `1789215200000`.
- Determinism proof: 15 consecutive `npm run test:workers` zero failures, then 15 consecutive with `npm run build` parallel load zero failures (30 total).
- Bite-proof: reintroduced defect 1 — complete without result while claim is running returns 500 (engine still enforces result); fixed test with result passes. Reintroduced defect 2 — skip budget enforcement (`if (false && budgetUsed>=...)`) makes test fail `expected 0 to be >=1` — fixed test correctly bites.
- Full gates: `npm run lint`, `typecheck`, `test` (119 files/1045 tests), `test:workers` (88 tests), `build` green locally. E2E is CI-only (Chromium download blocked locally).
- CI: one run that reaches and passes End-to-end after fix (to be confirmed in PR).

**Related debt (not fixed, one line):** `typecheck` excludes e2e (`include ["src"]`) allowing `route.request().header(...)` non-existent Playwright method to reach CI; needs tsconfig scoped to e2e with ES2022, ESNext, bundler, strict, types node — Pass 3. Also considered `if: always()` for E2E job so flaky worker suite cannot hide absence, but decided not to add just to make green and never mark E2E non-blocking; with deterministic worker suite E2E now runs.

## 2026-09-12 — Workspace shortcuts: no hidden model turns

**Change:** `src/app/App.tsx` — removed the synthesized `hiddenTask` user turn behind the Workspace shortcut buttons and replaced it with `prefillWorkspaceShortcut`, which puts the shortcut's saved intent into the composer as the user's own visible, editable draft. Sending it is an ordinary message turn (standard tool set, standard OAuth and mutation gates). Also removed the now-unused `workspaceShortcutDefinition` import in `App.tsx`.

**Why:** the previous path streamed `Execute the saved Workspace shortcut "{label}"…` to the provider as the user turn with no persisted user message — a hidden chat prompt implementing a UI shortcut, violating the standing architecture rule, and leaving the provider holding input the transcript never recorded (on failure, nothing appeared at all; retry could replay the hidden text). Direct tool invocation (option 1) was rejected as the largest change and a worse feature (it breaks conversational shortcuts like `gmail-recent-from-sender`, whose intent asks the model to request the sender); the app-instruction channel (option 3) is barred for user intent by contract.

**Accepted trade:** the per-shortcut restricted tool set is gone — a prefilled message runs with the same tools as typed text. `WorkspaceShortcutDefinition.tools` and `requiredCapabilities` remain stored metadata; `requiredCapabilities` currently has no consumer (recorded finding, untouched).

**Tests:** `e2e/workspace-shortcuts.spec.ts` — the two tests that asserted the hidden prompt now assert the invariant: prefill puts the exact intent in the composer with zero provider requests and no transcript change; sending produces exactly one provider `input` string-equal to the visible user message, which appears in the transcript. New guard `src/app/workspace-shortcut-guard.test.ts` fails `npm test` if any call site passes a string literal as `streamAssistantTurn` input, if a shortcut entry point streams, or if the removed prompt text returns. `docs/GOOGLE_WORKSPACE_SHORTCUTS.md` carries a dated correction of the old "internal agent-task request" wording.

**Verification:** local lint/typecheck/units/build/reliability green; CI (including the three Playwright projects) is the authority for E2E.

## 2026-09-12 — Pass 5: honest Google OAuth E2E + account-identity writer audit

**Change:** `e2e/google-oauth-settings.spec.ts` no longer forges the app's persisted authorization state. It stubs only the external Google boundary (the GIS token-client script and the userinfo endpoint via `page.route`) and lets the real authority in `src/google/oauth/authority.ts` write every stored field; assertions then check the app's own localStorage record (version 3, account from userinfo, enabled capabilities, current-token scopes) and the UI a signed-in user sees, across a reload. Seeding remains only in an explicit legacy-migration test using the genuine v2 shape (`version: 2` + `grantedCapabilities`); it also proves a real acquisition supersedes legacy evidence with scope truth. `playwright.config.ts` now gives the dev server a test `VITE_GOOGLE_CLIENT_ID` (client IDs are public browser configuration), without which `ensureClientId()` refuses to run and no honest flow test is possible.

**Writer audit (criterion: every v3 field has exactly one writer):** all in `src/google/oauth/authority.ts` — `version`/`updatedAt` forced by `saveStored()`; `enabledCapabilities` unioned only in `acquireToken()` success; `grantedProviderScopes` replaced only in `acquireToken()` success; `account` written/cleared only in `acquireToken()` from `fetchGoogleAccount()` (userinfo); `needsReauthorization` set on silent-refresh failure (acquireToken catch, authorizedFetch 401 paths) and cleared on success; `disconnect()` is the sole deletion path. `e2e/` forging audit: smoke.spec's legacy key seed is an explicit migration test; vtt.spec mocks browser APIs only; workspace-shortcuts reads stores without writing them. No other spec forges auth state.

**Docs:** freeze doc gains a dated note recording that identity is best-effort userinfo-derived and never fabricated; roadmap correction supersedes the interim "E2E now seeds v3" claim.

**Verification:** local lint/typecheck (incl. e2e project)/units/workers/build/reliability green; CI (chromium project) is the authority for the rewritten spec.

**Found by the honest spec, fixed in this pass:** once the flow test ran for real, it caught a genuine component defect the forged-state version could never see — `GoogleOAuthSettings.connect()` cleared its busy flag only on error, so after a *successful* connect every button in the panel (Disconnect, Enable writes, other Connects) stayed disabled until a full page reload. Fixed by clearing it in `finally`.

## 2026-09-12 — Pass 6: Android device validation protocol

**Change:** added `docs/ANDROID_DEVICE_VALIDATION.md` (2026-09-12) — a dated, under-10-minute on-device checklist covering: install from the shipped GitHub Pages deployment (noting the applet had no physical-device contact before this document), Lockbox key survival across a full app close/reopen, the Listen/Watch card hand-offs with a four-way expected-vs-actual record (chooser / one app / browser / nothing) in both Chrome and the installed PWA, the cache re-tap proven by exactly one `youtube/v3/search` request for two identical asks over USB devtools, the missing-key and no-results failure states, and the 12-search per-session quota guard. Its "Not verified before this document existed" section honestly states that no device run has happened yet. `docs/MEDIA_INTEGRATION.md` → "Verified where" now splits CI-verified (URI shape, card, cache, failures on desktop + Android UA) from device-verified (nothing yet), replacing the bare outstanding sentence; the roadmap's current-position block points at the protocol as the evidence artifact.

**No product code changed.** This pass deliberately builds only the protocol: the one thing it validates — whether Android shows its chooser or a single default handler — is decided by the phone, not by any test environment. If the run records a single app opening directly, the accepted response is documenting the platform behaviour in MEDIA_INTEGRATION → Hand-off, never pinning a package name.

**Verification:** gates green; CI green. Device results pending the user's run; they get transcribed into the protocol dated when they arrive.

## Deployment decision

Elara is intended for GitHub Pages using GitHub Actions: `main` → build → `dist` → Pages. The repository root and `/docs` are source/documentation, not the published site. The Vite production base must match the eventual project-site URL path. Cloudflare Pages remains a viable alternative but is not the primary roadmap deployment. GitHub currently recommends Actions workflows for custom build pipelines, and Vite's current deployment guide instructs users to select GitHub Actions and build the site before publishing. citeturn275656search0turn275656search1turn275656search7

## Current runtime/CI status

The executable runtime scaffold is present in `main`. CI is configured for install → lint → typecheck → unit tests → Worker/DO tests → build → Playwright E2E → final reliability gate, and a genuine generated `package-lock.json` is committed. CI still installs with `npm install`; `npm ci` is the reproducible choice now that the lockfile exists, and is worth changing as a standalone infrastructure pass rather than bundled with product work.

The final 50-prompt foundation is considered complete: `main` carries a completed green CI run covering every gate above. Green CI demonstrates that automated contracts hold. It does not demonstrate that Google Workspace capabilities are operationally complete — see `docs/ACTIVE_IMPLEMENTATION_ROADMAP.md`.

> Correction (2026-09-11): this section previously recorded that no pull requests were used and that changes were committed directly to `main`. Post-foundation work has been delivered through reviewed pull requests into `main` (PR #18, PR #19).

## Future-self requirements preserved

Tool execution is allow-listed and validated. Workspace tools cannot bypass OAuth, scope, diagnostics, or write-confirmation controls. The character master prompt remains separate from user content and tool schemas. Notable memories remain a separate retrievable domain. Image/document input remains an attachment concern, not a second provider runtime. Appearance remains presentation-only. Performance ownership stays distributed to the modules that create the work. Background Gemini execution remains on the canonical provider path rather than becoming a second runtime.
