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

Drive metadata mutation has one semantic model shape: `drive.updateFile({fileId, patch:{...}})`. The model-visible patch is limited to `name`, `description`, and `starred`; trashing is deliberately absent from this ordinary-write metadata tool. The handler consumes the nested patch exactly and a second flat metadata shape is not accepted. Trashing is exposed only through dedicated `drive.trashFile({fileId, etag})`, which requires the strong ETag just read, uses Drive's recoverable trash state, and has no permanent-delete companion.

Gemini-visible `sheets.updateCell` and `sheets.insertRows` both have executable service handlers. `sheets.updateCell` requires one explicit single-cell A1 target (optionally sheet-qualified and/or absolute with `$`) plus a bounded string value; ranges, whole rows/columns and named ranges are rejected before confirmation. The confirmation identifies the spreadsheet and exact cell and exposes the full cell input in scroll-bounded review text. `sheets.insertRows` confirms spreadsheet, sheet id, start index and count, executes through the existing service primitive, then returns only a bounded semantic `{inserted, spreadsheetId, sheetId, startIndex, count}` result instead of forwarding the raw provider batch-update payload to Gemini.

The shared confirmation broker supports single or grouped mutation approvals, explicit decline, approve-selected and approve-all controls. Cancellation fails closed.

Saved Workspace shortcuts are UI recipes, not hidden model instructions. Selecting one pre-fills visible, editable composer text; provider execution begins only after explicit user submit and then uses the ordinary registered tool surface. Stored shortcut tool names are configuration metadata and cannot bypass schema, capability, execution-plane or confirmation checks.

## 5. Calendar parity contract

Calendar is treated as Google's time-commitment authority; Elara does not mirror Calendar into a second local event database. The Gemini surface is intentionally bounded to `calendar.listCalendars`, `calendar.listEvents`, `calendar.getEvent`, `calendar.getSettings`, `calendar.queryFreeBusy`, `calendar.createEvent`, `calendar.updateEvent`, and `calendar.deleteEvent`.

Calendar-list access is discovery/target selection only. Elara does not subscribe/unsubscribe calendars, modify CalendarList metadata, create calendars, or edit ACLs in this pass. List discovery uses the dedicated read-only CalendarList capability. Settings and free/busy are separate optional read grants; free/busy can therefore answer availability questions without granting event-detail access. Calendar list/event pagination tokens are bounded to 2,048 characters at the semantic boundary, matching the service boundary.

Event reads preserve provider identity required for later safe actions: event id plus ETag, recurrence, attendees, organizer/creator metadata, timing/timezone and relevant status fields. Update and delete require one concrete strong provider ETag returned by a prior read and send it as `If-Match`. Wildcard (`*`), weak, multi-value or malformed validators are rejected both by the model-facing mutation boundary and by the Calendar service's conditional-write boundary before OAuth/provider access. A `412` conflict is surfaced as a read-again requirement instead of overwriting a newer Calendar version.

Creates and updates support timed or all-day events, location, description, attendees and recurrence. Start/end ordering is validated before confirmation and provider authorization: `end` must be later than `start`. Calendar defines event end as exclusive. For an all-day event this means a one-day event that starts on `YYYY-MM-DD` ends on the following date, not the same date. Gemini-visible descriptions state that exclusive-end rule. Recurrence lines are bounded RFC-style `RRULE`/`EXRULE`/`RDATE`/`EXDATE` entries; `DTSTART`/`DTEND` belong in the event start/end fields. Recurring date-time creates require an explicit IANA timezone. A non-empty recurrence update must also carry explicit start and end boundaries; timed recurrence updates require an explicit timezone, while all-day recurrence may use date boundaries without one. Any update that changes event timing must carry both start and end together, so validation can preserve a coherent all-day/timed and offset/timezone mode before confirmation rather than relying on an unknown untouched counterpart. Attendee/recurrence arrays are complete replacement arrays when supplied to an update.

