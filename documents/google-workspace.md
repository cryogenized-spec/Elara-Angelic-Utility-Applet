---
id: SYS-GWS
status: active
verified_commit: 2113653bc007cbd8d3a877fd09a3242c163b8009
scope: Google Workspace service adapters and model tool execution
paths: [src/google/calendar, src/google/tasks, src/google/gmail, src/google/docs, src/google/drive, src/google/sheets, src/google/chat, src/google/tools, src/google/confirmation]
keywords: [workspace, calendar, tasks, gmail, docs, drive, sheets, tools, confirmation]
---

# Google Workspace and tool execution

## 1. Purpose and boundary

`SYS-GWS` owns validated Google Workspace service adapters, the executable model tool registry and confirmation of consequential operations. OAuth/token authority remains `SYS-GAUTH / google-auth.md`. The registry also contains a few application-local/non-Google tools; those tools' domain semantics belong to their owning system documents.

## 2. Runtime architecture

```text
Gemini function call
-> canonical tool registry descriptor
-> schema validation
-> capability check
-> confirmation when risk != read
-> service/local handler
-> normalized result
-> Gemini grouped continuation
```

The registry assigns each operation a capability, risk (`read|write|send|destructive`), exposure and optional execution plane. Declarations are generated from this executable registry rather than maintained as a second executable allow-list.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Tool registry | `src/google/tools/registry.ts` |
| Gemini declarations | `src/google/tools/gemini-declarations.ts` |
| Execution | `src/google/tools/executor.ts`, service handlers |
| Confirmation | `src/google/confirmation/broker.ts`, policy modules |
| Calendar | `src/google/calendar/` |
| Tasks | `src/google/tasks/` |
| Gmail | `src/google/gmail/` |
| Docs/Drive/Sheets | matching `src/google/*/` folders |
| Chat adapter | `src/google/chat/` |
| Shortcut UI | `src/app/components/WorkspaceMenu.tsx`, `WorkspaceShortcutSettings.tsx` |

## 4. Data and contracts

Gemini-visible Workspace operations cover Calendar discovery, event reads and guarded mutations, settings and free/busy; Tasks lists/tasks; Gmail message/thread/label/search/send/mutation operations; Docs inspect/create/edit; Drive app-file and optional library reads plus file mutations; Sheets reads/writes. `document.create_pdf`, Roleplay World tools and `youtube.search` share the generic registry but execute through their own systems.

Google Chat service code and scopes exist, but Chat tools are currently marked internal/deferred from Workspace v1 and are not advertised to Gemini. Internal primitives such as `docs.getDocument`, `docs.batchUpdate` and `sheets.batchUpdate` also remain non-Gemini-facing.

The shared confirmation broker supports single or grouped mutation approvals, explicit decline, approve-selected and approve-all controls. Cancellation fails closed.

Saved Workspace shortcuts are UI recipes, not hidden model instructions. Selecting one pre-fills visible, editable composer text; provider execution begins only after explicit user submit and then uses the ordinary registered tool surface. Stored shortcut tool names are configuration metadata and cannot bypass schema, capability, execution-plane or confirmation checks.

## 5. Calendar parity contract

Calendar is treated as Google's time-commitment authority; Elara does not mirror Calendar into a second local event database. The Gemini surface is intentionally bounded to `calendar.listCalendars`, `calendar.listEvents`, `calendar.getEvent`, `calendar.getSettings`, `calendar.queryFreeBusy`, `calendar.createEvent`, `calendar.updateEvent`, and `calendar.deleteEvent`.

Calendar-list access is discovery/target selection only. Elara does not subscribe/unsubscribe calendars, modify CalendarList metadata, create calendars, or edit ACLs in this pass. List discovery uses the dedicated read-only CalendarList capability. Settings and free/busy are separate optional read grants; free/busy can therefore answer availability questions without granting event-detail access.

