---
id: SYS-GWS
status: active
verified_commit: 6491db45e1b79f34cfe93c8d1a8581cce318a247
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

Gemini-visible Workspace operations cover Calendar discovery, event reads and guarded mutations, settings and free/busy; Tasks list/task discovery plus guarded list/task mutations; Gmail message/thread/label/search/send/mutation operations; Docs inspect/create/edit; Drive app-file and optional library reads plus file mutations; Sheets reads/writes. `document.create_pdf`, Roleplay World tools and `youtube.search` share the generic registry but execute through their own systems.

Google Chat service code and scopes exist, but Chat tools are currently marked internal/deferred from Workspace v1 and are not advertised to Gemini. Internal primitives such as `docs.getDocument`, `docs.batchUpdate` and `sheets.batchUpdate` also remain non-Gemini-facing.

The shared confirmation broker supports single or grouped mutation approvals, explicit decline, approve-selected and approve-all controls. Cancellation fails closed.

Saved Workspace shortcuts are UI recipes, not hidden model instructions. Selecting one pre-fills visible, editable composer text; provider execution begins only after explicit user submit and then uses the ordinary registered tool surface. Stored shortcut tool names are configuration metadata and cannot bypass schema, capability, execution-plane or confirmation checks.

## 5. Calendar parity contract

Calendar is treated as Google's time-commitment authority; Elara does not mirror Calendar into a second local event database. The Gemini surface is intentionally bounded to `calendar.listCalendars`, `calendar.listEvents`, `calendar.getEvent`, `calendar.getSettings`, `calendar.queryFreeBusy`, `calendar.createEvent`, `calendar.updateEvent`, and `calendar.deleteEvent`.

Calendar-list access is discovery/target selection only. Elara does not subscribe/unsubscribe calendars, modify CalendarList metadata, create calendars, or edit ACLs in this pass. List discovery uses the dedicated read-only CalendarList capability. Settings and free/busy are separate optional read grants; free/busy can therefore answer availability questions without granting event-detail access.

Event reads preserve provider identity required for later safe actions: event id plus ETag, recurrence, attendees, organizer/creator metadata, timing/timezone and relevant status fields. Update and delete require one concrete provider ETag returned by a prior read and send it as `If-Match`. Wildcard (`*`), multi-value or malformed validators are rejected before write authorization, so stale-read protection cannot be bypassed. A `412` conflict is surfaced as a read-again requirement instead of overwriting a newer Calendar version.

Creates and updates support timed or all-day events, location, description, attendees and recurrence. Recurrence lines are bounded RFC-style `RRULE`/`EXRULE`/`RDATE`/`EXDATE` entries; `DTSTART`/`DTEND` belong in the event start/end fields. Recurring date-time creates require an explicit IANA timezone. A non-empty recurrence update must also carry explicit start and end boundaries; timed recurrence updates require an explicit timezone, while all-day recurrence may use date boundaries without one. Any update that changes event timing must carry both start and end together, so validation can preserve a coherent all-day/timed and offset/timezone mode before confirmation rather than relying on an unknown untouched counterpart. Attendee/recurrence arrays are complete replacement arrays when supplied to an update.

Calendar timezone strings are validated against the runtime IANA timezone database before OAuth/provider access. A length-valid string is not sufficient. Event date-times may omit a numeric/UTC offset only when an explicit valid IANA event timezone accompanies them. Timed start/end boundaries must use the same timing mode: both carry explicit offsets or both are timezone-relative under the explicit event timezone. Calendar list-event bounds and free/busy bounds are stricter: they must be offset-bearing RFC 3339 timestamps so validation and ordering never depend on the browser's local timezone.

Calendar dates and date-times are component-validated rather than trusted to JavaScript's rollover-prone parser. Impossible dates such as February 30, invalid clock components and invalid offset components are rejected locally; leap-day validity is checked using Gregorian leap-year rules. `Date.parse` is used only after those structural/calendar checks for ordering valid timestamps.

Guest notification control exposes only `sendUpdates=all|externalOnly`. `sendUpdates=none` is intentionally not model-visible because Calendar documents it primarily for migration-style use and warns that suppressing updates can cause synchronization problems. Omitting `sendUpdates` leaves provider default behavior untouched.

Create idempotency uses the provider function-call id already carried through the Gemini tool loop. The service hashes that call id into a Google-valid deterministic event id. If a retry receives `409 Already Exists`, Elara reads and returns that exact event instead of creating a duplicate. This is a retry mechanism, not a local event identity authority.

