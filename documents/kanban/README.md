# Google Tasks kanban workspace

Supporting guide for [Google Workspace](../google-workspace.md). Google Tasks remains the source of truth; Calendar remains the complementary event/scheduling integration, not a second writable task store.

## User interface

The chat header has a Kanban launcher, separate from the existing Workspace menu. The workspace inherits the application font/background, with a translucent square dot grid and a canvas scrollable horizontally and vertically. Each Google task list is a column. Imported tasks retain IDs, notes, completion state, hierarchy and sibling positions, including completed/hidden tasks. Import never creates or rewrites Google resources.

The wheel command palette (also Ctrl/Command-K) creates tasks, lists and overdue subroutines. Tasks can be edited, completed/reopened and searched/filtered. Lists can be renamed. Task/list deletion uses typed confirmation and warns about irreversible effects. Subroutines can be scoped to a list or all lists, edited, enabled/disabled and removed. Rule removal never deletes Google tasks.

Desktop dragging places a task before a sibling in the same list and parent group. Up/down buttons support keyboard and touch users. Reordering is disabled during search/filtering, writes and sync. A source-task preflight detects changed ETags/parents before using Google's native move operation. It is not an atomic board-wide lock. Cross-list dragging is intentionally not offered even though the semantic model tool supports native cross-list movement.

## Application boundaries

- `src/kanban/google-port.ts`: the reviewed human-board service entry. Requires a live session, effective requested capability and identified account before authorizing; rechecks account/capability after authorization and before invoking the authorized transport. Human mutations additionally bind the service to the board account visible when the action starts, so a same-origin account switch cannot retarget an in-flight create/update/delete/reorder to another Google identity. Timers never initiate consent. No UI or persistence module receives tokens or raw fetch authority.
- `src/kanban/store.ts`: one account-keyed Dexie snapshot/rule store (`elara-kanban`) and external React subscription. This is a cache, not another task authority.
- `src/kanban/task-writes.ts`: typed view-to-semantic mapping. Uses `scheduledDate: YYYY-MM-DD` / `clearScheduledDate`; never reintroduces raw provider task-resource tools.
- `src/kanban/reordering.ts`: pure same-parent move planning.
- `src/app/components/KanbanScreen.tsx`: human forms, explicit Save actions, typed destructive confirmation and presentation.

- `src/kanban/agent-tools.ts`: bounded Gemini-facing inspection/search/refresh projection over the current synchronized board. It never constructs a Google service and never exposes a parallel task mutation path.
- `src/kanban/focus.ts`: browser-local presentation channel used by `kanban.focus` to open/pan the human workspace. It carries only list/task identities and has no provider authority.

Gemini uses the existing registry, semantic schemas, grouped confirmations and handler replay protection. The model-visible Kanban surface is deliberately narrow: `kanban.inspect`, `kanban.refresh`, `kanban.locate`, and `kanban.focus` let Elara understand, reconcile, find, and present the board, while Google provider mutations remain exclusively on the existing `tasks.*` tools. No parallel `kanban.createTask`, `kanban.updateTask`, `tasks.patchTask`, or `tasks.renameTaskList` authority exists. `tasks.updateTask` and `tasks.updateTaskList` remain authoritative. `tasks.updateTask` accepts an optional current ETag and propagates it to `If-Match`. The UI supplies cached ETags for task edits, list renames and deletion when present; HTTP 412 surfaces as a conflict rather than triggering an overwrite/retry.

Settings opened from the board use the existing SettingsScreen exit callback in App, including transactional Generation Activity glyph preference saving and Noto font-cache commit/fallback. The board does not own or replace those appearance authorities. Workspace Drive operations retain the existing Drive registry, execution-plane and replay boundaries.

## Synchronization

1. App mount and board opening request reconciliation, but only an identified, currently live Tasks-authorized session can read Google. Metadata-only/reloaded sessions require explicit reconnection in Settings.
2. Reconcile every 20 minutes while visible; resume if stale, and reconcile on an online event.
3. Successful Google Tasks service writes, including model writes, emit `elara:tasks-changed`. A mutation during a paginated read requests a subsequent read.
4. Coalesce concurrent requests; walk every list/task page before publishing a complete result. A single reconciliation is fail-closed at 500 task lists, 20,000 tasks, or 1,024 provider pages so malformed or pathological pagination cannot exhaust the browser; the last complete snapshot remains intact on overflow or fetch failure. Unchanged payload arrays are reused; reconciliation never issues Google writes merely to reconcile unchanged data.
5. Human edits write through immediately. Ambiguous creation failures are not automatically retried; check Google before retrying.
6. Hidden/offline transitions and app teardown abort in-flight board reads. Reads have a two-minute timeout; canceled or partial results are not published. Returning to the workspace safely resumes canceled reconciliation.
7. Only reads retry network failures and HTTP 429/500/502/503/504, with exponential jitter, provider Retry-After as a minimum, and a five-failure automatic retry budget. Manual sync cannot bypass an active cooldown. Other failures pause automatic sync until explicit retry; no retry initiates consent or replays a mutation. Sync, cooldown, offline and paused states are visible in the board.
8. Browser tabs observe account-keyed cached boards and rules. Rule edits/deletions compare the original rule inside a transaction, merge unrelated edits and reject stale editors. Rule changes do not themselves request Google reconciliation. Account-keyed expiring read leases coordinate polling across same-origin tabs/PWA windows; provider cooldowns and retry budgets are shared. Local change notifications and lease-expiry wakeups replace contention polling, and expired readers are fenced from committing snapshots.
9. No offline mutation queue, service-worker task sync or push notifications.
10. `kanban.refresh` calls this same manual reconciliation path. All four `kanban.*` tools are existing-grant-only in the Gemini loop: missing Tasks authorization returns `AUTHORIZATION_REQUIRED` without opening interactive consent. Refresh additionally honors the same live-session/account checks, read lease, provider cooldown and retry policy; it cannot mutate Google Tasks. If the originating model generation is cancelled or superseded, that obsolete tool call stops awaiting immediately while any already-started shared board reconciliation remains owned by the application and may finish for other surfaces.

