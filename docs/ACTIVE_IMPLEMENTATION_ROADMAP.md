# Elara — Active Implementation Roadmap

Status date: 2026-09-11

This document supersedes the historical 50-prompt foundation roadmap as the active delivery tracker.

## Numbering

Two independent pass sequences are recorded in `docs/`. They are not the same plan and must not be read as one:

- **This document** — the delivery sequence for replacing the provisional Google authorization runtime and proving real Workspace behaviour.
- **`docs/oauth/PASS_0N_STATUS.md`** — a separately numbered series of completed implementation passes against the same Google surface (adapter hardening, scope audit, Drive/Sheets tool exposure, the executor gate). Its numbering does not line up with this one.

Status prose below is reconciled against source. Where a `docs/oauth/` status file and this tracker disagree, this tracker follows the code and records the correction rather than restating the older claim.

## Historical foundation roadmap

**Prompts 1–50: COMPLETE.**

The original 50-prompt roadmap is considered the completed foundation milestone. Its purpose was to establish the clean-room architecture, canonical Gemini path, local persistence, UI foundations, diagnostics, Google Workspace service boundaries, tool contracts, write-confirmation policy, background-interaction contract, and CI/reliability gate. The implementation log records the individual prompt evidence.

The 50-prompt roadmap is no longer the active measure of progress. The remaining work is an implementation migration/hardening sequence focused on replacing the provisional Google OAuth architecture and proving real Workspace runtime behavior.

## Active implementation sequence

### Pass 0 — CI repair

**Status: ✅ COMPLETE (with continuing CI hardening).**

The original Gemini failed-event handling defect was fixed in `5efb142333a1ace36407f0ca85cd5e4995716bb6`, so normalized provider failures reach the application UI instead of leaving E2E flows waiting indefinitely.

Subsequent test regressions introduced by grouped Google-tool confirmation were also repaired. The latest CI run has all lint, typecheck, unit tests, and build stages passing; its remaining failure is an Android portrait E2E settings interaction that is unrelated to the original Gemini failure-event defect.

### Pass 1 — Remove the abandoned Cloudflare OAuth architecture

**Status: ✅ COMPLETE (verified against source on 2026-09-11).**

There is no Worker-backed Google OAuth path left to remove. `worker/src/index.ts` routes only `/health`, `/autonomy/*`, `/api/gemini`, and `/api/transcribe`; it holds no Google token store, no refresh authority, and no OAuth callback. `worker/wrangler.toml` configures the Gemini/transcription Worker and nothing else. The remaining `GEMINI_WORKER_URL` references are Gemini deployment configuration, not Google authorization.

The earlier "not started" marking conflated two different things: deleting a Worker OAuth implementation (nothing existed) and the browser's continued use of a GIS token client (real, and the subject of Passes 2–3). The browser still authorizes through `src/google/oauth/authority.ts`; that is Pass 2's problem, not leftover Cloudflare OAuth architecture. See `docs/oauth/PASS_01_STATUS.md`, which recorded this correctly.

Removing the browser's *dependency* on the retired design is therefore folded into Passes 2–3 rather than tracked as a separate deletion pass.

### Pass 2 — Rebuild Google authorization around the current GIS authorization-code model

**Status: ❌ NOT STARTED — and currently contradicted by its own target contract.**

The repository uses browser GIS access-token acquisition directly. `src/google/oauth/code-flow.ts` implements a GIS *authorization-code* client and has unit tests, but **nothing in the application imports it** — only its own test file does. It is not a seam, not wired into `googleOAuthAuthority`, and there is no code-exchange endpoint anywhere to receive the code. Describing the code flow as "implemented" (as `docs/oauth/PASS_02_STATUS.md` does) is accurate about the module and misleading about the runtime.

Before this pass can proceed, one contradiction has to be resolved deliberately rather than by whoever writes code first:

- `docs/GOOGLE_OAUTH_ARCHITECTURE_FREEZE.md` — self-described as "the authoritative contract … later features must not reopen it" — states that the interactive GIS token client *is* the current transport and that a durable authorization-code + PKCE authority is "a later, separate subsystem — not the Gemini Worker."
- This roadmap demands the server-side authority be built as the next pass.

Both cannot direct the work. Either the freeze is amended to open that subsystem now, or this pass is re-dated and Pass 3's durability requirements are scoped to what a token-client transport can actually deliver. The choice also decides the deployment question the freeze leaves open: a refresh-capable authority needs a server, and "not the Gemini Worker" means a *second* Worker with its own secret storage — a new deployment surface that CI cannot verify against live Google.

### Pass 3 — Incremental authorization + persistent connection

**Status: 🟡 PARTIAL FOUNDATION ONLY.**