Calendar event writes use the scoped event-write capability and still pass through normal confirmation. `calendar.createEvent` and `calendar.updateEvent` are `write`; `calendar.deleteEvent` is `destructive`. OAuth permission never substitutes for mutation confirmation.

## 6. Tasks parity contract

Google Tasks remains the task-data authority; Elara does not mirror provider task state into a second task database. Pass 2 exposes `tasks.listTaskLists`, `tasks.getTaskList`, `tasks.listTasks`, `tasks.getTask`, `tasks.createTaskList`, `tasks.updateTaskList`, `tasks.deleteTaskList`, `tasks.createTask`, `tasks.updateTask`, `tasks.moveTask`, `tasks.deleteTask`, and `tasks.clearCompleted`.

Task-list reads support provider pagination with a maximum of 100 lists per page. Task reads support provider pagination with a maximum of 100 tasks per page plus completed/deleted/hidden filters, RFC 3339 provider filter bounds, and explicit `showAssigned`. Assigned tasks from Docs/Chat are not silently widened into ordinary reads: `showAssigned` must be requested. Returned tasks preserve hierarchy, position, completion state, links, web UI link and assignment origin metadata where Google supplies it.

Google's provider field named `due` is not a timed deadline. The Tasks API retains only its calendar date and discards time-of-day. Elara therefore normalizes it to `scheduledDate: YYYY-MM-DD` at the model/service boundary. Creates and updates accept only a real date-only `scheduledDate`; the adapter serializes it as midnight UTC solely because Google requires an RFC 3339 provider representation. Gemini is never told that midnight is a meaningful deadline. `clearScheduledDate` removes that date. Timed strings are rejected before OAuth/provider execution.

Task creation exposes only bounded semantic fields: list id, title, notes, optional `scheduledDate`, optional parent id and optional previous-sibling id. Task updates are PATCH-style and may change only title, notes, scheduled date/removal or `needsAction|completed` status. Raw Task resources, read-only flags, assignment metadata and provider output fields are not model-writable. Task-list mutations similarly expose only the list id/title semantics needed for create/rename/delete.

Hierarchy changes use Google's dedicated move endpoint. Supplying `parent` nests under that task; omitting `parent` moves to the top level. Supplying `previous` places after that sibling; omitting `previous` places first among destination siblings. Confirmation text states these omission semantics rather than presenting an ambiguous generic move.

Assigned-task deletion has a cross-surface consequence: when Google considers a task assigned from Docs or Chat, `tasks.delete` can delete both the assigned task and the originating assignment. Elara therefore preserves assignment-origin metadata on reads and the destructive confirmation warns about the Docs/Chat consequence. Task-list deletion uses the same conservative warning because a deleted list may contain assigned tasks whose originating Docs/Chat assignments can also be removed. The confirmation does not claim that Elara pre-read every task in the list. Deleting only the assigned copy is not represented as an API tool because Google requires unassignment at the originating surface for that behavior.

`tasks.clearCompleted` follows Google's actual semantics: completed tasks are marked hidden and stop appearing in normal list results; they are not represented to the user as hard-deleted. The operation remains `destructive` because it is a bulk visibility/state change. `tasks.deleteTaskList`, `tasks.deleteTask`, and `tasks.clearCompleted` are destructive; create/update/move operations are writes. Every mutation still crosses the ordinary confirmation broker after schema and OAuth capability validation.

Tasks does not expose a task time-of-day through this API contract. Elara must not infer reminders, timed deadlines, recurring-task rules or other first-party UI behavior that is absent from the API surface. Calendar remains the correct authority for actual timed commitments.

## 7. Invariants

