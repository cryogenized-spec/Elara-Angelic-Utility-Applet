# Google Scope Registry

Prompt 38 defines one authoritative registry for Google OAuth scopes. Production Pass 1 extends it for the full first-class Workspace set.

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
- `gmail.read` / `gmail.modify` / `gmail.send`
- `drive.files.read` / `drive.files.write`
- `sheets.read` / `sheets.write`
- `chat.read` / `chat.write`

## Provider-scope direction

The application registry currently maps these capabilities as follows. Provider mappings must be revalidated against the live method-specific documentation before each service reaches production.

| Capability | Preferred provider scope | Sensitivity | Notes |
|---|---|---|---|
| Calendar event read | `calendar.events.readonly` | Sensitive | Avoid calendar-wide mutation rights for reads. |
| Calendar event write | `calendar.events` | Sensitive | Request only for event mutation features. |
| Calendar list read | `calendar.calendarlist.readonly` | Sensitive | Only needed for calendar discovery. |
| Calendar settings read | `calendar.settings.readonly` | Sensitive | Narrow settings access. |
| Tasks read | `tasks.readonly` | Sensitive | Read-only task access. |
| Tasks write | `tasks` | Sensitive | Full task management. |
| Docs read/write | `drive.file` where sufficient | Non-sensitive | Per-file access is preferred; use `documents` only when required. |
| Drive read/write | `drive.file` where sufficient | Non-sensitive | Preferred for files opened/created/used by the app. |
| Sheets read/write | `drive.file` where sufficient | Non-sensitive | Recommended by current Sheets documentation for per-file access. |
| Gmail read | `gmail.readonly` | Restricted | Production consumer-data access requires verification/compliance planning. |
| Gmail modify | `gmail.modify` | Restricted | Keep separate from send-only access. |
| Gmail send | `gmail.send` | Sensitive | Do not broaden to mailbox modification merely to send. |
| Chat read | `chat.messages.readonly` | Sensitive | Use exact method requirements. |
| Chat write | method-specific Chat write scope | Sensitive | Current API exposes granular scopes such as `chat.messages.create`; finalize per operation. |

Google's current scope catalogue confirms the current Calendar, Tasks, Drive, Docs, Sheets, and Gmail scope families. The Sheets documentation explicitly identifies `drive.file` as the recommended non-sensitive scope for per-file access; Gmail read/modify are restricted while `gmail.send` is sensitive. citeturn310254search1turn894622search1turn894622search0

Google's current Calendar documentation recommends the narrowest practical scope and exposes event-specific read/write scopes. citeturn310254search2

## Verification and least privilege

Google recommends incremental authorization and narrow scopes. Public applications using sensitive or restricted user-data scopes may require verification, and restricted scopes can create additional security-assessment requirements when data is stored or transmitted server-side. citeturn857498view0turn724229search1turn724229search10

## Incremental authorization rule

Do not request all Workspace permissions at startup merely because integrations exist.

A feature identifies its application capability key. The OAuth authority checks whether that capability is already granted. Only when the user has expressed intent to use the feature should the authority initiate a contextual authorization request for the missing capability, preserving previously granted permissions.

Refresh access silently using the stored server-side refresh credential where valid. User interaction is reserved for missing/revoked/invalid authorization or an explicit re-consent operation.

Google documents offline access through refresh tokens and recommends incremental authorization with `include_granted_scopes=true`. citeturn724229search0turn857498view0

## Non-goals

This registry does not store tokens, initiate redirects, perform token exchange, or execute Google APIs. Those remain owned by the OAuth authority and focused Workspace service boundaries.