## Agent awareness

`kanban.inspect` exposes either a paged column summary or a paged task-card projection for one explicit list. `kanban.locate` performs a bounded local search across list titles, task titles and bounded task-note previews so the model can resolve the exact Google list/task identities already represented on the board. Both return `trust: untrusted-external`: provider-derived titles and notes are evidence, never instructions or authority, and the ordinary Gemini tool-loop taint boundary applies to later mutations.

`kanban.focus` is presentation-only. It validates that the requested list/task is present in the current account's synchronized projection, rechecks account identity after loading that account-keyed projection, and refuses to focus after the originating generation is cancelled or superseded. Only then does it ask the application shell to open the Kanban and scroll the matching DOM column/card into view with a short-lived visual highlight. It does not change task order, Google state, OAuth state, or persisted Kanban data. `kanban.refresh` only reconciles the existing projection through `syncBoard('manual')`.

## Internal memo and chat

Rules interpret Google's date-only `scheduledDate` as the board's due date. A task scheduled today is not overdue; day one is the next local calendar day. This is an opt-in rule convention, not a timed Google deadline. Overlapping rules deduplicate entries; completion, removal and rescheduling resolve the derived memo after sync. Original tasks never move into or disappear behind a memo.

The memo is derived from persisted rules/snapshots and supplied to each interactive turn, including retry/regeneration, only when at least one overdue item matches. It is bounded to 30 task summaries, includes its last-sync timestamp, labels task/email content as untrusted data, and instructs Gemini to verify current status before making live overdue claims. The App also marks a turn carrying this provider-derived memo as `untrustedExternalContext`; the existing Gemini tool-loop taint authority therefore elevates first-batch mutation confirmation instead of relying on prompt wording alone. No model invocation occurs solely because a timer fires. Workspace shortcuts still prefill the visible composer; they do not bypass the ordinary turn path.

On user request, the existing Gmail read and Tasks create tools can turn email into a task, with a source link in notes. No autonomous inbox scanning/import is enabled. Gmail authorization-before-confirmation, bounded content, cancellation guards and replay protection remain unchanged.

## Identity and privacy

OAuth identity, provider scopes, user-enabled capabilities, session readiness and durable refresh remain exclusively owned by `src/google/oauth/` and the existing paired-Worker implementation. The board does not replace or modify those authorities. It fails closed without an identified live account and scopes snapshots/rules by account email. Background reads use the OAuth authority's noninteractive existing-grant path only; a timer or visibility event cannot initiate consent.

Cache retention is deliberate: when a different Google identity is observed, Kanban deletes snapshots, read schedules and local subroutines belonging to the previous identity before loading the new account. A provider-revoked or explicitly disconnected Google state clears the Kanban cache entirely. Same-origin live observation also clears a tab's in-memory board immediately if another tab removes that account's cache row. A merely unavailable/locked live session does not erase the identified account's cache; it stays hidden until that same account is live again. Chat context likewise requires a matching live account.

Snapshots and subroutines are browser-local, not encrypted or cross-device storage. Clearing site data also removes them without deleting Google tasks. Real consent/API behavior still needs acceptance testing with the installation's own Google client and deployed origin.

## Verification and limits

Tests cover pagination/repeated-token protection, last-good snapshots, coalescing, local calendar days, hierarchy/order, memo deduplication/resolution, account/session admission, account-bound human mutations across same-origin switches, persistence, cross-tab cache deletion, timer visibility/cleanup, abort/resume, read timeouts, provider cooldown/retry budgets, cross-tab rule conflicts, conditional writes, unconditional list-assignment consequence disclosure, assigned-task destructive consequences, strict model arguments, bounded Kanban inspection/location, existing-sync refresh reuse, and presentation-only focus. The integration regressions exercise the canonical Settings glyph commit on board exit and board navigation under an active PWA service worker. Provider-mocked UI suites block service workers in the test context to prevent external API fixtures from being bypassed. The dedicated PWA integration group explicitly allows the worker and verifies controlled navigation; production registration is unchanged. Browser tests use real UI/OAuth state transitions with mocked external Google boundaries; they do not import application modules or seed internal task stores.

Remaining work: physical Android/installed-PWA lifecycle acceptance; aggregate sync telemetry; large-account incremental reads; cache management/export; authenticated cross-device rules; cross-list drag UX with hierarchy/assignment safeguards; and deployed-account acceptance checks. Do not claim offline writes, cross-device memos or background push alerts.
