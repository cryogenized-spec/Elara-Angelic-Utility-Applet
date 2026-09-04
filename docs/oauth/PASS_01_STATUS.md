# Pass 1 Status — Production OAuth Authority

## Completed in the clean Elara app repository

- Added the authoritative OAuth/Workspace future-self handoff at `docs/oauth/README.md`.
- Added an application-owned Google OAuth capability contract covering Calendar, Tasks, Gmail, Drive, Docs, Sheets, and Chat.
- Added `src/google/oauth/authority.ts` as the browser-side adapter to the protected Cloudflare OAuth authority.
- The adapter exposes only normalized status, capability authorization initiation, and disconnect. It does not store Google tokens or client secrets.
- Added `src/google/oauth/scope-registry.ts` for provider scope mappings. Provider scope strings remain outside model-visible tool schemas.
- Added scope-registry regression coverage.
- Expanded `docs/GOOGLE_SCOPE_REGISTRY.md` with Drive/Sheets capabilities, current least-privilege direction, sensitivity classification, and live-doc verification notes.

## Important boundary

The clean app repository does **not** contain the source for the deployed `elara-gemini.cryogenized.workers.dev` Worker. Therefore the protected server-side half of Pass 1 cannot honestly be called complete from this repository alone.

The app-side contract now expects these protected endpoints on the OAuth authority:

- `GET /api/google/oauth/status`
- `GET /api/google/oauth/start?capability=<application-capability-key>`
- `POST /api/google/oauth/disconnect`

The OAuth authority must implement the real Google authorization-code flow, secure state/redirect validation, offline refresh-token storage, access-token refresh, revocation handling, granted-scope inventory, and safe diagnostics before these endpoints are considered production-ready.

Do not invent a second client-side token flow to compensate for the missing Worker source.

## Live documentation validation performed for this pass

Google's current documentation was rechecked before this implementation:

- server-side web OAuth and offline refresh;
- incremental authorization and secure HTTPS redirect policies;
- current Google OAuth scope catalogue;
- current Calendar, Drive, Docs, Sheets, Tasks, Gmail, and Chat scope requirements;
- current Cloudflare Cron Triggers and scheduled-handler documentation;
- current Cloudflare durable scheduling and Web Push documentation.

## Next exact action

Locate or expose the source repository/deployment configuration for the protected Google OAuth Worker. Then implement the server-side authority behind the existing app contract rather than changing the contract to fit an ad-hoc worker implementation.