Calendar timezone strings are validated against the runtime IANA timezone database before OAuth/provider access. A length-valid string is not sufficient. Event date-times may omit a numeric/UTC offset only when an explicit valid IANA event timezone accompanies them. Timed start/end boundaries must use the same timing mode: both carry explicit offsets or both are timezone-relative under the explicit event timezone. Calendar list-event bounds and free/busy bounds are stricter: they must be offset-bearing RFC 3339 timestamps so validation and ordering never depend on the browser's local timezone.

Calendar dates and date-times are component-validated rather than trusted to JavaScript's rollover-prone parser. Impossible dates such as February 30, invalid clock components and invalid offset components are rejected locally; leap-day validity is checked using Gregorian leap-year rules. `Date.parse` is used only after those structural/calendar checks for ordering valid timestamps.

Guest notification control exposes only `sendUpdates=all|externalOnly`. `sendUpdates=none` is intentionally not model-visible because Calendar documents it primarily for migration-style use and warns that suppressing updates can cause synchronization problems. Omitting `sendUpdates` leaves provider default behavior untouched.

Create idempotency uses the provider function-call id already carried through the Gemini tool loop. The service hashes that call id into a Google-valid deterministic event id. If a retry receives `409 Already Exists`, Elara reads and returns that exact event instead of creating a duplicate. This is a retry mechanism, not a local event identity authority.

Calendar event writes use the scoped event-write capability and still pass through normal confirmation. `calendar.createEvent` and `calendar.updateEvent` are `write`; `calendar.deleteEvent` is `destructive`. OAuth permission never substitutes for mutation confirmation.

## 6. Tasks parity contract

Google Tasks remains the task-data authority; Elara does not mirror provider task state into a second task database. Pass 2 exposes `tasks.listTaskLists`, `tasks.getTaskList`, `tasks.listTasks`, `tasks.getTask`, `tasks.createTaskList`, `tasks.updateTaskList`, `tasks.deleteTaskList`, `tasks.createTask`, `tasks.updateTask`, `tasks.moveTask`, `tasks.deleteTask`, and `tasks.clearCompleted`.

Task-list reads support provider pagination with a maximum of 100 lists per page. Task reads support provider pagination with a maximum of 100 tasks per page plus completed/deleted/hidden filters, RFC 3339 provider filter bounds, and explicit `showAssigned`. Assigned tasks from Docs/Chat are not silently widened into ordinary reads: `showAssigned` must be requested. Returned tasks preserve hierarchy, position, completion state, links, web UI link and assignment origin metadata where Google supplies it.

Google's provider field named `due` is not a timed deadline. The Tasks API retains only its calendar date and discards time-of-day. Elara therefore normalizes it to `scheduledDate: YYYY-MM-DD` at the model/service boundary. Creates and updates accept only a real date-only `scheduledDate`; the adapter serializes it as midnight UTC solely because Google requires an RFC 3339 provider representation. Gemini is never told that midnight is a meaningful deadline. `clearScheduledDate` removes that date. Timed strings are rejected before OAuth/provider execution. When reading an existing provider `due`, Elara preserves the provider's literal calendar-date component instead of timezone-shifting it into a different date.

Task creation exposes only bounded semantic fields: list id, title, notes, optional `scheduledDate`, optional parent id and optional previous-sibling id. Task updates are PATCH-style and may change only title, notes, scheduled date/removal or `needsAction|completed` status. Raw Task resources, read-only flags, assignment metadata and provider output fields are not model-writable. Task-list mutations similarly expose only the list id/title semantics needed for create/rename/delete.

Google Tasks does not accept a client-chosen task or task-list id for create. Elara therefore cannot provide Calendar-style cross-restart idempotency for an ambiguous create. Instead, task and task-list creates use a bounded in-memory same-call replay fence keyed by tool + conversation + user message + generation + Gemini call id, with a hash of the validated create payload. Replaying that exact call within the same live runtime returns the same promise/result (or same ambiguous failure) and does not issue a second provider POST. Reusing one call id with changed arguments fails closed. A distinct Gemini call id is never deduplicated by title/content, so the user can intentionally create two identical tasks. A full page/runtime restart after an ambiguous provider acceptance remains an explicit provider limitation rather than a fabricated local identity guarantee.