Event reads preserve provider identity required for later safe actions: event id plus ETag, recurrence, attendees, organizer/creator metadata, timing/timezone and relevant status fields. Update and delete require the current ETag returned by a prior read and send it as `If-Match`. A `412` conflict is surfaced as a read-again requirement instead of overwriting a newer Calendar version.

Creates and updates support timed or all-day events, location, description, attendees and recurrence. Recurrence lines are bounded RFC-style `RRULE`/`EXRULE`/`RDATE`/`EXDATE` entries; `DTSTART`/`DTEND` belong in the event start/end fields. Recurring date-time creates require an explicit IANA timezone. Attendee/recurrence arrays are complete replacement arrays when supplied to an update.

Guest notification control exposes only `sendUpdates=all|externalOnly`. `sendUpdates=none` is intentionally not model-visible because Calendar documents it primarily for migration-style use and warns that suppressing updates can cause synchronization problems. Omitting `sendUpdates` leaves provider default behavior untouched.

Create idempotency uses the provider function-call id already carried through the Gemini tool loop. The service hashes that call id into a Google-valid deterministic event id. If a retry receives `409 Already Exists`, Elara reads and returns that exact event instead of creating a duplicate. This is a retry mechanism, not a local event identity authority.

Calendar event writes use the scoped event-write capability and still pass through normal confirmation. `calendar.createEvent` and `calendar.updateEvent` are `write`; `calendar.deleteEvent` is `destructive`. OAuth permission never substitutes for mutation confirmation.

## 6. Invariants

- Model-visible declarations derive from the executable registry; no shadow executable allow-list.
- `additionalProperties:false` and service schemas reject undeclared arguments.
- Reads may execute when authorized; write/send/destructive operations require confirmation.
- Confirmation is separate from OAuth: permission to call an API is not consent to mutate data.
- Tool schemas never contain credentials, raw scopes or provider URLs.
- Browser/worker execution-plane filtering is explicit; browser-only tools are not silently advertised by the Worker.
- Workspace shortcuts never create hidden synthetic user turns.
- Calendar provider scopes do not manufacture local Elara capabilities.
- Calendar update/delete require a provider ETag and use conditional mutation.
- Calendar create retry identity derives from the existing provider call id; ambiguous retries do not intentionally create a second event.
- Calendar list/settings/free-busy remain optional capabilities and do not broaden the core Calendar event grant.

## 7. Security and failure semantics

Arguments are validated before execution, OAuth capabilities are checked centrally, and mutation confirmations summarize the target without leaking secrets. Handler/provider failures are normalized before returning to Gemini. If confirmation UI is unavailable, already busy or aborted, mutations resolve as denied rather than auto-approved.

Calendar mutation conflicts fail closed. Oversized inputs, invalid recurrence/time pairs, more than 50 free/busy targets and undeclared arguments are rejected before provider execution. Calendar API targets still flow through the Google OAuth request broker's HTTPS/host allow-list.

## 8. Verification and tests

Use service contract tests, `src/google/tools/*test*`, Gemini declaration tests, confirmation broker/policy tests and integration/E2E flows. Calendar service tests cover discovery, filters/pagination, detailed ETag reads, settings, free/busy, recurrence/timezone, guest updates, deterministic create retry recovery and conditional PATCH/DELETE. `calendar-parity.test.ts` pins registry risk/capabilities, schemas, handler call-id propagation and confirmation summaries.

`e2e/workspace-shortcuts.spec.ts` verifies visible shortcut drafting and explicit submission. The reliability gate continues to lock key invariants including Calendar write capability, grouped confirmations, registry-derived declarations and explicit accessibility controls.

## 9. Known gaps

Google Chat remains deferred from the Gemini surface. Calendar push/watch synchronization, ACL/calendar administration and CalendarList mutations are deliberately outside Pass 1. Any future orchestration/Kanban layer should consume these normalized service/tool boundaries rather than embedding Google API logic or OAuth state in UI components.
