# Elara OAuth + Google Workspace — Implementation Handoff

> **Purpose:** This directory is the authoritative handoff for Google OAuth, Workspace integrations, authorization capabilities, and the future background-execution layer. Read this file before changing OAuth or Google tools.
>
> **Current status:** The abandoned Cloudflare Worker OAuth implementation has been retired. The Worker remains a Gemini/transcription service only. The existing application-side Google contracts, scope registry, focused Workspace adapters, tool registry, confirmation boundary, and Memory/Chat architecture remain intact. The next implementation pass replaces the old Worker-backed OAuth authority with the new direct application authorization design.

## 0. Non-negotiable architecture

Elara has exactly one Google authorization authority. Calendar, Tasks, Gmail, Drive, Docs, and Sheets services must consume authorization state from that authority; they must not create their own OAuth clients, consent stores, token refresh logic, or ad-hoc scope registries.

The React/PWA layer must never own Google client secrets, refresh tokens, or provider-specific token-exchange internals. The browser may initiate authorization and consume normalized authorization state.

The model-visible Google surface is an explicit allow-list of named operations. Never create a universal `google.request`, arbitrary HTTP tool, token-bearing tool, scope-editing tool, or endpoint-discovery tool. Tool schemas must contain no OAuth scope strings, credentials, secrets, or raw provider URLs.

The Elara master persona/system prompt remains user-editable application configuration. Google OAuth, tool schemas, capability exposure, authorization, confirmation, and security remain hard-coded application architecture.

## 1. Pass 1 — retire the abandoned Worker OAuth boundary ✅

Completed.

The old Cloudflare Worker Google OAuth implementation has been removed from the repository:

- removed `worker/src/google-oauth.ts`;
- removed its dedicated `worker/src/google-oauth.test.ts` suite;
- removed `worker/.dev.vars.example` because it only described the retired OAuth secrets/session storage;
- removed the dedicated Google OAuth KV namespace and OAuth variables from `worker/wrangler.toml`;
- removed the obsolete Worker OAuth implementation and deployment/status handoff documents;
- removed the Worker OAuth route from `worker/src/index.ts`;
- removed the OAuth-specific CORS request headers from the Gemini Worker;
- retained the Worker itself for Gemini streaming, Gemini tool declarations, health, and audio transcription.

This deliberately does **not** delete the application-side Google contracts, capability model, service adapters, or tool execution boundary. Those are the pieces the replacement OAuth authority will consume.

## 2. Pass 2 — replace the browser authority with the new Google authorization model

This is the next implementation target.

Desired user experience:

1. Settings exposes a **Google Workspace** connection surface.
2. The user connects Google once.
3. Google sign-in/consent occurs only when authorization is actually required.
4. Calendar, Tasks, Gmail, Drive, Docs, and Sheets can be enabled incrementally rather than requesting every permission up front.
5. Existing authorization persists across app reloads and normal sessions.
6. A normal chat interaction does not trigger a fresh Google login every time.
7. Reauthorization happens only when Google or the stored authorization state genuinely requires it.
8. Google Keep is intentionally out of scope.

The replacement must use a modern authorization-code/PKCE design appropriate to the final deployment environment. Exact token/session storage and backend ownership are implementation decisions for Pass 2; they must be chosen so the browser never becomes the durable owner of a Google refresh credential.

## 3. Application boundaries that already exist

The repository already contains reusable application-side foundations:

- `src/google/oauth/contracts.ts` — capability keys, normalized OAuth state, and authority contracts;
- `src/google/oauth/scope-registry.ts` — centralized capability-to-scope mappings and sensitivity metadata;
- `src/google/tools/contracts.ts` and `src/google/tools/registry.ts` — explicit named Google tool contracts;
- `src/google/tools/executor.ts` — centralized authorization, confirmation, risk, diagnostics, and execution gate;
- focused Calendar, Tasks, Gmail, Drive, Docs, and Sheets service adapters;
- `src/app/components/GoogleOAuthSettings.tsx` — the user-facing Google Workspace settings surface;
- existing confirmation infrastructure for write/destructive/send operations.

Preserve these boundaries when replacing the authorization transport. Do not reintroduce a second Google database or service-specific OAuth implementations.

## 4. Capability model

The application authorization layer is capability-oriented. Current capabilities include:

- Calendar event read/write;
- Calendar list/settings read;
- Tasks read/write;
- Docs read/write;
- Chat read/write;
- Gmail read/modify/labels/send;
- Drive file read/write;
- Sheets read/write.

The final release should expose only capabilities actually needed by the user-visible tools. Keep Google Keep excluded.

## 5. Incremental authorization rules

Authorization is demand-driven.

A user can connect Google without granting every Workspace permission. When a tool or settings action needs a capability that is not currently granted, the application should present the missing capability in context and initiate the corresponding Google authorization step.

Do not equate “Google connected” with “all Google services authorized.” A normalized partial/needs-consent/recovery state is expected.

Do not force consent on app startup merely because the user opened Elara.

## 6. Token/session rules

The final architecture must preserve these invariants:

- no Google client secret in the browser;
- no durable Google refresh token in IndexedDB or ordinary app storage;
- no access-token material in model prompts or tool arguments;
- token refresh is handled by the authorization authority, not copied into every service adapter;
- revoked/expired credentials become explicit normalized states that the UI and tool boundary can remediate;
- disconnect removes local authorization state and attempts provider revocation where supported.

