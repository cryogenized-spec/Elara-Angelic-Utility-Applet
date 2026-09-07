# Elara OAuth + Google Workspace — Implementation Handoff

> **Purpose:** This directory is the authoritative handoff for Google OAuth, Workspace integrations, authorization capabilities, and the future background-execution layer. Read this file before changing OAuth or Google tools.
>
> **Current status:** Pass 1 and Pass 2 are complete. The abandoned Cloudflare Worker OAuth implementation has been retired, and the static GitHub Pages application now uses Google Identity Services directly for browser authorization. The Worker remains a Gemini/transcription service only. The existing application-side Google contracts, scope registry, focused Workspace adapters, tool registry, confirmation boundary, and Memory/Chat architecture remain intact.

## 0. Non-negotiable architecture

Elara has exactly one Google authorization authority. Calendar, Tasks, Gmail, Drive, Docs, and Sheets services must consume authorization state from that authority; they must not create their own OAuth clients, consent stores, token refresh logic, or ad-hoc scope registries.

The React/PWA layer must never own Google client secrets or durable Google refresh tokens. Short-lived Google access tokens may exist in memory while a browser session is active, but they must never enter IndexedDB, ordinary application persistence, model context, tool arguments, or diagnostics.

The model-visible Google surface is an explicit allow-list of named operations. Never create a universal `google.request`, arbitrary HTTP tool, token-bearing tool, scope-editing tool, or endpoint-discovery tool. Tool schemas must contain no OAuth scope strings, credentials, secrets, or raw provider URLs.

The Elara master persona/system prompt remains user-editable application configuration. Google OAuth, tool schemas, capability exposure, authorization, confirmation, and security remain hard-coded application architecture.

## 1. Pass 1 — retire the abandoned Worker OAuth boundary ✅

Completed.

The old Cloudflare Worker Google OAuth implementation was removed from the repository, including its server-side OAuth route, tests, dedicated KV/session configuration, obsolete deployment documents, and OAuth-only Worker headers.

The Gemini Worker remains responsible for Gemini streaming, Gemini tool declarations, health, and audio transcription. It must not regain Google OAuth/session/token responsibilities.

The application-side Google contracts, capability model, scope registry, Workspace service adapters, tool execution boundary, and Settings surface were deliberately retained for the replacement authority.

## 2. Pass 2 — direct Google Identity Services authority ✅

Completed for the current static GitHub Pages deployment.

The application now uses `src/google/oauth/gis.ts` as the only Google Identity Services integration boundary and `src/google/oauth/authority.ts` as the application-owned authorization authority.

The authority provides:

- direct browser authorization rather than a redirect through the retired Worker;
- incremental authorization one application capability at a time;
- `include_granted_scopes: true` when obtaining access;
- short-lived access tokens held only in browser memory;
- non-secret capability metadata persisted locally so the application remembers what the user previously enabled;
- silent `prompt: "none"` token reacquisition after reload or token expiry when Google can satisfy the request without user interaction;
- explicit `reauthorization-required` state when silent recovery fails;
- a narrow HTTPS Google API host allow-list before credentialed requests are sent;
- one 401 recovery attempt using silent token reacquisition;
- request-body preservation across that retry;
- provider revocation through GIS when an active access token exists;
- no Cloudflare Worker dependency for Google authorization.

The Settings surface now describes this lifecycle directly and refreshes its normalized status after capability authorization.

Google's current GIS documentation exposes the browser token client with incremental authorization through repeated token requests and `include_granted_scopes`; Google's current Web application guidance also confirms that browser Web OAuth clients use authorized JavaScript origins and do not use a client secret. citeturn687686search0turn687686search3turn687686search7

## 3. Why this pass uses the browser token model

Elara's current production deployment is a static Vite application on GitHub Pages. Rather than replacing one OAuth Worker with another backend solely to hold refresh tokens, Pass 2 keeps the authorization experience entirely inside the application.

