# Elara — Active Implementation Roadmap

Status date: 2026-09-07

This document supersedes the historical 50-prompt foundation roadmap as the active delivery tracker.

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

**Status: ❌ NOT STARTED.**

The current source still has a browser-side Google GIS authority in `src/google/oauth/authority.ts`, while the repository architecture/history still retains the Worker as a general server/security boundary. The Worker-specific OAuth architecture has not yet been removed and its assumptions have not yet been eliminated.

Completion requires removing the abandoned Worker-backed Google OAuth path/configuration/documentation and removing the browser's dependency on the old Cloudflare OAuth architecture without deleting the useful Google capability/service boundaries.

### Pass 2 — Rebuild Google authorization around the current GIS authorization-code model

**Status: ❌ NOT STARTED.**

The repository currently uses browser GIS access-token acquisition directly. That is not the target architecture for this pass: the intended end state is a small protected server-side OAuth authority using Google's authorization-code flow, with protected refresh-token storage and browser-visible capability state only.

The existing `docs/GOOGLE_OAUTH_ARCHITECTURE.md` describes the target server-side authority, but the runtime implementation has not been migrated to it.

### Pass 3 — Incremental authorization + persistent connection

**Status: 🟡 PARTIAL FOUNDATION ONLY.**

The repository already has capability-level remembered grant state, incremental capability selection, explicit partial/reauthorization states, and GIS incremental-consent support. The current authority persists capability metadata locally and keeps access tokens only in memory.

What is still missing is the target durable authorization experience: server-side refresh-token persistence, separation of Google identity/session state from Workspace authorization state, and reliable silent access-token recovery across browser sessions without requiring the user to reconnect unnecessarily.

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

## Current position

**Historical foundation: 50/50 prompts complete.**

**Active implementation: Pass 0 complete; Passes 1–5 are the main remaining architecture/runtime work; Pass 6 is substantially implemented; Pass 7 is partially implemented.**

The next substantive implementation pass is **Pass 1 — Remove the abandoned Cloudflare OAuth architecture**.

## Evidence anchors

- `README.md` records Prompts 1–50 as completed milestones.
- `docs/IMPLEMENTATION_LOG.md` records the individual prompt commits through Prompt 50.
- `docs/GOOGLE_OAUTH_ARCHITECTURE.md` describes the intended server-side authorization-code authority.
- `src/google/oauth/authority.ts` shows the current browser GIS token authority that Passes 1–3 will replace.
- `src/google/tools/service-handlers.ts` shows the focused operational Google tool-handler surface.
- The latest CI on `ac5d8b9d04a129fc2234ed9ad0e952e8619c6e1f` passed lint, typecheck, unit tests, and build, then failed one Android portrait E2E settings test before the final reliability gate could run.
