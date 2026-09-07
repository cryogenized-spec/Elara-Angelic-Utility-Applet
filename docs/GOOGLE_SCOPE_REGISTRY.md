# Google Scope Registry

This document defines Elara's single application-owned registry for Google OAuth capabilities. Pass 3 re-audits each capability against the exact provider methods used by the focused Workspace adapters.

## Ownership

Only the OAuth authority owns grant state and token acquisition. Feature modules request named capabilities from this registry; they do not hard-code consent flows.

## Registry rules

- Every provider scope has a stable application capability key, access level, sensitivity classification, and rationale.
- Features request the narrowest practical scope that satisfies the exact operation.
- Read-only and write-capable scopes remain distinct whenever Google exposes distinct scopes.
- Registry entries are application configuration, not user-controlled strings.
- Unknown capability keys are rejected before authorization.
- Tool schemas never contain OAuth scopes or tokens.
- A remembered local capability is not proof that the provider will still accept a request; provider authorization remains authoritative during token acquisition and API calls.

## Capability audit

| Capability | Provider methods currently using it | Provider scope | Sensitivity | Audit result |
|---|---|---|---|---|
| `calendar.events.read` | Calendar `events.list` | `calendar.events.readonly` | Sensitive | ✅ Narrow event-read scope is sufficient. |
| `calendar.events.write` | Reserved Calendar event mutations | `calendar.events` | Sensitive | ✅ Current Google `events.insert` accepts this scope. |
| `calendar.list.read` | Calendar list discovery boundary | `calendar.calendarlist.readonly` | Sensitive | ✅ Narrow scope; not required by the current basic event adapter. |
| `calendar.settings.read` | Calendar settings/time-zone boundary | `calendar.settings.readonly` | Sensitive | ✅ Narrow scope; request only when the corresponding feature is used. |
| `tasks.read` | `tasklists.list`, `tasks.list`, `tasks.get` | `tasks.readonly` | Sensitive | ✅ Read-only Tasks scope is sufficient. |
| `tasks.write` | `tasks.insert`, `tasks.update`, `tasks.delete`, `tasks.move`, `tasks.clear` | `tasks` | Sensitive | ✅ Full Tasks management scope is required. |
| `docs.read` | `documents.get` | `drive.file` | Non-sensitive | ✅ Current Docs `documents.get` accepts `drive.file`. |
| `docs.write` | `documents.create`, `documents.batchUpdate` | `drive.file` | Non-sensitive | ✅ Current Docs methods used by the adapter accept `drive.file`. |
| `drive.files.read` | Drive `files.list`, `files.get`, media download, export | `drive.file` | Non-sensitive | ✅ Suitable for per-file workflows; downloaded content itself still needs read permission. |
| `drive.files.write` | Drive `files.create`, `files.update` | `drive.file` | Non-sensitive | ✅ Suitable for app-created/opened files. |
| `sheets.read` | Spreadsheets metadata and values reads | `drive.file` | Non-sensitive | ✅ Suitable for selected/app-created spreadsheet workflows. |
| `sheets.write` | Values writes/appends and spreadsheet batch updates | `drive.file` | Non-sensitive | ✅ Suitable for selected/app-created spreadsheet workflows. |
| `gmail.read` | `users.messages.list/get`, `users.threads.list/get`, labels reads | `gmail.readonly` | Restricted | ✅ Read-only Gmail access. Production verification remains required where applicable. |
| `gmail.modify` | Message/thread modify, trash/untrash, label create/update/delete | `gmail.modify` | Restricted | ✅ Required for mailbox mutation operations used by the adapter. |
| `gmail.labels` | Reserved granular label capability | `gmail.labels` | Restricted | ✅ Dedicated label scope retained as an independently authorizable capability. |
| `gmail.send` | `users.messages.send` | `gmail.send` | Sensitive | ✅ Send-only scope keeps sending separate from mailbox modification. |
| `chat.read` | `spaces.messages.list/get` | `chat.messages.readonly` | Sensitive | ✅ Current user-authenticated message reads accept this scope. |
| `chat.write` | `spaces.messages.create/update/delete` | `chat.messages` | Sensitive | ✅ Replaced the earlier `chat.spaces` provisional mapping because these are message operations, not space-management operations. |

Google's current Calendar authorization guide recommends choosing the most narrowly focused scope possible and exposes event-specific, calendar-list, and settings scopes. The current Calendar `events.insert` reference explicitly accepts `calendar.events`. citeturn348059search0turn560705search5

Google's current Tasks documentation confirms `tasks.readonly` for viewing tasks and `tasks` for full task management. citeturn560705search9turn560705search0turn560705search4

Current Docs documentation confirms `documents.get` and `documents.create` accept `drive.file`. citeturn348059search1turn348059search9

Current Drive documentation exposes `drive.file` for per-file access and notes that downloading file content requires a scope permitting content reads. citeturn348059search7turn348059search3

Current Sheets authorization options include `drive.file` as well as spreadsheet-specific scopes; Elara remains on `drive.file` where its per-file workflow is sufficient. citeturn348059search4turn348059search6

Current Gmail message-list documentation accepts `gmail.readonly`, while the adapter's mutations use `gmail.modify` and sending uses `gmail.send`. citeturn560705search1

Current Google Chat documentation shows user-authenticated message creation uses `chat.messages.create` or `chat.messages`, message reads use `chat.messages.readonly`/`chat.messages`, and message update/delete use `chat.messages`. Elara therefore uses `chat.messages` for the combined Chat write capability rather than the broader `chat.spaces` scope. citeturn204511search2turn141205search6turn141205search0turn141205search1

## Incremental authorization rule

Do not request every Workspace permission when the application opens.

A feature identifies its capability key. The OAuth authority requests that capability's scope only when the user expresses intent to use the feature or a model-visible tool actually needs it. Previously granted capabilities are preserved through Google's incremental authorization support.

For the current static-browser architecture, capability metadata is remembered locally but access tokens are held only in memory. A later silent token request may fail when the provider requires interaction; that condition must become an explicit reauthorization state rather than a hidden loop.

## Verification and compliance

Google's production-readiness guidance requires the final consent configuration to match the exact scopes actually used and says apps should request only the scopes required by their features. Sensitive and restricted scopes can trigger verification requirements, and restricted data sent through a third-party server can carry additional security-assessment obligations. citeturn687686search8turn687686search1

## Non-goals

This registry does not store tokens, perform provider API calls, or expose universal Google HTTP access. The authority and focused service adapters own those responsibilities.
