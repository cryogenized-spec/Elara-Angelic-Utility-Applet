---
id: SYS-WORKER
status: active
verified_commit: 3ca672db8efe8710bba0bc83d536583c577a9e0e
scope: self-hosted Cloudflare Worker, cloud Gemini, autonomy and durable Google OAuth runtime
paths: [worker/src, worker/wrangler.toml]
keywords: [worker, cloudflare, gemini-endpoint, autonomy, google-oauth, durable-object, health]
---

# Cloud Worker runtime

## 1. Purpose and boundary

`SYS-WORKER` owns the optional self-hosted Cloudflare execution plane: protected cloud endpoints, Worker-side Gemini credentials, the autonomy Durable Object/Workflow runtime and the durable Google OAuth vault runtime. It is **not** the normal interactive browser Gemini provider.

Elara does not operate a shared Worker service. A deployment owner creates and configures their own Worker and secrets. Browser-only installations may omit this plane, but durable Google refresh authorization and cloud autonomy require it.

## 2. Runtime architecture

Production HTTP enters through the thin composition root:

```text
HTTP
-> worker/src/entry.ts
   -> /google/oauth/* -> Google OAuth route boundary -> GoogleOAuthVault
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
| Encrypted refresh credential owner | `worker/src/google/oauth-vault.ts` |
| Worker bindings/migrations | `worker/wrangler.toml` |
| Autonomy ports/state | `worker/src/autonomy/` |
| Worker tests | `worker/test/`, `vitest.workers.config.ts` |
| Client cloud protocol | `src/autonomy/cloud/`, `src/autonomy/protocol.ts` |

Google authorization semantics are canonical in `SYS-GAUTH / google-auth.md`.

## 4. Data and contracts

The Worker owns deployment-supplied secrets. Existing cloud Gemini execution uses `GEMINI_API_KEY`. Durable Google OAuth uses `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_VAULT_KEY`; browser admission to protected routes uses the deployment's `ELARA_INSTALLATION_TOKEN`.

`GOOGLE_OAUTH_CLIENT_ID` must match the browser `VITE_GOOGLE_CLIENT_ID` for the same Google Web OAuth client. `ALLOWED_ORIGINS` identifies the deployment owner's exact PWA origin. Forks must replace the repository owner's default origin rather than inheriting it.

The `GoogleOAuthVault` is a dedicated SQLite-backed Durable Object, separate from the autonomy database. It stores one encrypted refresh grant for the installation plus a bounded nonce replay ledger. Refresh tokens are AES-GCM encrypted before persistence and never returned to the browser. Status/exchange/refresh/disconnect are the only public Google OAuth route shapes.

Autonomy uses its own installation-scoped state, configuration generation and bounded context/outcome envelopes. Presence of a Google refresh grant does not automatically add Google tools to a cloud routine.

## 5. Invariants

- Browser interactive chat does not route through this Worker.
- Every deployment owns its Worker configuration and provider credentials; there is no shared Elara OAuth backend.
- Worker secrets never enter browser bundles, model-visible tool schemas or ordinary client persistence.
- Google refresh tokens never leave the `GoogleOAuthVault` credential boundary.
- The OAuth vault and autonomy state are separate durable authorities.
- Google OAuth writes require signed installation admission and durable nonce replay protection.
- The popup code exchange additionally requires the CSRF marker and origin/redirect match.
- Existing non-OAuth Worker traffic delegates unchanged through the composition root.
- Worker tool exposure remains execution-plane filtered; a stored refresh grant alone is not tool execution authority.
- Health/status endpoints do not disclose secrets.

## 6. Security and failure semantics

The outer Worker route verifies allowed origin and signed/bearer admission; the Durable Object independently verifies protected writes and maintains its own replay ledger. OAuth provider exceptions are normalized; raw refresh credentials/provider exception detail are never returned to the browser.

`GOOGLE_OAUTH_VAULT_KEY` must be high-entropy and at least 32 characters. CORS origins are deployment configuration, not application constants. A self-hosted fork must configure its own origin before exposing the Worker to its Pages app.

Stale autonomy configuration, incompatible protocol versions, invalid OAuth signatures, replayed nonces, redirect/origin mismatch and missing Worker secrets fail closed.

## 7. Verification and tests

Run the repository broad gate plus `npm run test:workers`/Worker type checks. OAuth Worker tests cover encrypted persistence, code exchange, refresh, replay rejection, CORS/origin admission, CSRF, disconnect and routing. Reliability/security gates pin the dedicated Durable Object, Worker composition root and reviewed OAuth provider boundary.

CI is the release authority; production Cloudflare secrets themselves are necessarily deployment-owner configuration and are not exercised with real credentials in CI.

## 8. Current boundary

Pass 0 provides durable authorization infrastructure. Later Google passes may allow cloud/orchestration execution to obtain short-lived Google access through an explicit server-side tool contract. That permission is not inferred from the vault's existence and must preserve the Workspace capability/confirmation model.