The repository already has capability-level remembered grant state, incremental capability selection, explicit partial/reauthorization states, and GIS incremental-consent support. The current authority persists capability metadata locally and keeps access tokens only in memory.

What is still missing:

- Server-side refresh-token persistence, and therefore any silent recovery of an access token once the Google browser session itself has gone. `prompt: 'none'` covers a reload, not a new day.
- Separation of Google identity/session state from Workspace authorization state.
- **Account identity, which is not implemented at all.** `GoogleOAuthStatus.account` and the stored `account` field are read and rendered, but no code path ever *writes* them: there is no ID token, no `enableGsi`, and no `userinfo` call anywhere in `src/google/`. In the running app the email line in Settings is therefore permanently absent. Both the unit fixture and the E2E test obtain it by writing `localStorage` directly, which is why the gap is invisible to the suite.
- **The observable-state set the migration requires.** The contract reserves `needs-consent`, `token-recovery`, and `revoked`, and `authorizationStateFor()` never emits them — deliberately, and asserted as such by `src/google/oauth/capability-policy.test.ts`. A token-client transport cannot distinguish a silently-recoverable expiry from a revoked grant or a declined scope, so "access token expired", "refresh failed", and "grant revoked" all collapse into `reauthorization-required`. Those states are representable in the type system only. Pass 3 is blocked on Pass 2 for this reason, not merely for storage.

### Pass 4 — Audit and correct every Google scope

**Status: 🟡 SUBSTANTIAL FOUNDATION; RE-AUDIT REQUIRED.**

`docs/GOOGLE_SCOPE_REGISTRY.md` contains a method-by-method capability table covering Calendar, Tasks, Docs, Drive, Sheets, Gmail, and Chat, including least-privilege rationale. The registry is useful and should be retained.

However, the audit must be revalidated against the final OAuth authority and every actual API method used by the runtime services after the Worker/GIS architecture migration. It is therefore not considered fully complete yet.

### Pass 5 — Make the Google tools genuinely operational

**Status: 🟡 SERVICE/TOOL IMPLEMENTATION EXISTS; REAL RUNTIME PROOF REMAINS.**

The repository now contains focused Calendar, Tasks, Docs, Chat, Gmail, Drive, and Sheets service boundaries, model-visible tool declarations, validated handlers, OAuth capability checks, diagnostics, and provider-facing execution wiring. The current service handler layer covers the intended read/write tool surface.

What remains is proving the complete real lifecycle with the final OAuth authority: authorize → token acquisition → API request → refresh/recovery → revoked authorization → useful diagnostics, including representative real Workspace interactions rather than only contract/unit coverage.

### Pass 6 — Google mutation watchdog / confirmation cards

**Status: 🟢 CORE MECHANISM IMPLEMENTED; RUNTIME/UI HARDENING REMAINS.**

The repository now has a shared browser confirmation broker, per-action risk policy, fresh approval checks, grouped multi-mutation review, independent selection, Approve selected, Approve all, Decline, and application-side filtering so only approved mutations reach service handlers.

This is already materially implemented. Remaining work is to harden the end-to-end UI/runtime path around real Calendar/Tasks/Gmail/etc. operations, including partial failures, returned resource links, and final physical-device behavior.

### Pass 7 — Prompt/tool contract + integration hardening

**Status: 🟡 PARTIAL.**

The production Elara master system instruction is already separated from ordinary conversation content and tool schemas, and the Gemini tool loop now carries runtime context plus grouped tool results. Google tool risk, authorization, and confirmation rules are explicit.

Remaining work is the final integration contract and E2E proof: the model must not claim writes succeeded before application results exist; authorization-required and revoked states must be surfaced correctly; tool/read/write semantics must remain distinct; and the complete Google authorization → tool → confirmation → API → result loop needs hardened E2E coverage.

## Blocking prerequisite — API Lockbox credential authority

**Status: ✅ COMPLETE (2026-09-11, this pass).**

This is not a Google pass, but it gates Passes 2–3. The generalized Lockbox that introduced multi-credential storage left three defects at the persistence boundary, all verified against `bc6cfc90421d5fcc67657cc1d3e28589b69b904e` before being fixed:

1. **Secondary writes did not verify the Lockbox credential.** `saveYouTubeApiKey(value, credential)` accepted any non-empty string, encrypted the record with it, and reported success. A mistyped credential therefore silently produced a permanently unreadable key, with the Settings screen as the only guard. `docs/API_LOCKBOX.md` claimed the store "requires the current Lockbox credential"; it did not.
2. **Re-arming security left a secondary permanently unprotected.** Turning security off and back on migrated the Gemini record to the new PIN but skipped the secondary, whose stale `off` stamp made every read path decrypt it with a device-local key stored inside the same record. The YouTube key stayed readable with no credential — through reloads, indefinitely — while Settings reported PIN protection. Root cause: the re-encryption helper skipped records stamped `off`, and read paths trusted a secondary's own mode copy instead of the authority's.
3. **A secondary could exist with no security authority.** With no Gemini record, the write still succeeded; the resulting orphan had nothing to inherit protection from and nothing that could re-arm it.

