# Pass 3 Status — Google Scope Audit

## Completed

Pass 3 audited the first-class Workspace scope design against current Google documentation and hardened the application registry.

### Scope decisions locked in

- Calendar event reads use `calendar.events.readonly`.
- Calendar event writes use `calendar.events`.
- Calendar list discovery uses `calendar.calendarlist.readonly`.
- Calendar settings use `calendar.settings.readonly`.
- Tasks reads use `tasks.readonly`.
- Tasks management uses `tasks`.
- Drive uses `drive.file` for the intended per-file workflow.
- Docs uses `drive.file` where the selected Docs methods support it.
- Sheets uses `drive.file` where the intended per-file workflow is sufficient.
- Gmail reads use `gmail.readonly`.
- Gmail message/thread mutation uses `gmail.modify`.
- Gmail label administration remains independently authorized with `gmail.labels`.
- Gmail sending remains separately authorized with `gmail.send`.
- Chat reads use `chat.messages.readonly`.
- Chat writes use `chat.messages` because the current Chat adapter performs user-authenticated message create/update/delete operations, not space administration.

### Code changes

- Replaced the provisional `chat.write` mapping from `chat.spaces` to `chat.messages`.
- Expanded scope-registry tests to lock the complete first-class capability set and exact provider scopes.
- Added method-level scope notes to `docs/GOOGLE_SCOPE_REGISTRY.md`.
- Retained Calendar list/settings as independent capabilities because they correspond to distinct provider operations and should not be silently bundled into event access.

## Official documentation basis checked during this pass

Google's current Calendar authorization guide recommends the narrowest practical scope and lists event-specific read/write, calendar-list, and settings scopes. The current `events.insert` reference accepts `calendar.events`. citeturn348059search0turn560705search5

Google's current Tasks documentation distinguishes `tasks.readonly` from the full-management `tasks` scope. citeturn560705search9turn560705search0

Google's current Docs documentation confirms `documents.get`, `documents.create`, and `documents.batchUpdate` accept `drive.file`. citeturn348059search1turn348059search9turn364903search2

Google's current Drive documentation confirms `drive.file` is accepted by file listing and file retrieval, and file-content downloads require a scope that permits content reads. citeturn364903search0turn364903search9turn348059search3

Google's current Sheets documentation confirms `drive.file` is accepted for spreadsheet retrieval and value updates, making it a viable least-privilege choice for Elara's selected/app-created file workflow. citeturn364903search1turn364903search3

Google's current Gmail message-list documentation accepts `gmail.readonly`; the adapter's mutation and send boundaries remain separate. citeturn560705search1

Google's current Chat documentation shows user-authenticated message reads use `chat.messages.readonly`/`chat.messages`, while message creation, update, and delete use `chat.messages.create`/`chat.messages`. citeturn141205search0turn141205search1turn204511search2

## Important production note

The scope registry defines least-privilege application capabilities; it does not itself authorize access. Pass 2 supplies the current browser-side Google Identity Services authority, which requests these registered scopes incrementally and keeps access tokens transient.

Sensitive/restricted scopes still require Google production-readiness review as applicable. The final consent configuration must match the exact scope set actually used. citeturn687686search8

## Next exact action

**Pass 4 — Google service adapter hardening:** validate provider request construction, pagination, response/request bounds, error normalization, and capability usage across every Workspace adapter before expanding the model-visible Google tool surface.