Hierarchy changes use Google's dedicated move endpoint. Supplying `parent` nests under that task; omitting `parent` moves to the top level. Supplying `previous` places after that sibling; omitting `previous` places first among destination siblings. `destinationTaskListId` optionally moves the task into a different task list and is translated only at the provider boundary to Google's `destinationTasklist` query parameter; omitting it keeps the task in its current list. When a destination list is supplied, `parent` and `previous` describe placement in that destination list. Unsupported provider combinations are returned as normalized provider failures rather than fabricated locally. Confirmation text states the source/destination list and hierarchy omission semantics instead of presenting an ambiguous generic move.

Assigned-task deletion has a cross-surface consequence: when Google considers a task assigned from Docs or Chat, `tasks.delete` can delete both the assigned task and the originating assignment. Elara therefore preserves assignment-origin metadata on reads and the destructive confirmation warns about the Docs/Chat consequence. Task-list deletion uses the same conservative warning because a deleted list may contain assigned tasks whose originating Docs/Chat assignments can also be removed. The confirmation does not claim that Elara pre-read every task in the list. Deleting only the assigned copy is not represented as an API tool because Google requires unassignment at the originating surface for that behavior.

`tasks.clearCompleted` follows Google's actual semantics: completed tasks are marked hidden and stop appearing in normal list results; they are not represented to the user as hard-deleted. The operation remains `destructive` because it is a bulk visibility/state change. `tasks.deleteTaskList`, `tasks.deleteTask`, and `tasks.clearCompleted` are destructive; create/update/move operations are writes. Every mutation still crosses the ordinary confirmation broker after schema and OAuth capability validation.

Tasks does not expose a task time-of-day through this API contract. Elara must not infer reminders, timed deadlines, recurring-task rules or other first-party UI behavior that is absent from the API surface. Calendar remains the correct authority for actual timed commitments.

## 7. Drive parity contract

Drive remains Google's file authority; Elara keeps no second Drive catalogue. This contract exposes `drive.searchFiles` (app-file capability), `drive.searchLibrary` (separate, sensitive library-read consent) and `drive.getFile` as reads, plus `drive.downloadFile`, which copies one file into a local artifact instead of returning bytes to the model.

Every Drive read asks for one shared projection: id, name, MIME type, modified/created time, web-view link, parents, size, starred, description, trashed state, the provider ETag a later conditional mutation needs, and `capabilities.canDownload`. Provider `size` is text and is parsed to a bounded number; an unparseable value stays unknown rather than being guessed, because both the transfer ceiling and the artifact record read it. Every provider-supplied field in that projection is bounded at the service boundary — name, description, timestamps, ETag text and the number of parents — so a hostile or malformed provider response cannot grow the model-visible result. Two fields are governed by truth rather than truncation: an oversized or non-HTTPS link is dropped instead of cut into a broken URL the user could click, and an implausible MIME type falls back to the generic binary type instead of being cut into a wrong classification.

Drive returns trashed files like live ones, so both search tools scope queries with `trashed = false` unless the caller sets `showTrashed` or writes an explicit `trashed` predicate in `q`, which is honored verbatim. Free-form query text and pagination tokens are bounded at the service boundary as well as in the schema, so a direct caller cannot widen the model contract.

`drive.downloadFile` bounds MIME and size before the media read: Google Docs editors files (which require export rather than `alt=media`) and files the provider reports as non-downloadable are refused, a provider-declared size above the transfer ceiling is refused before any media request, and a response whose declared length or actual body exceeds the ceiling is refused mid-transfer. Transfers carry the turn's abort signal. The ceiling is `DRIVE_LIMITS.maxTransferBytes` (10 MiB) in one place shared by the service, the model argument schema and the Gemini declaration; `maxBytes` may lower that ceiling, never raise it.

