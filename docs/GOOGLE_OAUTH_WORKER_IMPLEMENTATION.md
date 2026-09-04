# Google OAuth Worker Implementation

The protected Google OAuth authority is now implemented inside the Cloudflare Worker boundary in `worker/src/google-oauth.ts`.

## Responsibilities

The Worker now owns:

- authorization-code initiation;
- anti-forgery state tied to a short-lived KV record and HttpOnly state cookie;
- PKCE S256 verifier/challenge generation;
- offline access and incremental consent;
- authorization-code exchange;
- Google account identity retrieval through the OIDC UserInfo endpoint;
- encrypted refresh-token storage;
- encrypted short-lived access-token caching;
- refresh-token replacement when Google returns a replacement;
- revocation/disconnect;
- normalized per-capability authorization state;
- a capability-bound Google API proxy for the existing Workspace service adapters.

Google's current documentation describes the server-side authorization-code flow, `access_type=offline` for refresh credentials, and state validation as the appropriate pattern for server-side applications. citeturn736197search0turn736197search1turn736197search3

## Endpoints

`GET /api/google/oauth/start?capability=<capability>` begins contextual incremental authorization.

`GET /api/google/oauth/callback` receives Google's authorization response and establishes the protected application session.

`GET /api/google/oauth/status` returns normalized connection state and granted application capabilities only. Tokens are never returned.

`POST /api/google/oauth/disconnect` revokes the stored refresh credential at Google where possible and removes the local protected credentials/session regardless of remote revocation result.

`GET|POST|PATCH|PUT|DELETE /api/google/oauth/proxy` executes an already-authorized Workspace API request through the Worker. The client supplies an application capability and a target URL; the Worker validates both against an explicit allow-list before attaching a short-lived server-side access token.

## Storage

The Worker uses a dedicated KV binding named `GOOGLE_OAUTH_KV` for OAuth state, sessions, and protected per-account records. Cloudflare documents KV as suitable for session data and credential/configuration storage; the binding is declared in `worker/wrangler.toml`. citeturn916457search4turn916457search7

Refresh and access tokens are additionally encrypted with an application secret (`OAUTH_TOKEN_ENCRYPTION_KEY`) using Web Crypto AES-GCM before being written to KV. The encryption key itself is a Worker secret and is never stored in source control.

## Required production configuration

Set the following Worker secrets:

- `GEMINI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_TOKEN_ENCRYPTION_KEY`

Create one dedicated KV namespace and bind it as `GOOGLE_OAUTH_KV`. Do not reuse a general application namespace for OAuth credentials.

Set these Worker variables:

- `ALLOWED_ORIGINS` — exact deployed Pages origin;
- `APP_ORIGIN` — exact deployed Pages application URL;
- `GOOGLE_OAUTH_REDIRECT_URI` — exact HTTPS callback URL registered in Google Cloud Console.

Google requires production applications using sensitive or restricted scopes to complete the applicable verification/review process before production use. Gmail scopes in this repository are restricted, so production compliance remains an explicit release prerequisite. citeturn916457search0turn916457search6turn916457search8

## Security boundaries

The browser receives an HttpOnly session cookie but never receives a Google refresh token, client secret, or raw OAuth access token. Workspace requests are constrained to known Google API hosts and capability-specific path prefixes.

The client cannot use the proxy as a universal HTTP tunnel: the Worker rejects unknown capabilities, missing authorization, disallowed Google targets, unauthorized browser origins, and oversized request bodies.

State and session records are opaque random identifiers. OAuth callback failures are redirected to the application with a safe status marker rather than raw Google or token-exchange errors.

## Remaining deployment task

The code is now present in the repository, but the repository cannot manufacture the production KV namespace or Google Cloud OAuth client configuration. One-time infrastructure provisioning still has to be performed in Cloudflare/Google Cloud and the resulting KV namespace ID placed in `worker/wrangler.toml` in place of `REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID`.

This is configuration/provisioning, not a second application architecture. Once the binding and secrets exist, the existing Worker is the single production OAuth authority expected by `src/google/oauth/authority.ts`.
