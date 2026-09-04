# Elara OAuth + Google Workspace — Future-Self Handoff

> **Purpose:** This directory is the authoritative handoff for the Google OAuth, Workspace integrations, background execution, and related infrastructure work. A future implementation pass must read this file before changing OAuth, Google tools, or background execution.
>
> **Status at handoff:** Visual layer and canonical Gemini Worker path are operational. Google Workspace architecture, capability registry, tool boundary, and OAuth design notes already exist, but the production OAuth authority and end-to-end Workspace API execution still need to be completed.

## 0. Non-negotiable architecture

Elara has exactly one Google authorization authority. Calendar, Tasks, Gmail, Drive, Docs, and Sheets services must consume authorization state from that authority; they must not create their own OAuth clients, consent stores, token refresh logic, or ad-hoc scope registries.

The React/PWA layer must never own Google client secrets, refresh tokens, raw access tokens, token exchange, token refresh, or provider-specific OAuth internals. The browser may initiate authorization and consume normalized authorization state.

The model-visible Google surface is an explicit allow-list of named operations. Never create a universal `google.request`, arbitrary HTTP tool, token-bearing tool, scope-editing tool, or endpoint-discovery tool. Tool schemas must contain no OAuth scope strings, credentials, secrets, or raw provider URLs.

The character/master system prompt remains user-editable application configuration. Google OAuth, tool schemas, capability exposure, authorization, and security remain hard-coded application architecture.

## 1. Current repository starting point

The repository already contains these foundations:

- `docs/GOOGLE_OAUTH_ARCHITECTURE.md` — single OAuth authority, server-side authorization-code boundary, offline refresh, secure redirects, revocation semantics.
- `docs/INCREMENTAL_AUTHORIZATION.md` — demand-driven, contextual incremental consent rules.
- `docs/GOOGLE_SCOPE_REGISTRY.md` — application capability registry and least-privilege rules.
- `docs/GOOGLE_OAUTH_SETTINGS_UI.md` — intended user-facing Google authorization settings surface.
- `docs/GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md` — structured failure semantics.
- `docs/GOOGLE_TOOL_BOUNDARY.md` — model-visible Google allow-list and execution boundary.
- `src/google/tools/contracts.ts` and `src/google/tools/registry.ts` — existing explicit named Google tool contracts.
- `docs/GOOGLE_CALENDAR_SERVICE.md`, `docs/GOOGLE_TASKS_SERVICE.md`, `docs/GOOGLE_DOCS_SERVICE.md`, `docs/GOOGLE_GMAIL_SERVICE.md` — existing service-boundary direction.

Do not replace these with a second architecture. Extend them.

## 2. Google Workspace target

The first production Workspace set is:

1. Google Calendar
2. Google Tasks
3. Gmail
4. Google Drive
5. Google Docs
6. Google Sheets

The intended end state is an agent that can perform useful task-management and productivity work through these services while preserving least privilege, auditable tool calls, explicit mutation risk, and user-controlled authorization.

## 3. OAuth implementation plan — eight passes

### Pass 1 — Production OAuth authority

Implement the real Cloudflare-side OAuth boundary.

Responsibilities:

- Google OAuth client configuration references.
- Authorization-code flow.
- Strong random `state` and callback validation.
- PKCE where applicable/required by the selected agent/web flow.
- Exact HTTPS redirect URI allow-listing.
- Authorization-code exchange at the protected server boundary.
- Secure persistent refresh-token storage.
- Short-lived access-token minting/refresh.
- Refresh-token replacement when Google returns a new refresh token.
- Revocation/disconnect.
- Granted-scope inventory.
- Structured token-expired vs invalid-grant/revoked-consent classification.
- Safe diagnostics with correlation IDs but no credentials or message payloads.

Important: do not send the user through Google sign-in every time Elara opens. Persist the refresh credential securely and silently mint/refresh short-lived access tokens. Request `access_type=offline` and `include_granted_scopes=true`. Only use `prompt=consent` when an explicit re-consent/new-refresh-token condition requires it.

Google's current documentation says refresh tokens allow offline access without repeatedly prompting the user and recommends incremental authorization for web/server applications. See the current Google OAuth web-server and policy docs before implementation.

### Pass 2 — Google connection settings UI

Turn the Settings → Gemini/Google area into a real authorization control surface.

The UI should show:

- Google account connection state.
- Overall OAuth authority state.
- Calendar capability state.
- Tasks capability state.
- Gmail capability state.
- Drive capability state.
- Docs capability state.
- Sheets capability state.
- Missing capability/scope state.
- Reauthorize action.
- Disconnect action.
- Contextual Connect action per service.

