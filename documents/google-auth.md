---
id: SYS-GAUTH
status: active
verified_commit: 3ca672db8efe8710bba0bc83d536583c577a9e0e
scope: Google identity, OAuth capability, scope and durable credential authority
paths: [src/google/oauth]
keywords: [google, oauth, gis, scope, capability, token, account, durable, refresh]
---

# Google authorization

## 1. Purpose and boundary

`SYS-GAUTH` owns Google account authorization, capability-to-scope mapping, browser authorization state, short-lived access-token brokerage and the optional durable refresh-token authority in the user's own Worker. Workspace tools request application capabilities; they never receive raw OAuth scopes, refresh tokens or OAuth client secrets.

Elara is self-hosted shareware, not a shared authentication service. Each deployment owns its GitHub Pages origin, Google OAuth project/Web client and optional Cloudflare Worker. `VITE_GOOGLE_CLIENT_ID` is public browser configuration; when durable authorization is enabled, the Worker's `GOOGLE_OAUTH_CLIENT_ID` must identify the same Google Web OAuth client while `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_VAULT_KEY` remain Worker secrets.

## 2. Runtime architecture

Two modes intentionally coexist:

```text
unpaired / browser-only installation
application capability
-> scope registry + capability policy
-> GIS token client
-> short-lived access token in browser memory
-> approved Google API fetch
```

```text
paired self-hosted Worker
application capability
-> GIS popup authorization code
-> signed browser -> own Worker request
-> GoogleOAuthVault Durable Object
-> Google token exchange
-> AES-GCM encrypted refresh token in Worker storage
-> short-lived access token returned to browser memory
-> approved Google API fetch
```

A configured Worker is authoritative for durable Google authorization. If that Worker is unavailable, Elara surfaces recovery/unavailability; it does not silently downgrade the same installation to browser-only token acquisition. An installation that never pairs a Worker deliberately remains interactive-only.

Authorization remains capability-driven and incremental. A Google provider grant is evidence that an API scope is available; it never silently enables an Elara write/send capability.

## 3. Source map

| Concern | Authority |
| --- | --- |
| OAuth contracts/state | `src/google/oauth/contracts.ts` |
| Browser authority + persisted non-secret metadata | `src/google/oauth/authority.ts` |
| GIS token adapter | `src/google/oauth/gis.ts` |
| GIS popup code adapter | `src/google/oauth/code-flow.ts` |
| Capability policy | `src/google/oauth/capability-policy.ts` |
| Provider scopes | `src/google/oauth/scope-registry.ts` |
| Approved Google request brokerage | `src/google/oauth/request-broker.ts`, `authority.ts` |
| Durable provider exchange/refresh/revoke | `worker/src/google/oauth-provider.ts` |
| Durable encrypted credential owner | `worker/src/google/oauth-vault.ts` |
| Public Worker OAuth route boundary | `worker/src/google/oauth-routes.ts`, `worker/src/entry.ts` |
| Settings UI | `src/app/components/GoogleOAuthSettings.tsx` |

`SYS-WORKER / worker.md` owns the Worker execution/runtime boundary; this document owns the Google authorization semantics that cross it.

## 4. Data and contracts

The application scope registry maps named Elara capabilities to provider scopes. Calendar/Tasks use dedicated read/write scopes; Gmail capabilities are separated into read/modify/labels/send; Docs/Sheets/app-file Drive operations use `drive.file`; broader Drive library reads remain a distinct optional capability. Google Chat scopes exist but Chat remains deferred from the Workspace model surface.

The browser authorization record remains version 3 under the historical `elara.google.authorization.v2` key. It stores only enabled capabilities, current provider scopes, optional account display metadata, recovery state and timestamps. Browser access tokens remain module-memory-only and are never persisted.

In durable mode, the refresh token exists only inside the user's Worker Durable Object. It is encrypted with AES-GCM using dedicated `GOOGLE_OAUTH_VAULT_KEY` material before persistence. Refresh tokens are never returned by the Worker, never written to browser localStorage/IndexedDB, never placed in the autonomy database and never exposed to Gemini. The browser receives only a short-lived access token.

The durable vault reuses the self-hosted installation credential for admission. Browser writes are HMAC-signed with timestamp and nonce; the public Worker route verifies them and the Durable Object independently verifies them again while maintaining its own durable nonce replay ledger. Status reads use the installation bearer credential.

GIS popup code flow does not own an arbitrary callback URL. The browser sends `window.location.origin` as the exchange redirect URI, and the vault requires that value to equal the request `Origin`. The user's Google Web OAuth client must therefore authorize the origin of that self-hosted PWA.

Effective authorization remains the intersection of user-enabled capabilities and provider-satisfied scopes. Shared provider scopes may infer compatible reads, but writes/sends are never inferred merely because Google granted a technically broader scope.

## 5. Invariants

- There is no shared Elara OAuth account, credential broker or central refresh-token store.
- Every durable deployment uses credentials and infrastructure controlled by that deployment owner.
- Refresh tokens never cross from the Worker vault into the browser or model/tool surface.
- Browser access tokens are short-lived and memory-only.
- Provider grants never auto-promote Elara write/send authority.
- A paired installation never silently falls back to browser-only authorization when its Worker is unavailable.
- OAuth permission and Workspace mutation confirmation remain separate boundaries.
- Browser Google API requests enforce HTTPS plus the approved Google API hostname allowlist.
- Popup authorization-code exchange binds the code to the calling PWA origin.
- Local non-Google capabilities do not require fake provider scopes.

## 6. Security and failure semantics

Worker OAuth writes use the existing installation signing protocol plus a dedicated durable nonce ledger. `/google/oauth/exchange` additionally requires the popup CSRF marker. The Worker restricts browser origins through `ALLOWED_ORIGINS`; self-hosted forks must replace the repository default with their own exact PWA origin.

A missing/revoked refresh grant becomes an explicit reauthorization state. Temporary Worker/network loss may surface `token-recovery`; it does not erase a known local capability record or broaden authority. Disconnect attempts provider revocation and removes the durable local grant; browser-only mode retains its existing best-effort token revocation behavior.

Consequential Google mutations still require the separate `SYS-GWS / google-workspace.md` confirmation boundary after OAuth authorization succeeds.

## 7. Verification and tests

Browser tests cover both authorities: the legacy interactive-only token path and paired durable code exchange/refresh. `code-flow.test.ts` pins popup behavior so an arbitrary `redirect_uri` cannot be reintroduced. Worker tests cover encrypted persistence, refresh without browser interaction, replay rejection, origin mismatch, popup CSRF admission, CORS/authentication and disconnect/revocation.

Repository security/reliability gates pin the reviewed credential consumers and require durable browser brokerage, signed Worker requests, AES-GCM vaulting, nonce replay protection, the dedicated Durable Object and the isolated Worker composition root.

`e2e/google-oauth-settings.spec.ts` continues to exercise the real browser-only Settings writer by stubbing only Google's external GIS/userinfo boundary. Durable Worker behavior is covered by unit + workerd tests because production credentials must never be required by CI.

## 8. Current boundary

Pass 0 establishes durable authorization; it does **not** by itself give cloud autonomy permission to execute Google Workspace tools. Calendar/Tasks/Gmail/Drive/Docs/Sheets expansion and later orchestration must consume this authority through explicit tool/execution contracts. The existence of an encrypted refresh token is not autonomous permission.