A download is conversation-scoped: it exists to put a file into a conversation, so a headless (unattended routine) run without one is refused with a bounded failure rather than writing an orphaned local artifact.

File bytes never reach the model. A successful download is persisted as a local `attachment` artifact (provenance `derived_transformation`, kind classified from MIME type rather than from the file name) and the tool returns only `{artifactId, status, mimeType, name, size, webViewLink?, operationId}` — the same bounded artifact projection `document.create_pdf` already uses, so the conversation surfaces a card. The lifecycle is guarded: the artifact is created in `processing`, given an operation id, and commits `ready` only while the generation is still live. A superseded or cancelled turn marks it `failed` with a typed reason (`FILE_TOO_LARGE`, `UNSUPPORTED_FILE`, `DRIVE_DOWNLOAD_FAILED`, `ARTIFACT_OPERATION_STALE`) instead of publishing stale bytes, and failures are returned as bounded results so the model learns why rather than receiving an opaque provider error.

Write parity is conditional. `drive.updateFile`, `drive.moveFile` and `drive.trashFile` each require one concrete strong ETag read from `drive.getFile` or `drive.searchFiles` and send it as `If-Match`; the validator is checked before any authorization or provider request, so an invalid precondition fails closed without asking for provider authority; weak (`W/"…"`), wildcard (`*`), multi-value and empty validators are refused at the service boundary before any request, and a provider 412 becomes a bounded "read the file again before retrying" failure instead of a silent retry. Moves state their parent consequence: adding a parent without `previousParentId` leaves the file in its current folder, because Drive files may have several parents. Trashing is its own destructive, confirmed tool and is the model-visible end state — Elara never permanently deletes a Drive file, and the ordinary metadata update tool cannot trash.

`drive.createFile` carries the same same-call replay fence pattern as Gmail/Tasks: replay state is isolated by elected turn plus call id and signed by the exact `(name, mimeType, parents)` payload the call was elected with, so a stale generation cannot clear a newer live turn's fence, a replayed call returns the first result instead of issuing a second create, and a replayed call id whose arguments changed fails closed. Drive accepts no client-chosen file id in this contract, so an ambiguous create after a full runtime restart is not hidden behind content deduplication.

`drive.exportFile` stays a service primitive and is not model-visible; Docs/Sheets export semantics belong to their own passes. Drive tools are browser-plane only, because the Worker has no Drive service or handler and must not advertise one.

## 8. Invariants