This is an intentional deployment trade-off. Google also documents a modern authorization-code model for web applications in which an authorization code is sent to a backend and exchanged for access/refresh credentials. That model is the correct foundation when Elara needs durable server-side offline execution while the user is absent. It is not introduced in Pass 2 because doing so would require adding a new secure backend authority after the explicit retirement of the Worker boundary. citeturn687686search2

Accordingly, Pass 2 provides a direct, incremental, browser-native authorization lifecycle but does not claim closed-tab background Google execution. Background execution remains a later infrastructure concern.

## 4. Application boundaries that already exist

The repository already contains reusable application-side foundations:

- `src/google/oauth/contracts.ts` — capability keys, normalized OAuth state, and authority contracts;
- `src/google/oauth/scope-registry.ts` — centralized capability-to-scope mappings and sensitivity metadata;
- `src/google/oauth/gis.ts` — Google Identity Services browser boundary;
- `src/google/oauth/authority.ts` — application-owned authorization/session state and capability-bound fetching;
- `src/google/oauth/diagnostics.ts` — normalized authorization failure classes;
- `src/google/tools/contracts.ts` and `src/google/tools/registry.ts` — explicit named Google tool contracts;
- `src/google/tools/executor.ts` — centralized authorization, confirmation, risk, diagnostics, and execution gate;
- focused Calendar, Tasks, Gmail, Drive, Docs, and Sheets service adapters;
- `src/app/components/GoogleOAuthSettings.tsx` — the user-facing Google Workspace settings surface;
- existing confirmation infrastructure for write/destructive/send operations.

Preserve these boundaries. Do not reintroduce a second Google database or service-specific OAuth implementations.

## 5. Capability model

The application authorization layer is capability-oriented. Current capabilities include:

- Calendar event read/write;
- Calendar list/settings read;
- Tasks read/write;
- Docs read/write;
- Chat read/write;
- Gmail read/modify/labels/send;
- Drive file read/write;
- Sheets read/write.

Google Keep is intentionally out of scope.

## 6. Incremental authorization rules

Authorization is demand-driven.

A user can authorize Calendar without authorizing Gmail, Drive, Sheets, or other Workspace services. When a tool or Settings action needs a capability that is not currently available, the application requests that capability's registered scope through GIS.

The application does not request a blanket Workspace grant merely because Elara opened. Existing Google grants remain at Google, while Elara remembers the corresponding application capabilities locally.

The normalized status distinguishes a disconnected state, partial authorization, full authorization, and a state requiring user reauthorization. A local remembered grant is not treated as proof that a provider request will always succeed; the provider remains authoritative when a credentialed API request is made.

## 7. Token/session rules

The direct browser authority preserves these invariants:

- no Google client secret in the browser;
- no durable Google refresh token in IndexedDB or ordinary app storage;
- no access-token material in model prompts or tool arguments;
- access tokens are transient browser-memory state;
- token reacquisition is centralized in the authority;
- revoked or expired authorization becomes an explicit remediation state;
- disconnect clears local authorization metadata and attempts provider revocation when a token is available.

Google's current Web OAuth guidance requires secure JavaScript origins for browser applications, and Google identifies client IDs for Web applications separately from client secrets, which are not used in this browser flow. citeturn687686search2turn687686search7

## 8. Google service integration

The first production Workspace set is:

1. Google Calendar
2. Google Tasks
3. Gmail
4. Google Drive
5. Google Docs
6. Google Sheets

Focused adapters remain responsible for provider-specific request/response shaping. The OAuth authority remains responsible for authorization state and token lifecycle. The tool executor remains responsible for whether a tool call is permitted to execute.

Do not turn the service adapters into OAuth clients and do not expose arbitrary provider HTTP access to Gemini.

## 9. Safe Google write workflow

Google read operations may execute when the required capability is currently authorized and the registered tool policy permits the read.

Google writes, destructive operations, and email sends must pass the existing confirmation boundary.

The intended Calendar workflow is:

`Gemini proposes → application creates a structured mutation proposal → user selects/approves proposed items → application executes only the approved mutations → provider response is normalized → returned links/results are shown to the user`

A proposal card should support selective approval and an all-selected action. The application, not the model, decides what actually executes.

