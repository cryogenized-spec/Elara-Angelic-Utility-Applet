# Google Scope Registry

Prompt 38 defines one authoritative registry for Google OAuth scopes. Production Pass 3 re-audits the first-class Workspace scope mappings against current Google method/documentation requirements.

## Ownership

Only the OAuth authority owns grant state, token handling, and scope authorization. Feature modules request named capabilities from this registry; they do not hard-code ad-hoc consent flows.

## Registry rules

- Every scope has a stable application capability key, provider scope string, access level, data sensitivity classification, and owning feature.
- Features request the narrowest scope that satisfies the operation.
- Read-only and write-capable scopes remain distinct whenever Google exposes distinct scopes.
- Registry entries are reviewable configuration, not user-controlled strings.
- Unknown scope keys are rejected before authorization.
- Tool schemas never contain OAuth scope strings or tokens.
- A granted scope is not treated as proof that a feature is currently available; current account state, token validity, service availability, and per-operation authorization remain separate checks.

## First-class Workspace capabilities

- `calendar.events.read` / `calendar.events.write`
- `calendar.list.read` / `calendar.settings.read`
- `tasks.read` / `tasks.write`
- `docs.read` / `docs.write`
- `gmail.read` / `gmail.modify` / `gmail.labels` / `gmail.send`
- `drive.files.read` / `drive.files.write`
- `sheets.read` / `sheets.write`
- `chat.read` / `chat.write`

## Provider-scope audit

The application registry maps the capabilities below to the narrowest practical provider scopes currently selected for the implemented operation set. Every mapping must be revalidated against the exact Google API method before the corresponding service is promoted to production.

| Capability | Preferred provider scope | Sensitivity | Notes |
|---|---|---|---|
| Calendar event read | `calendar.events.readonly` | Sensitive | Current Calendar docs expose an event-specific read scope. |
| Calendar event write | `calendar.events` | Sensitive | Current Calendar docs expose an event-specific write scope. |
| Calendar list read | `calendar.calendarlist.readonly` | Sensitive | Use only for subscribed-calendar discovery. |
| Calendar settings read | `calendar.settings.readonly` | Sensitive | Use only for Calendar settings such as time-zone context. |
| Tasks read | `tasks.readonly` | Sensitive | Read-only Tasks access. |
| Tasks write | `tasks` | Sensitive | Required for task creation, editing, moving, and deletion. |
| Docs read | `drive.file` where sufficient | Non-sensitive | `documents.get` currently accepts `drive.file`; use Docs-specific scopes only when the broader document operation requires them. |
| Docs write | `drive.file` where sufficient | Non-sensitive | `documents.create` and relevant Drive-backed access can use `drive.file`. |
| Drive read | `drive.file` where sufficient | Non-sensitive | Per-file access is preferred over broad Drive access. |
| Drive write | `drive.file` where sufficient | Non-sensitive | Per-file access is preferred over broad Drive access. |
| Sheets read | `drive.file` where sufficient | Non-sensitive | Use per-file access for selected/created spreadsheets; use spreadsheet-specific scope only if broader access is required. |
| Sheets write | `drive.file` where sufficient | Non-sensitive | Same least-privilege rule as Sheets read. |
| Gmail read | `gmail.readonly` | Restricted | Restricted Gmail user data requires production verification/compliance planning. |
| Gmail modify | `gmail.modify` | Restricted | Message/thread label changes and trash operations. |
| Gmail label administration | `gmail.labels` | Restricted | Current Gmail scope catalogue exposes a dedicated label-management scope; keep label administration separate from message modification. |
| Gmail send | `gmail.send` | Sensitive | Send-only access remains distinct from mailbox modification. |
| Chat read | `chat.messages.readonly` | Sensitive | Exact Chat method requirements must still be checked at service implementation. |
| Chat write | method-specific Chat write scope | Sensitive | Keep this mapping provisional until every Chat write method is audited individually. |

Google's current OAuth scope catalogue says the app should use the least sensitive scope that satisfies the operation and lists `drive.file` as access to only specific Drive files used with the app. It also distinguishes Gmail `gmail.readonly`, `gmail.modify`, `gmail.labels`, and `gmail.send`. citeturn905264view0turn229576search0

Google's current Calendar authorization guide exposes event-specific read/write scopes plus calendar-list/settings scopes and recommends choosing the most narrowly focused scope possible. citeturn968614search1

Current Docs documentation confirms `documents.get` accepts `drive.file`, while `documents.create` also accepts `drive.file`. citeturn285584search4turn285584search12

Current Drive documentation supports file search/list/get/update operations and explicitly recommends using field masks/selected fields to limit response payloads. citeturn968614search6turn285584search5

Current Tasks documentation exposes `tasks.readonly` for viewing tasks and `tasks` for full management. citeturn285584search11

Current Sheets documentation exposes `drive.file`, `spreadsheets.readonly`, and `spreadsheets`; the application should stay with `drive.file` when its per-file workflow is sufficient. citeturn285584search7

## Incremental authorization rule

Do not request all Workspace permissions at startup merely because integrations exist.

A feature identifies its application capability key. The OAuth authority checks whether that capability is already granted. Only when the user has expressed intent to use the feature should the authority initiate a contextual authorization request for the missing capability, preserving previously granted permissions.

Refresh access silently using the stored server-side refresh credential where valid. User interaction is reserved for missing/revoked/invalid authorization or an explicit re-consent operation.

Google's current web-server OAuth guidance recommends offline access plus incremental authorization with `include_granted_scopes=true`. citeturn285584search10

## Verification and compliance

Sensitive and restricted scopes require additional scrutiny before production launch. The final OAuth consent configuration must match the exact final service set and declared scopes.

Gmail read/modify and other restricted access must be treated as a compliance-sensitive feature, not merely a coding detail. citeturn905264view0turn229576search0

## Non-goals

This registry does not store tokens, initiate redirects, perform token exchange, or execute Google APIs. Those remain owned by the OAuth authority and focused Workspace service boundaries.
