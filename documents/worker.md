---
id: SYS-WORKER
status: active
verified_commit: cf33c88b6924e666cb6e186f95e04953e48e5ddd
scope: self-hosted Cloudflare Worker, cloud Gemini, autonomy and durable provider OAuth runtime
paths: [worker/src, worker/wrangler.toml]
keywords: [worker, cloudflare, gemini-endpoint, autonomy, google-oauth, clickup-oauth, durable-object, health]
---

# Cloud Worker runtime

## 1. Purpose and boundary

`SYS-WORKER` owns the optional self-hosted Cloudflare execution plane: protected cloud endpoints, Worker-side provider credentials, the autonomy Durable Object/Workflow runtime and the durable Google and ClickUp OAuth vault runtimes. It is **not** the normal interactive browser Gemini provider.

Elara does not operate a shared Worker service. A deployment owner creates and configures their own Worker and secrets. Browser-only installations may omit this plane, but durable Google refresh authorization, first-party ClickUp authorization/execution, and cloud autonomy require it.

## 2. Runtime architecture

Production HTTP enters through the thin composition root:

```text
HTTP
-> worker/src/entry.ts
   -> /google/oauth/* -> Google OAuth route boundary -> GoogleOAuthVault
   -> /clickup/oauth/* -> ClickUp OAuth route boundary -> ClickUpOAuthVault
   -> all other traffic -> worker/src/index.ts existing core
```

Scheduled execution remains in the existing core:

```text
cron / Durable Object alarm
-> autonomy scheduler
-> Workflow execution
-> bounded result/history
```

Normal browser chat continues to call `src/gemini/provider.ts` directly.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Production HTTP composition | `worker/src/entry.ts` |
| Existing health/Gemini/transcription/autonomy routes | `worker/src/index.ts` |
| Google OAuth public routes/CORS | `worker/src/google/oauth-routes.ts` |
| Google token provider exchange/refresh/revoke | `worker/src/google/oauth-provider.ts` |
| Encrypted Google refresh credential owner | `worker/src/google/oauth-vault.ts` |
| ClickUp OAuth public routes/CORS | `worker/src/clickup/oauth-routes.ts` |
| ClickUp token exchange + REST adapter | `worker/src/clickup/provider.ts` |
| Encrypted ClickUp access-token/rate authority | `worker/src/clickup/oauth-vault.ts` |
| Worker bindings/migrations | `worker/wrangler.toml` |
| Autonomy ports/state | `worker/src/autonomy/` |
| Worker tests | `worker/test/`, `vitest.workers.config.ts` |
| Client cloud protocol | `src/autonomy/cloud/`, `src/autonomy/protocol.ts` |

Google authorization semantics are canonical in `SYS-GAUTH / google-auth.md`; ClickUp authorization and REST execution semantics are canonical in `SYS-CLICKUP / clickup.md`.

## 4. Data and contracts

The Worker owns deployment-supplied secrets. Existing cloud Gemini execution uses `GEMINI_API_KEY`, but public provider routes never expose that credential as anonymous compute. `/api/gemini` and `/api/transcribe` require `Authorization: Bearer <ELARA_INSTALLATION_TOKEN>` on every request; an allowed browser Origin is additional CORS policy, not admission. The Worker-side Gemini request contract also caps `maxOutputTokens` at 65,536. Durable Google OAuth uses `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_VAULT_KEY`. ClickUp always uses deployment-owned `CLICKUP_OAUTH_VAULT_KEY`. It may authenticate with `CLICKUP_OAUTH_CLIENT_ID` + `CLICKUP_OAUTH_CLIENT_SECRET` for OAuth, or with a deployment-owned `CLICKUP_PERSONAL_TOKEN` for a single-user self-hosted installation. Browser admission to protected ClickUp credential routes uses the deployment's `ELARA_INSTALLATION_TOKEN`; the personal token itself never traverses the browser request.

`GOOGLE_OAUTH_CLIENT_ID` must match the browser `VITE_GOOGLE_CLIENT_ID` for the same Google Web OAuth client. `ALLOWED_ORIGINS` identifies the deployment owner's exact PWA origin. Forks must replace the repository owner's default origin rather than inheriting it.

The `GoogleOAuthVault` and `ClickUpOAuthVault` are separate SQLite-backed Durable Objects, each separate from autonomy state. Google stores one encrypted refresh grant; ClickUp stores one encrypted provider credential (OAuth access token or personal API token) plus authorized account/Workspace metadata. Both keep durable nonce replay ledgers. ClickUp additionally owns one-time OAuth-state records and provider rate-limit state. Provider secrets never return to the browser.

Autonomy uses its own installation-scoped state, configuration generation and bounded context/outcome envelopes. Presence of a Google refresh grant does not automatically add Google tools to a cloud routine.

## 5. Invariants

- Browser interactive chat does not route through this Worker.
- Every deployment owns its Worker configuration and provider credentials; there is no shared Elara OAuth backend.
- Worker secrets never enter browser bundles, model-visible tool schemas or ordinary client persistence.
- Google refresh tokens never leave the `GoogleOAuthVault` credential boundary.
- ClickUp OAuth access tokens and personal API tokens never leave the `ClickUpOAuthVault` credential boundary after activation; `CLICKUP_PERSONAL_TOKEN` is read only from the Worker secret environment.
- The OAuth vault and autonomy state are separate durable authorities.
- Google OAuth writes require signed installation admission and durable nonce replay protection.
- ClickUp OAuth writes use the same installation signing authority; ClickUp OAuth state is durable, redirect-bound, expiring and single-use.
- ClickUp provider execution is binding-internal only and requires the installation-derived internal marker.
- The popup code exchange additionally requires the CSRF marker and origin/redirect match.
- Existing non-OAuth Worker traffic delegates unchanged through the composition root.
- Worker tool exposure remains execution-plane filtered; a stored refresh grant alone is not tool execution authority.
- Health/status endpoints do not disclose secrets.
- Worker Gemini/transcription requests fail closed when the installation token is missing or wrong, including originless server-side requests.

## 6. Security and failure semantics

The outer Worker route verifies allowed origin and signed/bearer admission; the Durable Object independently verifies protected writes and maintains its own replay ledger. OAuth provider exceptions are normalized; raw refresh credentials/provider exception detail are never returned to the browser.

`GOOGLE_OAUTH_VAULT_KEY` and `CLICKUP_OAUTH_VAULT_KEY` must each be high-entropy and at least 32 characters. CORS origins are deployment configuration, not application constants. A self-hosted fork must configure its own origin before exposing the Worker to its Pages app.

Stale autonomy configuration, incompatible protocol versions, invalid OAuth signatures, replayed nonces, redirect/origin mismatch and missing Worker secrets fail closed.

## 7. Verification and tests

Run the repository broad gate plus `npm run test:workers`/Worker type checks. OAuth Worker tests cover Google encrypted persistence/refresh plus ClickUp encrypted token exchange, redirect/state/replay admission, internal provider execution, adaptive rate limiting, revoked-token cleanup, CORS/origin admission, disconnect and routing. Reliability/security gates pin the dedicated Durable Object, Worker composition root and reviewed OAuth provider boundary.

CI is the release authority; production Cloudflare secrets themselves are necessarily deployment-owner configuration and are not exercised with real credentials in CI.

## 8. Current boundary

The Worker now provides durable provider authorization infrastructure for Google and ClickUp. Google cloud/orchestration execution still requires explicit tool authority. ClickUp REST execution is exposed to the browser only through Elara's authenticated first-party MCP/tool path and the binding-internal provider-command boundary. No stored provider grant is autonomous permission.