- Model-visible declarations derive from the executable registry; no shadow executable allow-list.
- `additionalProperties:false` and service schemas reject undeclared arguments.
- Reads may execute when authorized; write/send/destructive operations require confirmation.
- Confirmation is separate from OAuth: permission to call an API is not consent to mutate data.
- Tool schemas never contain credentials, raw scopes or provider URLs.
- Browser/worker execution-plane filtering is explicit; browser-only tools are not silently advertised by the Worker.
- Workspace shortcuts never create hidden synthetic user turns.
- Calendar provider scopes do not manufacture local Elara capabilities.
- Calendar model mutations and the service conditional-write boundary require one concrete strong provider ETag; wildcard/weak/multi-value validators are forbidden and mutation uses conditional `If-Match`.
- Calendar start/end ordering is rejected before confirmation; event end is exclusive and one-day all-day events use the following date as `end`.
- Any Calendar timing update carries both start and end boundaries; one-sided timing patches are rejected before confirmation and provider authorization.
- Non-empty Calendar recurrence updates carry explicit start/end context; timed recurrence carries an explicit valid IANA timezone.
- Calendar timezone inputs are validated against the runtime IANA timezone database before provider access.
- Calendar dates/date-times reject impossible calendar and clock components instead of accepting JavaScript rollover normalization.
- Offset-free event date-times require an explicit valid IANA event timezone; timed boundary pairs use one consistent offset/timezone mode; list/free-busy bounds always carry explicit UTC offsets.
- Calendar list/event page tokens are bounded to 2,048 characters consistently with the service boundary.
- Calendar create retry identity derives from the existing provider call id; ambiguous retries do not intentionally create a second event.
- Calendar list/settings/free-busy remain optional capabilities and do not broaden the core Calendar event grant.
- Tasks scheduling is date-only at the model boundary; provider midnight is serialization, never time semantics.
- Task-list and task page bounds are 100 and agree across service, schemas, Gemini declarations, tests and this contract.
- Raw Google Task/TaskList resources are not Gemini mutation inputs.
- Assigned-task visibility is opt-in and assignment origin remains read-only metadata.
- Task creates are replay-fenced only for the exact same Gemini call in the same live elected turn; distinct call ids are never content-deduplicated.
- Task moves may stay within one list or use semantic `destinationTaskListId` for a cross-list provider move; raw `destinationTasklist` is not a model input.
- Task hierarchy moves state the source/destination list and provider meaning of omitted parent/previous before confirmation.
- Assigned-task deletion, including deletion through a containing task list, warns that Docs/Chat source assignments may also be deleted.
- Clearing completed tasks is represented as Google's hidden-task transition, not as fabricated hard deletion.
- Drive reads share one projection: provider ETag, size, starred/description state, created time, trashed state and `canDownload`; a later mutation never has to re-derive provider identity from a narrower read.
- Drive searches exclude trashed files by default; `showTrashed` or an explicit `trashed` predicate is the only way to include them, and a quoted literal (a file name that merely mentions the word) never counts as that predicate.
- Drive transfers are bounded before and during the media read, carry the turn's abort signal, and never return file bytes to the model: bytes live in a local artifact and the tool result carries bounded metadata only.
- A Drive download artifact commits `ready` only while its generation is live; supersession or cancellation leaves a failed artifact with a typed reason, never stale ready bytes.
- A Drive download is scoped to an open conversation; a headless routine run is refused instead of materializing an unattached artifact.
- Drive tools are browser-plane only; the Worker has no Drive handler and never advertises them.
- Every Drive mutation is conditional on one concrete strong ETag; the validator is validated before authorization, a weak, wildcard, multi-value, oversized or empty validator never reaches the provider, and a rejected write tells the model to read the file again rather than retrying blindly.
- Drive provider fields entering a tool result are bounded (name, description, timestamps, ETag text, parent count), so one hostile response cannot inflate the model-visible payload; a link is dropped rather than truncated and an implausible MIME type falls back to generic binary rather than becoming a wrong classification.
- Trashing is an explicit recoverable tool; permanent deletion is absent from the executable surface and the Drive adapter sends no file DELETE.
- A replayed `drive.createFile` call id returns the first result instead of creating a second file, changed arguments under the same call id fail closed, and two concurrent copies of one call id still collapse into a single create.
- Drive metadata update has one nested `patch` argument contract from declaration through handler; the model-visible patch cannot trash a file.
- Gemini-visible `sheets.updateCell`/`sheets.insertRows` have executable handlers; single-cell writes require one A1 cell and an explicit bounded string, confirmations expose exact targets, and row insertion returns a bounded semantic result instead of raw provider batch output.

## 9. Security and failure semantics

Arguments are validated before execution, OAuth capabilities are checked centrally, and mutation confirmations summarize the exact target without leaking secrets. Handler/provider failures are normalized before returning to Gemini. If confirmation UI is unavailable, already busy or aborted, mutations resolve as denied rather than auto-approved.

Calendar mutation conflicts fail closed. Invalid/non-concrete/weak ETags, one-sided timing updates, non-increasing start/end boundaries, invalid IANA timezones, impossible dates/times, offset-ambiguous timestamps, incomplete recurrence conversion, oversized inputs, invalid recurrence/time pairs, more than 50 free/busy targets and undeclared arguments are rejected before provider execution. Strong ETag enforcement is repeated at the Calendar service's conditional-write boundary so direct service callers cannot widen the model contract. Calendar API targets still flow through the Google OAuth request broker's HTTPS/host allow-list.