- Model-visible declarations derive from the executable registry; no shadow executable allow-list.
- `additionalProperties:false` and service schemas reject undeclared arguments.
- Reads may execute when authorized; write/send/destructive operations require confirmation.
- Confirmation is separate from OAuth: permission to call an API is not consent to mutate data.
- Tool schemas never contain credentials, raw scopes or provider URLs.
- Browser/worker execution-plane filtering is explicit; browser-only tools are not silently advertised by the Worker.
- Workspace shortcuts never create hidden synthetic user turns.
- Calendar provider scopes do not manufacture local Elara capabilities.
- Calendar update/delete require one concrete provider ETag; wildcard/multi-value validators are forbidden and mutation uses conditional `If-Match`.
- Any Calendar timing update carries both start and end boundaries; one-sided timing patches are rejected before confirmation and provider authorization.
- Non-empty Calendar recurrence updates carry explicit start/end context; timed recurrence carries an explicit valid IANA timezone.
- Calendar timezone inputs are validated against the runtime IANA timezone database before provider access.
- Calendar dates/date-times reject impossible calendar and clock components instead of accepting JavaScript rollover normalization.
- Offset-free event date-times require an explicit valid IANA event timezone; timed boundary pairs use one consistent offset/timezone mode; list/free-busy bounds always carry explicit UTC offsets.
- Calendar create retry identity derives from the existing provider call id; ambiguous retries do not intentionally create a second event.
- Calendar list/settings/free-busy remain optional capabilities and do not broaden the core Calendar event grant.
- Tasks scheduling is date-only at the model boundary; provider midnight is serialization, never time semantics.
- Task-list and task page bounds are 100 and agree across service, schemas, Gemini declarations, tests and this contract.
- Raw Google Task/TaskList resources are not Gemini mutation inputs.
- Assigned-task visibility is opt-in and assignment origin remains read-only metadata.
- Task hierarchy moves state the provider meaning of omitted parent/previous before confirmation.
- Assigned-task deletion, including deletion through a containing task list, warns that Docs/Chat source assignments may also be deleted.
- Clearing completed tasks is represented as Google's hidden-task transition, not as fabricated hard deletion.

## 8. Security and failure semantics

Arguments are validated before execution, OAuth capabilities are checked centrally, and mutation confirmations summarize the target without leaking secrets. Handler/provider failures are normalized before returning to Gemini. If confirmation UI is unavailable, already busy or aborted, mutations resolve as denied rather than auto-approved.

Calendar mutation conflicts fail closed. Invalid/non-concrete ETags, one-sided timing updates, invalid IANA timezones, impossible dates/times, offset-ambiguous timestamps, incomplete recurrence conversion, oversized inputs, invalid recurrence/time pairs, more than 50 free/busy targets and undeclared arguments are rejected before provider execution. Calendar API targets still flow through the Google OAuth request broker's HTTPS/host allow-list.

Tasks rejects malformed ids/page tokens, page sizes beyond provider limits, invalid RFC 3339 filter bounds, impossible/timed `scheduledDate` values, empty semantic updates, conflicting set/clear date requests and undeclared raw provider fields before provider execution. Tasks API targets use the same Google OAuth request broker/host allow-list. OAuth `tasks.write` permission does not bypass confirmation.

## 9. Verification and tests

Use service contract tests, `src/google/tools/*test*`, Gemini declaration tests, confirmation broker/policy tests and integration/E2E flows. Calendar service tests cover discovery, filters/pagination, detailed ETag reads, settings, free/busy, recurrence/timezone, guest updates, deterministic create retry recovery and conditional PATCH/DELETE. `calendar-parity.test.ts` pins registry risk/capabilities, schemas, handler call-id propagation and confirmation summaries. `recurring-update-timezone.test.ts` and `provider-boundary-hardening.test.ts` pin recurrence conversion, concrete ETags, offset/timezone requirements and direct-service fail-closed behavior before authorization. `date-zone-validation.test.ts` pins valid-IANA enforcement, impossible-date rejection, leap-day acceptance, paired timing updates and consistent offset/timezone boundary semantics.

Tasks service tests pin task-list pagination/parity at the provider's 100-item bound, assignment metadata, explicit `showAssigned`, provider-filter forwarding, date-only provider conversion, invalid scheduled-date fail-closed behavior, semantic PATCH updates and move omission behavior. `tasks-parity.test.ts` pins registry risk/capabilities, semantic-vs-raw schemas, the 101-item rejection boundary, Gemini declaration parity and consequence-aware confirmations for task/list deletion, bulk clear and hierarchy moves.

`e2e/workspace-shortcuts.spec.ts` verifies visible shortcut drafting and explicit submission. The reliability gate continues to lock key invariants including Calendar/Tasks write capability, grouped confirmations, registry-derived declarations and explicit accessibility controls.

## 10. Known gaps

Google Chat remains deferred from the Gemini surface. Calendar push/watch synchronization, ACL/calendar administration and CalendarList mutations are deliberately outside Pass 1. Google Tasks time-of-day scheduling/reminders and recurring-task UI semantics are not invented because the Tasks API surface used here does not provide them. Any future orchestration/Kanban layer should consume these normalized service/tool boundaries rather than embedding Google API logic or OAuth state in UI components.