A short-lived access token may be used for an authorized provider request, but raw provider credentials must never become model-visible state.

## 7. Google service integration

The first production Workspace set is:

1. Google Calendar
2. Google Tasks
3. Gmail
4. Google Drive
5. Google Docs
6. Google Sheets

Focused adapters should remain responsible for provider-specific request/response shaping. The OAuth authority should remain responsible for authorization state and token lifecycle. The tool executor should remain responsible for whether a tool call is permitted to execute.

Do not turn the service adapters into OAuth clients and do not expose arbitrary provider HTTP access to Gemini.

## 8. Safe Google write workflow

Google read operations may execute when the required capability is currently authorized and the registered tool policy permits the read.

Google writes, destructive operations, and email sends must pass the existing confirmation boundary.

The desired Calendar workflow is:

`Gemini proposes → application creates a structured mutation proposal → user selects/approves proposed items → application executes only the approved mutations → provider response is normalized → returned links/results are shown to the user`

A proposal card should support selective approval and an all-selected action. The application, not the model, decides what actually executes.

## 9. Google tool runtime contract

Model/tool runtime instructions must remain separate from the Elara master persona prompt.

The runtime should provide the model with a small, explicit set of Google operations and their current capability state. It must not expose OAuth secrets, generic HTTP access, scope manipulation, or provider-internal session details.

When a tool requires missing authorization, the runtime should return a structured authorization-needed result rather than attempting to manufacture credentials or silently bypass the application boundary.

## 10. Pass 3 — final scope audit

Re-audit every final Google capability against the exact provider methods used.

Least-privilege direction:

- Calendar: event-specific read/write scopes where sufficient, plus calendar-list/settings scopes only for those features;
- Tasks: readonly for reads and full Tasks scope for management;
- Drive: `drive.file` where selected/app-created-file workflows are sufficient;
- Docs: use file-level access where sufficient and method-specific broader scope only when required;
- Sheets: prefer per-file access where sufficient;
- Gmail: keep read, modify, labels, and send capabilities separate.

Re-check current Google scope sensitivity/restriction classifications immediately before production release.

## 11. Pass 4 — service adapter hardening

Verify the focused adapters with the final authorization transport:

- encoded IDs and provider path components;
- bounded response/request sizes;
- safe pagination;
- field projection where appropriate;
- normalized application errors;
- no token leakage in logs, persistence, tool results, or diagnostics.

## 12. Pass 5 — operational OAuth lifecycle

The finished authorization authority must handle:

- first connection;
- incremental consent;
- denied consent;
- partial grants;
- app reload with an existing authorization;
- access-token expiry;
- silent refresh;
- refresh-token replacement when returned by Google;
- revoked grants;
- disconnect;
- provider/network failures;
- remediation when reauthorization is actually required.

A repeated Google login on every Elara launch is a bug, not an intended lifecycle.

## 13. Pass 6 — mutation watchdog / confirmation UI

Build a structured application-side watchdog for Google mutations.

For multiple proposed Calendar events, the user should be able to approve all, approve a selected subset, or approve a single proposal. The UI must make the exact mutation targets legible before execution.

Only approved mutations may be sent to the Google service adapter. Successful provider responses should surface useful returned metadata, including links where Google returns them.

## 14. Pass 7 — end-to-end verification

Required browser/integration coverage includes:

- initial Google connection;
- incremental Calendar authorization;
- incremental Tasks authorization;
- incremental Gmail authorization;
- incremental Drive authorization;
- incremental Docs authorization;
- incremental Sheets authorization;
- denial and cancellation;
- partial authorization;
- app reload with an existing connection;
- expired access token with silent refresh;
- revoked authorization;
- disconnect;
- malformed tool arguments;
- missing capability remediation;
- confirmation gating;
- selective mutation approval;
- all-approved mutation execution;
- no credential leakage;
- Gemini tool-loop interaction with Google tools.

Run the repository unit tests, build, browser/E2E suite, and any safe live-provider smoke checks available in the deployment environment.

## 15. Pass 8 — background execution

Only after interactive Google operations are stable should the background layer be added.

Target shape:

`scheduled trigger → durable job → authorization authority refresh → Google API operation → persist normalized result/state → user notification → app display`

The browser must not be required to remain open for an already-authorized scheduled job to continue.

## 16. Infrastructure note

The Gemini Worker still exists. It is no longer the Google OAuth authority and must not regain Google OAuth/session/token responsibilities.

The Google authorization implementation should be deployed in the smallest secure backend boundary that actually matches the final hosting environment. Do not rebuild the old Worker OAuth layer under a new name.

## 17. Health/status design

Keep service health separate:

- **Worker:** health of the Gemini/transcription Worker;
- **Gemini:** verified provider request health, not merely Worker reachability;
- **Google:** authorization/capability/service state.

Recommended normalized states include `healthy`, `degraded`, `offline`, `unauthorized`, and `unknown`.

Never present a single “everything is healthy” light when only one dependency has been checked.

## 18. Current next action

**Pass 2:** replace `src/google/oauth/authority.ts` so it no longer points at the retired Cloudflare Worker OAuth endpoints, then implement the new persistent/incremental authorization flow behind the existing capability contracts.

Before implementation, re-check Google's current official OAuth guidance and the exact final scope requirements against the deployment architecture.