Tasks rejects malformed ids/page tokens, page sizes beyond provider limits, invalid RFC 3339 filter bounds, impossible/timed `scheduledDate` values, empty semantic updates, conflicting set/clear date requests, undeclared raw provider fields and invalid move identifiers before provider execution. Tasks API targets use the same Google OAuth request broker/host allow-list. OAuth `tasks.write` permission does not bypass confirmation. Same-live-runtime create replays are fail-closed on payload mismatch; provider ambiguity across a full runtime restart is not hidden behind heuristic content deduplication.

Drive reads remain strict. Query text, page tokens and download ceilings are bounded at the model boundary and again at the Drive service boundary; a download refuses Google Docs editors files, non-downloadable files and any transfer above the 10 MiB application ceiling before or during the media read, and a transport failure is reported as a typed transfer failure instead of an empty result. Drive downloads write local artifact state only, and Drive API targets use the same Google OAuth request broker/host allow-list. Drive mutations are fail-closed on invalid validators: one concrete strong ETag is required — and checked before authorization — before any conditional write leaves the browser, a provider conflict (412) is reported as a read-again failure, and trashing has no permanent-delete companion. Every Drive mutation also carries the elected-turn abort/activity guard through OAuth and into the request broker, which rechecks immediately before the real provider write and again before any post-401 retry. A media read that dies mid-stream is reported as a typed transfer failure rather than a partial artifact, and an unterminated stream is cancelled the moment it crosses the ceiling.

Drive/Sheets arguments remain strict. `drive.updateFile` rejects undeclared flat metadata fields, accepts only its bounded nested patch, and does not expose `trashed` through this ordinary-write tool. `sheets.updateCell` rejects missing, object/array and oversized values and rejects non-single-cell targets before confirmation. Its confirmation provides the complete cell input in scroll-bounded review text. `sheets.insertRows` identifies spreadsheet, sheet id, start index and count before approval and exposes only the corresponding bounded semantic success summary after the provider call.

## 10. Verification and tests

Use service contract tests, `src/google/tools/*test*`, Gemini declaration tests, confirmation broker/policy tests and integration/E2E flows. Calendar service tests cover discovery, filters/pagination, detailed ETag reads, settings, free/busy, recurrence/timezone, guest updates, deterministic create retry recovery and conditional PATCH/DELETE. `calendar-parity.test.ts` pins registry risk/capabilities, schemas, handler call-id propagation, strong model ETags, the 2,048-character Calendar page-token boundary, exclusive all-day end semantics, pre-confirmation ordering and confirmation summaries. `recurring-update-timezone.test.ts` and `provider-boundary-hardening.test.ts` pin recurrence conversion, strong service-boundary ETags (including weak-validator rejection), offset/timezone requirements and direct-service fail-closed behavior before authorization. `date-zone-validation.test.ts` pins valid-IANA enforcement, impossible-date rejection, leap-day acceptance, paired timing updates and consistent offset/timezone boundary semantics.

Tasks service tests pin task-list pagination/parity at the provider's 100-item bound, assignment metadata, explicit `showAssigned`, provider-filter forwarding, literal provider-date normalization, invalid scheduled-date fail-closed behavior, semantic PATCH updates, same-list move omission behavior and exact `destinationTasklist` serialization for cross-list moves. `tasks-parity.test.ts` pins registry risk/capabilities, semantic-vs-raw schemas, the 101-item rejection boundary, Gemini declaration parity, semantic cross-list move exposure, rejection of the raw provider move field, and consequence-aware confirmations for task/list deletion, bulk clear and hierarchy/list moves. `create-replay.test.ts` plus the handler-level replay test pin same-call replay convergence, changed-payload rejection, retained ambiguous failures and the ability for separate call ids to create identical tasks intentionally.

