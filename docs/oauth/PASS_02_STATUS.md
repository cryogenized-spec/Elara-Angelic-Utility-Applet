# Pass 2 Status — Google Workspace Settings UI

## Completed

- Added the user-facing `Settings → Google` section.
- Added normalized Google connection state display.
- Added independently visible capability state for Calendar, Tasks, Gmail, Drive, Docs, and Sheets.
- Added contextual `Connect` / `Enable writes` actions driven by application capability keys rather than raw OAuth scope strings.
- Added explicit Google disconnect and status refresh actions.
- Kept OAuth redirects, token parsing, token refresh, secrets, and scope strings outside the UI.
- Added responsive styling for the Workspace capability cards.
- Added Playwright coverage for partially authorized state and disconnect/status refresh behavior.

## Current boundary

The UI now consumes `googleOAuthAuthority` and therefore expects the protected OAuth Worker endpoints defined by Pass 1. The app remains fail-closed when that authority is unavailable; it does not fall back to client-side Google token handling.

## Verification target

The production Worker must eventually return normalized status from:

- `GET /api/google/oauth/status`
- `GET /api/google/oauth/start?capability=<application-capability-key>`
- `POST /api/google/oauth/disconnect`

The connect buttons intentionally stop at the authorization-start boundary until the protected Worker exists. They must redirect only to a validated HTTPS Google authorization URL supplied by the authority.

## Next exact action

Pass 3 — audit and finalize the complete Google scope registry against live method-specific Google documentation, including Drive, Docs, Sheets, Gmail, Calendar, and Tasks. Resolve any capability-to-scope mismatches before implementing further Google API service calls.