Do not let the UI contain scope strings or token logic. It calls application-facing OAuth commands and renders normalized state.

### Pass 3 — Finalize scope registry and least privilege

Audit every existing and new scope against the exact operation.

Preferred direction:

- Calendar: use event-specific/read-only scopes when sufficient; escalate to event write only when required.
- Tasks: `tasks.readonly` for reads and `tasks` for management.
- Drive: prefer `drive.file` when the feature can operate on user-selected/app-created files; use broader Drive scopes only when demonstrably necessary.
- Docs: prefer `drive.file` when that meets the feature requirement; otherwise use the narrowest Docs scope required.
- Sheets: prefer `drive.file` where the app is working with selected/created spreadsheets; use spreadsheet scopes only when required for broader spreadsheet access.
- Gmail: separate read, modify, labels, and send capabilities; do not request `gmail.modify` merely to send mail.

Treat sensitive/restricted scopes as an architectural decision requiring verification/compliance review. Do not casually add broad scopes for convenience.

### Pass 4 — Drive, Docs, and Sheets service implementations

Implement real Google API service adapters behind the existing service boundaries.

Drive target operations should include small, auditable primitives such as:

- search/list files with explicit filters and pagination;
- get file metadata/content where authorized;
- create file;
- update file;
- move file;
- user-selected file access via Google Picker where appropriate.

Docs target operations should include:

- get document;
- create document;
- explicit batch updates.

Sheets target operations should include:

- read targeted ranges;
- write targeted ranges;
- append rows;
- batch updates where necessary;
- spreadsheet metadata access only when required.

Do not make Sheets discovery depend on a fictitious "list spreadsheets" endpoint. Use Drive/file-selection semantics when appropriate.

### Pass 5 — Expand the model-visible tool schema

Extend the existing explicit Google allow-list with Drive and Sheets operations.

Use small named tools, for example:

- `drive.searchFiles`
- `drive.getFile`
- `drive.createFile`
- `drive.updateFile`
- `drive.moveFile`
- `sheets.readRange`
- `sheets.writeRange`
- `sheets.appendRows`
- `sheets.batchUpdate`

Preserve the existing naming/risk/capability pattern.

Every tool call must follow:

`validated model call → application argument validation → capability lookup → OAuth authorization check → risk/confirmation check → service execution → normalized/auditable result`

No tool may invent endpoints, scopes, tokens, arbitrary URLs, or HTTP requests.

### Pass 6 — Confirmation, diagnostics, and failure handling

Connect every mutation to the existing risk classification/confirmation architecture.

Rules:

- reads: execute when authorized;
- writes: use write confirmation policy as required;
- destructive operations: stronger explicit confirmation;
- send operations: explicit send risk;
- authorization denial: disable only affected capability;
- invalid/revoked refresh token: structured remediation state;
- network/provider outage: distinguish temporary failure from authorization failure;
- retry only where the operation is safe and the existing retry policy permits it.

Diagnostics must never expose OAuth tokens, client secrets, authorization headers, raw message payloads, or private file contents.

### Pass 7 — End-to-end verification and production hardening

Do not declare OAuth complete after the callback returns successfully. Verify the complete lifecycle.

Required test matrix:

- initial Google authorization;
- incremental Calendar authorization;
- incremental Tasks authorization;
- incremental Gmail authorization;
- incremental Drive authorization;
- incremental Docs authorization;
- incremental Sheets authorization;
- authorization denial;
- partial consent;
- reconnect/re-consent;
- access-token expiry and silent refresh;
- refresh-token replacement;
- revoked grant;
- disconnect;
- app reload with existing Google connection;
- Worker restart;
- API quota/error responses;
- pagination;
- malformed tool arguments;
- confirmation gating;
- no credential leakage to logs/persistence/tool payloads.

Run unit tests, integration tests, browser/E2E tests, live API smoke tests where credentials can be safely supplied, and the repository reliability gate.

### Pass 8 — Background execution, Cron, and user re-contact

Build the server-side continuation layer only after interactive Google operations are reliable.

Target architecture:

`Cron/scheduled job → durable background execution → OAuth authority refresh → Google API operation → persist normalized result/state → push notification → app resumes/display`

Cloudflare Workers currently support Cron Triggers through `scheduled()` and Cloudflare Agents provide durable scheduled tasks plus Web Push notification patterns. Use the current Cloudflare documentation at implementation time rather than relying on older Worker examples.

The browser must not be the thing that performs the background work. A closed/killed tab must not prevent an already-authorized scheduled job from running.

## 4. Health/status light design

Implement this separately from Google OAuth.