`drive-sheets-parity.test.ts` invokes the executable handlers for nested Drive metadata updates and the two formerly-unwired Sheets writes. It pins rejection of model-visible Drive trashing, required/bounded single-cell values, true single-cell A1 target validation, declaration parity, exact mutation destinations, full cell-input review before approval, and bounded semantic row-insertion results even when the mocked provider returns oversized response noise.

`drive-parity.test.ts` pins the browser execution plane (including worker exclusion), declaration/schema/service agreement on the query, page-token, page-size and transfer bounds, `showTrashed` forwarding, and that a 1 MiB provider payload produces a sub-500-character model result while the artifact holds the bytes. The Drive service tests pin the shared read projection, the trashed default and explicit-predicate behavior, pre-media refusals (Google Docs editors file, non-downloadable file, declared oversize), mid-transfer ceiling enforcement, abort before any transfer and export through `files.export`. `download.test.ts` pins the guarded artifact lifecycle: a ready artifact with bounded metadata, supersession before and after persistence, cancellation without a transfer, distinguishable failure codes and MIME-based kind classification. `drive-write-parity.test.ts` pins the ETag requirement across schema/declaration/handler, the schema-level exclusion of trashing from `drive.updateFile`, the trash tool's destructive/browser-plane registration, the exact ETag and add/remove-parent arguments the handlers forward, the pre-approval confirmation wording for the parent consequence and the recoverable trash outcome, and the `drive.createFile` replay fence (replay, changed-argument failure and new-turn reset). `create-replay.test.ts` pins the fence itself, including the ambiguous-rejection and concurrent-duplicate cases. `adversarial-certification.test.ts` hosts the hostile-input matrix: a file name containing "trashed" cannot suppress the trashed boundary (and malformed quoting fails safe), an adversarial `maxBytes` cannot widen the ceiling before the media read, provider fields are bounded, contradictory moves and invalid validators are refused before authorization, a stream that dies mid-transfer becomes a typed transfer failure, an unterminated stream is cancelled at the ceiling, library/write capabilities cannot be borrowed, an expired approval never executes a destructive write, and a stale ETag cannot trash a file — with no DELETE anywhere. `e2e/google-drive.spec.ts` proves the user-visible path end to end: a Drive search that respects the trashed default, a download that renders as a document card while bytes stay in the artifact store, a rename held behind the confirmation dialog with its ETag precondition, and a decline that leaves the provider untouched.

`e2e/workspace-shortcuts.spec.ts` verifies visible shortcut drafting and explicit submission. The reliability gate continues to lock key invariants including Calendar/Tasks write capability, grouped confirmations, registry-derived declarations and explicit accessibility controls.

## 11. Known gaps

Google Chat remains deferred from the Gemini surface. Calendar push/watch synchronization, ACL/calendar administration and CalendarList mutations are deliberately outside Pass 1. Google Tasks time-of-day scheduling/reminders and recurring-task UI semantics are not invented because the Tasks API surface used here does not provide them. Google Tasks create has no client-specified task/task-list id in this contract, so an ambiguous create cannot be deterministically recovered after a full browser/runtime restart; the live same-call replay fence prevents duplicate POSTs only while that elected-turn runtime state exists. Google Picker parity is outside this contract; `drive.exportFile` remains internal until Docs/Sheets export semantics are contracted, and a download is read incrementally under the application transfer ceiling and refused mid-stream on overflow rather than buffered whole or streamed to disk. Library search is discovery-only for now: `drive.getFile` and `drive.downloadFile` read the app-file boundary, so a file found only through library search cannot yet be inspected or downloaded until a deliberate library-boundary read contract lands. Broad provider-response byte budgets, semantic output caps and visible truncation metadata across all Workspace adapters remain a cross-Workspace hardening requirement; isolated Calendar/Tasks-only post-parse caps are not treated as a substitute. Any future orchestration/Kanban layer should consume these normalized service/tool boundaries rather than embedding Google API logic or OAuth state in UI components.
