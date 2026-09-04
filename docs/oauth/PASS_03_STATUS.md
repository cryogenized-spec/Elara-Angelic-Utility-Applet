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
- Gmail label administration now has its own `gmail.labels` capability.
- Gmail sending remains separately authorized with `gmail.send`.
- Existing Chat mappings remain explicitly marked for method-specific revalidation before Chat production work.

### Code changes

- Added `gmail.labels` to the central Google capability contract.
- Mapped `gmail.createLabel`, `gmail.updateLabel`, and `gmail.deleteLabel` to `gmail.labels` instead of the broader `gmail.modify` capability.
- Hardened `getGoogleScope()` to validate capability keys with the central Zod enum before lookup.
- Expanded scope-registry tests to assert exact provider-scope mappings and Gmail capability separation.
- Expanded Google Settings so Gmail can independently authorize base read access, mailbox modification, label administration, and sending.
- Added the scope-audit documentation to `docs/GOOGLE_SCOPE_REGISTRY.md`.

## Official documentation basis checked during this pass

Google's current OAuth scope catalogue recommends the least sensitive scope that satisfies the operation and lists distinct Gmail read/modify/labels/send scopes plus `drive.file`. citeturn905264view0turn229576search0

Google's current Calendar authorization guide exposes event-specific, calendar-list, and settings scopes and recommends narrow scopes. citeturn968614search1

Google's current Docs API references confirm that `documents.get` and `documents.create` accept `drive.file`. citeturn285584search4turn285584search12

Google's current Drive documentation supports file search/list/get/update flows and selected response fields; `drive.file` is the intended least-privilege direction for Elara's selected/app-created files. citeturn968614search6turn285584search0

Google's current Tasks documentation distinguishes `tasks.readonly` from the full-management `tasks` scope. citeturn285584search11

Google's current Sheets scope catalogue exposes `drive.file`, `spreadsheets.readonly`, and `spreadsheets`; Elara should remain on `drive.file` where the per-file workflow is sufficient. citeturn285584search7

## Important production note

The scope registry is now deliberately stricter, but scope registration does not make Google authorization operational. The protected Cloudflare OAuth authority is still required to translate these application capabilities into a real authorization-code flow, maintain refresh credentials securely, and return normalized grant state.

## Next exact action

Pass 4 — implement the real Drive, Docs, and Sheets service adapters behind the existing OAuth/capability boundary. Do not bypass the OAuth authority or expose provider endpoints/tokens to the model.
