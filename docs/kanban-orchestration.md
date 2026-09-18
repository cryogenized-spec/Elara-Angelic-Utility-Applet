# Kanban orchestration — passes 1 and 2

## Decision: Google Tasks, not Calendar

Google Tasks is the source of truth. A Google task list is a board column; tasks retain their IDs, titles, notes, date-only due dates, completion state, parent relationships, and sibling positions. Completed/hidden tasks are included in the snapshot. Import never creates or rewrites remote resources. Calendar remains the existing complementary event/scheduling integration, not another writable representation of the same tasks.

## Delivered

- Kanban entry at the beginning of the chat's quick-action rail.
- Theme/font inheritance, translucent square dot-grid, horizontally and vertically scrollable canvas, responsive mobile layout.
- Wheel command palette and Ctrl/Command-K shortcut; native modal focus containment and Escape handling.
- New tasks/lists, title/notes/due-date editing, completion/reopening, search and status filtering.
- Desktop drag-to-reorder before a sibling in the same Google list; explicit up/down controls for keyboard and touch users. Reordering preserves parent relationships and uses Google Tasks move, never create/delete. Reordering is disabled in filtered/search views and during sync. A live preflight rejects changed source tasks; the move API is not claimed to provide an atomic board-wide concurrency lock.
- List renaming and task/list deletion. Human deletion requires typed confirmation and warns about list-wide/subtask effects.
- Editable and removable subroutines, with typed confirmation on removal. Removing a rule never deletes Google tasks.
- Account-scoped IndexedDB snapshots and subroutines (`elara-kanban`).
- Subroutine scope (one/all lists), configurable overdue-day threshold and enable/disable controls.
- Internal memo derived from the persisted snapshot/rules. Matching tasks remain in Google lists; overlapping rules do not duplicate memo entries. Completion/deletion/rescheduling resolves the memo after reconciliation.
- Bounded overdue context on normal chat, regeneration and quick-action turns. Task/email text is explicitly untrusted context. No Gemini invocation happens solely because a timer fires.
- Existing Gmail read and Tasks tools support email-to-task requests. The model is instructed to include a Gmail source link in task notes; it must actually call the tool to create the task. No autonomous inbox scanning/import is enabled.
- New confirmation-gated Gemini tools: `tasks.createTaskList`, `tasks.patchTask`, `tasks.renameTaskList`, `tasks.deleteTaskList`. These new tools validate bounded, strict schemas before presenting confirmations. Patch accepts only edited fields and an ETag retrieved with `tasks.getTask`; existing tool confirmations remain in force.

## Synchronization contract

1. On app mount, read connected Google Tasks data. The board also requests reconciliation when opened.
2. While the document is visible, reconcile every 20 minutes. Return-to-app reconciles a stale snapshot; an online event requests reconciliation.
3. Successful Tasks mutations (including Gemini tools) emit a refresh event. A write during a paginated read schedules a subsequent read, avoiding publishing that read as the final post-write state.
4. Coalesce overlapping requests. Walk all task-list and task pages; only publish/persist a complete result. Retain the last successful snapshot on failure and show an error.
5. Compare remote payloads with the cached snapshot. Unchanged task/list arrays are reused. Polling requires reads to discover differences, but reconciliation **never performs remote writes**.
6. Human edits write through immediately. Patch only changed fields and send `If-Match` when an ETag is available. HTTP 412 is surfaced as a conflict, not overwritten. Failed/ambiguous writes are not automatically retried; the UI advises checking Google before retrying a creation.
7. No offline mutation queue, background service-worker synchronization, or push notifications. Closing the app stops scheduling. A hidden document does not start scheduled reads; an already-running request may finish.

Google Tasks due values are treated as local calendar dates, not timed appointments. A task due today is not overdue. The first eligible day is the following local calendar day. Memo rules default to a threshold of one day and are opt-in, not silently enabled on import.

## Identity and privacy

The pre-existing OAuth metadata contained an optional account field without populating it. Tasks consent now also requests `userinfo.email`, verifies the email with the acquired token, and records the account alongside capability metadata. Access tokens remain in memory. Switching identities drops inherited capability assumptions; a token refresh cannot transparently replay an old-account operation against a new account.

Snapshots and rules are keyed by verified email. The active board is cleared when account identity changes or disconnects; cached data remains local for that account. Chat context requires a matching currently connected account. New consent may be needed for the email-identity scope. Google OAuth client configuration and authorized deployment origins remain prerequisites; no credentials are embedded in the app.

Task snapshots and subroutines are browser-local, not an encrypted or cross-device app database. Clearing site storage removes them (remote Google tasks remain). A memo carries its last-sync timestamp and tells Gemini to verify current task state before making live overdue claims.

## Validation

- Web and worker TypeScript checks.
- Unit coverage: full pagination, repeated-token protection, last-good snapshot retention, request coalescing, local-day overdue semantics, parent/sibling ordering, rule thresholds/scope/deduplication, resolution, account isolation, persistent chat context, visibility/timer cleanup, ETag conflicts, partial-field writes and verified OAuth identity.
- `e2e/kanban.spec.ts`: desktop Google-write/memo flows, drag and button reordering, list/subroutine management, deletion-confirmation rejection, task deletion, and mobile disconnected/modal flows, with simulated Google responses. These do not certify live Google consent or API behavior.
- Production Vite/PWA bundle generated successfully. In this sandbox, the existing font-preparation script's GitHub downloads were network-blocked; equivalent local Fontsource variable-font assets were used for build verification only. They are not source changes. The existing large-bundle warning remains.
- Lint has no errors; pre-existing console warnings in build/verification scripts remain. Generated dev PWA output and E2E auth fixtures are excluded from source/lint.

## Deliberate follow-up work

These are functional first and second passes, not the end of enterprise hardening:

- Cross-list movement needs explicit Google API semantics and hierarchy handling; do not emulate it with an unsafe create/delete pair. Within-list sibling reordering is implemented.
- Optional application-only workflow lanes without changing Google list structure.
- Cross-tab leader election, rate-limit/backoff telemetry, incremental reads for very large accounts, and cancellation of in-flight reads on app teardown.
- Browser-local data management/export and, if desired, authenticated cross-device subroutine persistence.
- Live-account consent, revoked/expired token, Google-side concurrent edits, email-to-task Gemini tool calls, and timezone/DST acceptance checks on the deployed origin.
- Full provider-response schemas and broader security/reliability audit of the existing OAuth/tool infrastructure.

Do not claim offline write support, cross-device memo persistence, cross-list drag-and-drop, or background alerts until those follow-up capabilities are implemented and tested.

## Integration note

This session started at `39891a6`. The GitHub default branch has since advanced substantially, including OAuth/Gmail changes and infrastructure restructuring. The PR must be integrated with that newer architecture before merging; passing tests in this checkout do not certify the merged result. Do not resolve conflicts by discarding the newer default-branch changes.