## 10. Google tool runtime contract

Model/tool runtime instructions must remain separate from the Elara master persona prompt.

The runtime should provide the model with a small, explicit set of Google operations and their current capability state. It must not expose OAuth secrets, generic HTTP access, scope manipulation, or provider-internal session details.

When a tool requires missing authorization, the runtime should return a structured authorization-needed result rather than attempting to manufacture credentials or silently bypass the application boundary.

## 11. Pass 3 — final scope audit

Re-audit every final Google capability against the exact provider methods used.

Least-privilege direction:

- Calendar: event-specific read/write scopes where sufficient, plus calendar-list/settings scopes only for those features;
- Tasks: readonly for reads and full Tasks scope for management;
- Drive: `drive.file` where selected/app-created-file workflows are sufficient;
- Docs: use file-level access where sufficient and method-specific broader scope only when required;
- Sheets: prefer per-file access where sufficient;
- Gmail: keep read, modify, labels, and send capabilities separate.

Google's current OAuth production-readiness guidance says apps should request only the scopes required by their features and that sensitive/restricted scopes can trigger additional verification requirements. citeturn687686search8

## 12. Pass 4 — service adapter hardening

Verify the focused adapters with the final authorization transport:

- encoded IDs and provider path components;
- bounded response/request sizes;
- safe pagination;
- field projection where appropriate;
- normalized application errors;
- no token leakage in logs, persistence, tool results, or diagnostics.

## 13. Pass 5 — operational OAuth lifecycle

The finished interactive authority must handle:

- first connection;
- incremental consent;
- denied consent;
- partial grants;
- app reload with an existing authorization;
- access-token expiry;
- silent token reacquisition;
- revoked grants;
- disconnect;
- provider/network failures;
- remediation when reauthorization is actually required.

A repeated Google consent screen on every Elara launch is a bug unless Google itself requires renewed user interaction.

## 14. Pass 6 — mutation watchdog / confirmation UI

Build a structured application-side watchdog for Google mutations.

For multiple proposed Calendar events, the user should be able to approve all, approve a selected subset, or approve a single proposal. The UI must make the exact mutation targets legible before execution.

Only approved mutations may be sent to the Google service adapter. Successful provider responses should surface useful returned metadata, including links where Google returns them.

## 15. Pass 7 — end-to-end verification

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
- expired access token with silent reacquisition;
- revoked authorization;
- disconnect;
- malformed tool arguments;
- missing capability remediation;
- confirmation gating;
- selective mutation approval;
- all-approved mutation execution;
- no credential leakage;
- Gemini tool-loop interaction with Google tools.

Run the repository unit tests, build, browser/E2E suite, and safe live-provider smoke checks available in the deployment environment.

## 16. Pass 8 — background execution

Only after interactive Google operations are stable should the background layer be added.

Target shape:

`scheduled trigger → durable job → secure authorization authority → Google API operation → persist normalized result/state → user notification → app display`

The browser must not be required to remain open for an already-authorized scheduled job to continue.

## 17. Health/status design

Keep service health separate:

- **Worker:** health of the Gemini/transcription Worker;
- **Gemini:** verified provider request health, not merely Worker reachability;
- **Google:** authorization/capability/service state.

Recommended normalized states include `healthy`, `degraded`, `offline`, `unauthorized`, and `unknown`.

Never present a single “everything is healthy” light when only one dependency has been checked.

## 18. Current implementation notes

Pass 2 is intentionally browser-native and is suitable for the current GitHub Pages deployment. It is not a claim of durable offline refresh credentials or server-side scheduled Google operations.

Google's current production guidance also requires a production home page and verified domain configuration, and restricted scopes such as Gmail may require additional verification and, in server-side restricted-data cases, a security assessment. These release requirements are separate from whether the browser authorization code works locally. citeturn687686search1turn687686search8

## 19. Current next action

**Pass 3:** audit every Google capability against the exact service methods actually implemented, remove provisional scope mappings, and lock the least-privilege scope registry before expanding the Workspace runtime.