The app should automatically check the production Worker health endpoint when the app becomes active and refresh it periodically while open.

Use separate signals:

- **Worker:** green when the production Worker health endpoint is reachable and healthy; red when unreachable/unhealthy.
- **Gemini:** only green after a real provider request succeeds; Worker health alone is not proof that Gemini is functioning.
- **Google:** per-service capability status based on authorization state plus current service/token checks.

Suggested normalized states:

- `healthy`
- `degraded`
- `offline`
- `unauthorized`
- `unknown`

Never collapse these into one misleading "everything is green" indicator.

## 5. Automatic app startup checks

At app startup/activation:

1. Check Worker health.
2. Read normalized Google connection state.
3. Do not force Google consent merely because the app opened.
4. Silently refresh credentials server-side where possible.
5. Only request user interaction when authorization genuinely requires it.
6. Optionally run a low-cost Gemini verification only when appropriate; avoid unnecessary model traffic on every foreground event.

## 6. Future background/contact architecture

The eventual background layer should support:

- scheduled reminders;
- recurring productivity jobs;
- background Google operations;
- durable job state;
- idempotency and safe retry;
- execution history/audit state;
- user-visible failure/remediation;
- Web Push when the app is closed;
- later optional Telegram integration if desired.

WhatsApp integration is explicitly out of scope for this phase.

## 7. Future internet access

A later phase may add internet/research access for the agent. This must be a dedicated capability/tool boundary with explicit allow-listing, validation, rate limits, provenance, and safety controls. Never expose an unrestricted raw HTTP request tool to the model.

The likely future concept is a controlled web/research service rather than direct model access to arbitrary network sockets.

## 8. Google verification/compliance notes

Before production launch, review Google's current OAuth verification requirements against the exact final scopes. Sensitive and restricted scopes can trigger verification requirements, and restricted-scope server-side access can create additional security-assessment obligations.

Keep the application home page, privacy policy, terms where applicable, verified domains, redirect URIs, and OAuth consent configuration aligned with the actual deployed architecture.

Do not claim production readiness until the required Google verification/compliance work has been completed or the use case clearly qualifies for an applicable exception.

## 9. Current Google documentation anchors

Use Google's live documentation at implementation time. As of this handoff, these are the key authorities that were checked:

- OAuth web-server authorization / offline refresh / incremental authorization: Google OAuth 2.0 web-server documentation.
- OAuth policies / secure redirect URIs / incremental-consent behaviour / revocation handling: Google OAuth 2.0 policies.
- Google OAuth scope catalog: Google OAuth 2.0 scopes reference.
- Calendar scopes: Google Calendar API authorization guide.
- Drive scopes and file-scoped access: Google Drive API authorization guidance.
- Google Picker: Google Drive Picker web integration guide.
- Docs authorization and `documents.get`: Google Docs API reference.
- Sheets authorization: Google Sheets API scopes/reference.
- Tasks scopes: Google Tasks API authorization reference.
- Gmail scopes: Google Gmail API authorization reference.
- Cloudflare Cron Triggers and `scheduled()`: current Cloudflare Workers documentation.
- Cloudflare durable scheduled execution and Web Push: current Cloudflare Agents documentation.

Because Google's OAuth policies, scope classifications, and Cloudflare runtime capabilities can change, the future implementer must re-check the live documentation immediately before implementing each pass.

## 10. Completion checklist

OAuth is not complete until all of the following are true:

- one server-side OAuth authority exists;
- refresh credentials are stored securely server-side;
- browser has no Google refresh token or client secret;
- incremental authorization works per capability;
- every final scope is justified and documented;
- Calendar, Tasks, Gmail, Drive, Docs, and Sheets services execute through focused adapters;
- model-visible Google tools are explicit and validated;
- write/destructive/send confirmation is enforced;
- token expiry refreshes without an unnecessary user login;
- revocation and denial produce clear remediation states;
- health indicators distinguish Worker/Gemini/Google;
- E2E and live smoke tests pass;
- reliability gate passes;
- Google verification/compliance status is documented;
- background execution design is tested before Cron jobs are considered production-ready.

## 11. Handoff rule for future Elara sessions

Before making changes, read this README plus the existing Google OAuth/tool/service documents. Inspect the current `main` branch rather than trusting this note's file names or old commit hashes. Revalidate all Google and Cloudflare assumptions against current official documentation. Preserve the architectural boundaries. Do not resurrect legacy providers, `generateContent()`, client-side OAuth token storage, arbitrary Google HTTP tools, or browser-dependent background execution.

**Next immediate implementation target:** Pass 1 — production OAuth authority.