The fix makes the Gemini record the single source of truth for protection: read paths resolve the *effective* mode from the authority so a stale stamp can never grant weaker access, unlock repairs a diverged record onto the authority's protection, every mode transition and credential rotation re-seals secondaries it can open and reports the ones it cannot as `mismatch`, and secondary writes require an unlocked session plus proof of possession of the current credential — which also prevents this boundary from becoming a PIN-guessing oracle beside the primary's backoff.

Consequence for the passes that follow: **durable refresh-token storage must land on this boundary, not beside it.** Pass 3's protected store inherits credential verification, authority-derived protection mode, and migration-on-unlock from here.

## Verification integrity

A gate that cannot fail is not evidence. Recorded here so no later pass mistakes it for one.

**`npm run lint` does not check application source.** `eslint.config.js` lists `src/**/*.ts`, `src/**/*.tsx`, `e2e/**/*.ts`, `vite.config.ts`, `vitest.config.ts`, and `playwright.config.ts` under `ignores`, leaving a single config block that applies `no-console` to `**/*.{js,mjs,cjs}`. The command therefore lints 6 files — the `scripts/*.mjs` helpers — and reports success for everything else.

It is not only mis-scoped but structurally unable to do more: `typescript-eslint` and `eslint-plugin-react-hooks` are absent from the dependency tree, so there is no TypeScript parser and no ruleset installed to apply to `src/`.

Consequences to weigh:

- The CI `Lint` step currently provides no signal about the app. Where a task's verification standard lists `npm run lint` as authoritative, that is typecheck and tests doing the work, not lint.
- Rules the code style visibly depends on — unused variables, explicit `any`, effect dependency correctness in a React 19 codebase with memoised surfaces — have never been enforced automatically.
- Adding a real TypeScript lint configuration is a prerequisite to trusting "lint green" as a completion criterion. It will surface a backlog and should be planned as its own pass, not adopted as a side effect.

## Current position

**Historical foundation: 50/50 prompts complete.**

**Active implementation: Pass 0 complete; Pass 1 complete (verified); the Lockbox credential-authority prerequisite complete; Passes 2–5 are the remaining architecture/runtime work; Pass 6 is substantially implemented; Pass 7 is partially implemented.**

The next substantive implementation pass is **Pass 2**, and it begins with a documented decision rather than with code: reconcile this tracker with `docs/GOOGLE_OAUTH_ARCHITECTURE_FREEZE.md` on whether the durable authorization-code + PKCE authority is being built now, and where it is deployed. Two follow-on items are cheap and should ride along, because both are currently invisible to the suite: account identity has no writer (Pass 3), and the Google Settings E2E seeds `version: 2` plus a hand-written `account` into `localStorage`, so it exercises the legacy-migration branch and an unreachable UI state instead of the v3 runtime format.

## Evidence anchors

- `README.md` records Prompts 1–50 as completed milestones.
- `docs/IMPLEMENTATION_LOG.md` records the individual prompt commits through Prompt 50, then the post-foundation passes by date. It does not yet record PRs #18–#19.
- `worker/src/index.ts` and `worker/wrangler.toml` show the Worker owning Gemini, transcription, and autonomy only — no Google OAuth route, token store, or refresh authority. This is the evidence that Pass 1 is complete.
- `docs/GOOGLE_OAUTH_ARCHITECTURE.md` describes the intended server-side authorization-code authority; `docs/GOOGLE_OAUTH_ARCHITECTURE_FREEZE.md` is the invariant contract and currently defers that authority to a later subsystem. The conflict is Pass 2's first decision.
- `src/google/oauth/authority.ts` shows the current browser GIS token authority that Passes 2–3 will replace.
- `src/google/oauth/code-flow.ts` is the unreferenced authorization-code client: present, unit-tested, and not wired into any runtime path.
- `src/google/tools/service-handlers.ts` shows the focused operational Google tool-handler surface.
- CI on `bc6cfc90421d5fcc67657cc1d3e28589b69b904e` is green end to end: lint, typecheck, unit tests, Worker/DO tests, build, Chromium installation, all configured Playwright projects, the final reliability gate, and the Pages deploy. The earlier Android portrait failure recorded here is resolved.
- Green CI means every automated gate passes. It does not mean the product is functionally complete: no automated test performs a real Google authorization or a live Workspace call, and Playwright has no browser network seam for `*.googleapis.com`.
