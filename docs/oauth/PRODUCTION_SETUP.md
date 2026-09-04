# Google OAuth Worker — Production Provisioning

The application and Worker source are now wired. The remaining activation work is one-time Cloudflare and Google configuration.

## 1. Create the dedicated KV namespace

From the repository root:

```bash
npx wrangler kv namespace create GOOGLE_OAUTH_KV --config worker/wrangler.toml
```

Wrangler prints the generated namespace ID. Replace `REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID` in `worker/wrangler.toml` with that exact ID. Cloudflare documents `wrangler kv namespace create` as the supported namespace-creation command and requires the resulting binding ID in the Worker configuration. citeturn320217search0turn320217search1turn320217search6

Do not create a fresh namespace for every deployment. This namespace is the durable production store for OAuth state, sessions, and encrypted per-account credentials.

## 2. Create the OAuth encryption secret

Generate a random 32-byte key. Either a 64-character hexadecimal value or an unpadded base64url encoding of exactly 32 bytes is accepted by the Worker.

Store it as a Worker secret:

```bash
npx wrangler secret put OAUTH_TOKEN_ENCRYPTION_KEY --config worker/wrangler.toml
```

Also configure:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID --config worker/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml
```

Cloudflare recommends storing credentials and tokens as Worker secrets rather than source or ordinary configuration. citeturn320217search2turn320217search3turn320217search9

## 3. Configure the Google OAuth client

Use a Google Cloud **Web application** OAuth client for the server-side authorization-code flow. Register this exact redirect URI:

`https://elara-gemini.cryogenized.workers.dev/api/google/oauth/callback`

The application requests one application capability at a time, together with `openid email profile`, using offline access and incremental authorization. Google documents the server-side authorization-code flow, `state`, PKCE-compatible authorization, and offline refresh-token handling. citeturn736197search0turn736197search1turn736197search3

Add the final production Google scopes used by the application to the consent configuration. Gmail scopes are restricted in the current repository registry, so the final production verification/compliance status must be completed before public production use. citeturn916457search0turn916457search6turn916457search8

## 4. Deploy the Worker

After the KV ID and secrets exist:

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Cloudflare's Worker binding model makes the KV namespace available to the Worker through the `GOOGLE_OAUTH_KV` binding, while secrets remain outside source control. citeturn916457search1turn320217search9

## 5. Verify the public boundary

Confirm:

```text
GET /health
GET /api/google/oauth/status
```

The status endpoint must return `disconnected` for a fresh browser session and must not expose tokens or secrets.

Then exercise one capability end-to-end from Elara Settings:

```text
Google authorization → Google consent → callback → session → capability status → Calendar/Workspace request through the Worker proxy
```

Repeat for incremental Calendar, Tasks, Gmail, Drive, Docs, and Sheets authorization after the first successful capability.

## 6. Production hardening checks

Before declaring the OAuth milestone complete, verify denied consent, partial consent, reconnect, silent token refresh, refresh-token replacement, revoked grant, disconnect, reload with an existing session, Worker restart, quota/errors, malformed proxy targets, oversized bodies, and the absence of credentials in logs, tool payloads, conversation persistence, and browser state.

The Worker implementation deliberately reports safe status/error classifications rather than raw Google token-exchange details.
