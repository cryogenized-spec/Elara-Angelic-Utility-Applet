# Pass 4 Status — Google Workspace Adapter Hardening

## Completed

Pass 4 hardens the focused Workspace service adapters behind the direct Google Identity Services authority. No adapter owns OAuth, provider credentials, or arbitrary HTTP access.

### Calendar

`src/google/calendar/service.ts` now bounds calendar IDs and time-window parameters before requesting authorization or constructing the provider request. Event reads remain isolated to `calendar.events.read`.

### Tasks

`src/google/tasks/service.ts` now bounds task-list/task IDs, pagination tokens, parent/previous IDs, and `maxResults`. Read operations remain on `tasks.read`; mutations remain on `tasks.write`.

### Gmail

`src/google/gmail/service.ts` now bounds list queries, pagination tokens, and outbound raw-message size. Gmail label administration correctly uses the independent `gmail.labels` capability rather than `gmail.modify`; message/thread mutation remains `gmail.modify`, and sending remains `gmail.send`.

### Google Chat

`src/google/chat/service.ts` now bounds space/message identifiers, pagination/filter inputs, request IDs, page sizes, and update masks. Chat reads use `chat.read`; message mutations use `chat.write`, whose scope was audited in Pass 3 to `chat.messages`.

### Docs

`src/google/docs/service.ts` now bounds document IDs and titles, limits batch updates to 100 requests, and caps serialized batch payloads before provider execution.

### Drive

The existing Drive adapter already provides bounded file IDs/metadata fields, bounded page size, response field projection, and a 10 MB transfer limit for downloads/exports. It remains on `drive.files.read` / `drive.files.write` with `drive.file` provider scope.

### Sheets

The existing Sheets adapter already bounds range values, write/append row counts to 1000, and batch updates to 100 requests. It remains on `sheets.read` / `sheets.write` with `drive.file` provider scope.

## Testing

Unit tests now cover the highest-risk boundaries added in this pass:

- Calendar oversized identifiers/time parameters;
- Tasks oversized identifiers/pagination and invalid result limits;
- Gmail capability separation plus query/message bounds;
- Chat identifier/page-size bounds;
- Docs title/document/request-count bounds;
- existing Drive and Sheets payload/transfer limits.

The direct OAuth authority is separately covered for transient token handling, silent 401 recovery, request-body preservation, target allow-listing, and disconnect.

## Architecture note

The old Worker-backed OAuth authority is retired. These adapters now consume the direct application `GoogleOAuthAuthority`, so no adapter depends on `elara-gemini.cryogenized.workers.dev` for Google authorization.

## Next exact action

**Pass 5 — model-visible Google tools:** expand the explicit named Google tool surface and connect it to the existing centralized capability/confirmation executor. No generic Google HTTP tool will be introduced.
