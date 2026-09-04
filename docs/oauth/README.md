# Elara OAuth + Google Workspace — Future-Self Handoff

> **Purpose:** This directory is the authoritative handoff for the Google OAuth, Workspace integrations, background execution, and related infrastructure work. A future implementation pass must read this file before changing OAuth, Google tools, or background execution.
>
> **Status:** Pass 2 (Google connection settings UI), Pass 3 (scope audit), and Pass 4 (Drive/Docs/Sheets service adapters) are implemented. The clean app still does not contain the protected OAuth Worker source, so end-to-end production authorization cannot yet be claimed.

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
- `docs/GOOGLE_DRIVE_SERVICE.md`, `docs/GOOGLE_SHEETS_SERVICE.md` — Pass 4 service boundaries.

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

Google's current documentation says refresh tokens allow offline access without repeatedly prompting the user and recommends incremental authorization for web/server applications. Re-check Google's live OAuth documentation immediately before implementation.

### Pass 2 — Google connection settings UI

Implemented. Settings now has a dedicated Google section showing overall connection state and independent Calendar, Tasks, Gmail, Drive, Docs, and Sheets capability state. Gmail also exposes separate label-administration and send authorization actions.

Do not let the UI contain scope strings or token logic. It calls application-facing OAuth commands and renders normalized state.

### Pass 3 — Finalize scope registry and least privilege

Implemented. The provider mappings are recorded in `docs/GOOGLE_SCOPE_REGISTRY.md` and tested in `src/google/oauth/scope-registry.test.ts`.

Current audited direction:

- Calendar: event-specific read/write scopes where sufficient; calendar-list/settings scopes only for those functions.
- Tasks: `tasks.readonly` for reads and `tasks` for management.
- Drive: `drive.file` where the feature operates on selected/app-created files; avoid broad Drive access unless proven necessary.
- Docs: `drive.file` where sufficient; method-specific Docs scopes only when needed for broader document access.
- Sheets: `drive.file` where a per-file workflow is sufficient; spreadsheet-specific scopes only when broader access is required.
- Gmail: separate `gmail.readonly`, `gmail.modify`, `gmail.labels`, and `gmail.send` capabilities; do not request modification rights merely to send mail or administer labels.

Sensitive/restricted scopes require verification/compliance review before production release.

### Pass 4 — Drive, Docs, and Sheets service implementations

Implemented as focused application-side adapters:

- `src/google/drive/service.ts` with listing/search, metadata get, authorized download, create, update, and move operations;
- existing `src/google/docs/service.ts` for get/create/batchUpdate;
- `src/google/sheets/service.ts` with spreadsheet metadata, targeted range reads, bounded writes, row appends, and explicit batch updates.

Each service requests an application capability from the OAuth authority and never stores or handles raw OAuth credentials. Inputs are bounded, provider URL components are encoded, list payloads use explicit fields, and large Sheets writes are bounded for predictable execution.

The Drive/Sheets service boundaries and test coverage are documented in `docs/GOOGLE_DRIVE_SERVICE.md` and `docs/GOOGLE_SHEETS_SERVICE.md`.

Do not make Sheets discovery depend on a fictitious "list spreadsheets" endpoint. Use Drive/file-selection semantics when appropriate.

### Pass 5 — Expand the model-visible tool schema

Next. Extend the existing explicit Google allow-list with Drive and Sheets operations.

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

WhatsApp integration is explicitly out of the current scope.

## 7. Future internet access

A later phase may add internet/research access for the agent. This must be a dedicated capability/tool boundary with explicit allow-listing, validation, rate limits, provenance, and safety controls. Never expose an unrestricted raw HTTP request tool to the model.

The likely future concept is a controlled web/research service rather than direct model access to arbitrary network sockets.

## 8. Google verification/compliance notes

Before production launch, review Google's current OAuth verification requirements against the exact final scopes. Sensitive and restricted scopes can trigger verification requirements, and restricted-scope server-side access can create additional security-assessment obligations.

Keep the application home page, privacy policy, terms where applicable, verified domains, redirect URIs, and OAuth consent configuration aligned with the actual deployed architecture.

Do not claim production readiness until the required Google verification/compliance work has been completed or the use case clearly qualifies for an applicable exception.

## 9. Current Google documentation anchors

Use Google's live documentation at implementation time. Pass 3 rechecked the scope choices against Google's current OAuth scope catalogue, Calendar authorization guide, Drive file/access guidance, Docs method authorization requirements, Sheets scope catalogue, Tasks scope reference, and Gmail scope catalogue.

The official documentation confirms that scope choice should be as narrow as practical, `drive.file` is the per-file Drive scope, Docs methods such as `documents.get` and `documents.create` accept `drive.file`, and Gmail exposes separate read, modify, label, and send scopes. citeturn905264view0turn968614search1turn285584search4turn285584search12turn285584search7turn285584search11turn229576search0

Because Google's OAuth policies, scope classifications, and API requirements can change, the future implementer must re-check the live documentation immediately before implementing each pass.

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

**Next immediate implementation target:** Pass 5 — expand the explicit model-visible Google tool schema with Drive and Sheets operations, then route those named tools through validation → capability lookup → OAuth authorization → risk/confirmation → focused service execution.
