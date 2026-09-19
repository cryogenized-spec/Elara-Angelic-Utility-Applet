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

`SYS-GAUTH` owns Google account connection, authorization, capability-to-scope mapping, browser authorization state, short-lived access-token brokerage and the optional durable refresh-token authority in the user's own Worker. `google.account` remains the narrow identity application capability backed by `userinfo.email` plus OIDC, but the Settings onboarding gesture now composes that identity scope with the reviewed Workspace v1 capability bundle and sends one space-delimited scope request to Google Identity Services. Google owns granular consent: the provider may return all requested scopes or only the subset the user approves. Workspace tools never receive raw OAuth scopes, refresh tokens or OAuth client secrets.

Elara is self-hosted shareware, not a shared authentication service. Each deployment owns its GitHub Pages origin, Google OAuth project/Web client and optional Cloudflare Worker. `VITE_GOOGLE_CLIENT_ID` is public browser configuration; when durable authorization is enabled, the Worker's `GOOGLE_OAUTH_CLIENT_ID` must identify the same Google Web OAuth client while `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_VAULT_KEY` remain Worker secrets. For the canonical GitHub Pages deployment, CI reads `VITE_GOOGLE_CLIENT_ID` (and optional Picker identifiers) from GitHub Actions repository variables and injects them at Vite build time; `main` certification refuses to publish when the client ID is absent. The Google settings account button remains the explicit user gesture into the existing OAuth authority, which initializes GIS and opens Google's authorization UI.

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

Authorization remains capability-driven, but Settings onboarding is deliberately bundled. The single **Connect Google Workspace** gesture marks the reviewed Workspace v1 capability set as this installation's requested application surface, asks GIS for the deduplicated/minimized provider scope set in one consent flow, and then derives effective authority only from scopes Google actually returns. The service cards are status projections, not independent authorization switches. If Google grants only part of the request, the missing capabilities remain ineffective and Settings offers one **Review Google permissions** action rather than a chain of per-service buttons. Contextual tool authorization still fails closed if a required capability is not effective. A paired Worker may report a broader provider scope set from another device, but remote provider state by itself still does not insert a new locally requested capability.

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
| OAuth structural certification | `scripts/google-oauth-lifecycle-gate.mjs` |
| OAuth behavioral mutation certification | `scripts/verify-google-oauth-lifecycle-mutations.mjs` |
| Settings UI | `src/app/components/GoogleOAuthSettings.tsx` |

`SYS-WORKER / worker.md` owns the Worker execution/runtime boundary; this document owns the Google authorization semantics that cross it.

## 4. Data and contracts

The application scope registry maps named Elara capabilities to provider scopes. Calendar/Tasks use dedicated read/write scopes; Gmail capabilities are separated into read/modify/labels/send; Docs/Sheets/app-file Drive operations use `drive.file`; broader Drive library reads remain a distinct optional capability. Google Chat scopes exist but Chat remains deferred from the Workspace model surface.

The browser authorization record remains version 3 under the historical `elara.google.authorization.v2` key. It stores only enabled capabilities, current provider scopes, optional account display metadata, recovery state and timestamps. Browser access tokens remain module-memory-only and are never persisted. `GoogleOAuthStatus.sessionReady` is derived from the live in-memory access-token session and is never persisted as consent evidence.

In durable mode, the refresh token exists only inside the user's Worker Durable Object. It is encrypted with AES-GCM using dedicated `GOOGLE_OAUTH_VAULT_KEY` material before persistence. Refresh tokens are never returned by the Worker, never written to browser localStorage/IndexedDB, never placed in the autonomy database and never exposed to Gemini. The browser receives only a short-lived access token.

Durable refresh credentials are bound to Google's stable OIDC subject (`sub`) internally. Email remains display/profile metadata and is not sufficient proof that an existing refresh token belongs to a newly selected account. When Google omits a replacement refresh token, the existing encrypted refresh credential may be reused only if the newly resolved stable subject matches the subject already stored with that credential; otherwise the unsafe local grant is deleted and reauthorization is required.

Provider token failures retain their machine-readable OAuth error code at the Worker provider boundary. In particular, a refresh response with `invalid_grant` is treated as evidence that the durable refresh grant is expired or revoked, not as a generic transport failure. The vault deletes that unusable local credential and returns `reauthorization_required`, allowing the browser authority to enter the explicit reauthorization path instead of continuing to report a stale connected grant.

The durable vault's `updated_at` field is also the browser-visible grant revision. A replacement authorization always advances that revision monotonically with `max(Date.now(), previousRevision + 1)`, so even same-millisecond or clock-skewed replacements cannot reuse the previous revision. Token-only refreshes keep the revision stable when the effective provider scope set is unchanged; a refresh that changes the effective grant advances it monotonically. Paired browser access-token sessions bind themselves to that revision, and any authoritative revision change invalidates the in-memory token before another Google API request can use it.

The durable vault reuses the self-hosted installation credential for admission. Browser writes are HMAC-signed with timestamp and nonce; the public Worker route verifies them and the Durable Object independently verifies them again while maintaining its own durable nonce replay ledger. Status reads use the installation bearer credential.

GIS popup code flow does not own an arbitrary callback URL. The browser sends `window.location.origin` as the exchange redirect URI, and the vault requires that value to equal the request `Origin`. The user's Google Web OAuth client must therefore authorize the origin of that self-hosted PWA. Paired installations use Google's recommended popup authorization-code model; unpaired installations retain the interactive GIS token model and therefore require a fresh user-driven session after a browser reload.

Effective authorization remains the intersection of locally requested Elara capabilities and provider-satisfied scopes. The onboarding gesture explicitly requests the reviewed Workspace capability bundle locally; Google's returned scope set then decides which members are effective. Shared provider scopes may satisfy the provider side of compatible reads, but writes/sends are never inferred merely because Google granted a technically broader scope. Provider scope changes arriving independently from the local onboarding/review gesture do not create additional local application authority.

## 5. Invariants

- There is no shared Elara OAuth account, credential broker or central refresh-token store.
- Every durable deployment uses credentials and infrastructure controlled by that deployment owner.
- Refresh tokens never cross from the Worker vault into the browser or model/tool surface.
- Browser access tokens are short-lived and memory-only.
- First-time Settings connection uses one explicit GIS gesture to request the reviewed Workspace v1 scope bundle together with account identity.
- Google granular consent remains authoritative: an omitted/denied scope never becomes an effective Elara capability merely because it was requested in the bundle.
- Browser session refresh re-requests the canonical bundle so a fresh short-lived token reflects current Google grant truth; Google normally reuses existing consent where applicable.
- **Review Google permissions** deliberately reopens the same OAuth authority with consent UX when any reviewed Workspace capability is still missing; there is no parallel per-service OAuth authority.
- A known account with no live browser token is not presented as session-ready; the Google screen requires an explicit session refresh before Workspace status cards unlock.
- Existing durable refresh credentials are reused only when stable Google subject identity proves account continuity.
- Provider `invalid_grant` during refresh deletes the unusable durable credential and becomes explicit reauthorization state.
- Provider scopes never insert a locally disabled Elara capability into `enabledCapabilities`.
- Every replacement durable grant advances its revision monotonically, including same-millisecond replacements.
- A durable grant revision change invalidates any browser access-token session bound to the previous revision before Google API egress.
- Ordinary access-token refresh does not manufacture a new grant revision when provider scopes are unchanged.
- Provider grants never auto-promote Elara write/send authority.
- A paired installation never silently falls back to browser-only authorization when its Worker is unavailable.
- OAuth permission and Workspace mutation confirmation remain separate boundaries.
- Browser Google API requests enforce HTTPS plus the approved Google API hostname allowlist.
- Popup authorization-code exchange binds the code to the calling PWA origin.
- Local non-Google capabilities do not require fake provider scopes.

## 6. Security and failure semantics

Worker OAuth writes use the existing installation signing protocol plus a dedicated durable nonce ledger. `/google/oauth/exchange` additionally requires the popup CSRF marker. The Worker restricts browser origins through `ALLOWED_ORIGINS`; self-hosted forks must replace the repository default with their own exact PWA origin.

A missing/revoked refresh grant becomes an explicit reauthorization state. When Google's token endpoint returns `invalid_grant`, the provider code is preserved, the stale durable credential is deleted, and the Worker returns `reauthorization_required`. Temporary Worker/network loss may surface `token-recovery`; it does not erase a known local capability record or broaden authority. Disconnect attempts provider revocation and removes the durable local grant; browser-only mode retains its existing best-effort token revocation behavior.

The Google settings UI separates account/session readiness from stored permission metadata. A reload may preserve account identity and requested capabilities while `sessionReady` is false; the primary account CTA reacquires a live token before Workspace status cards are exposed. Service cards render granted/missing permission chips from effective capability state and do not mutate OAuth authority themselves. Account-switch ambiguity fails closed. If Google omits a replacement refresh token and stable subject continuity cannot be proven, Elara deletes the local durable credential rather than associating an old refresh token with new account metadata. Cross-device grant replacement also fails closed at the browser-token boundary: a changed Worker grant revision clears the still-unexpired local access token and forces retrieval from the current vault authority before API use. Cross-device provider scope expansion does not broaden the local application's requested capability set unless this installation has already requested that capability through its onboarding/review path.

Consequential Google mutations still require the separate `SYS-GWS / google-workspace.md` confirmation boundary after OAuth authorization succeeds.

## 7. Verification and tests

Browser tests cover both authorities: the legacy interactive-only token path and paired durable code exchange/refresh. `code-flow.test.ts` pins popup behavior so an arbitrary `redirect_uri` cannot be reintroduced. Worker tests cover encrypted persistence, refresh without browser interaction, replay rejection, origin mismatch, popup CSRF admission, CORS/authentication and disconnect/revocation.

`worker/test/google-oauth-vault.test.ts` additionally pins safe same-subject refresh-token reuse, rejects cross-account reuse when Google omits a replacement refresh token, proves provider `invalid_grant` deletes the revoked durable credential and returns explicit reauthorization, proves unchanged-scope refresh keeps the same grant revision, and proves a replacement grant advances past an artificially future stored revision. `src/google/oauth/authority.test.ts` pins grant-revision invalidation, proves the stale account's still-unexpired token never reaches Google API egress after the Worker grant changes, and proves paired provider scopes cannot silently enable a locally disabled write capability.

CI has a named `Google OAuth lifecycle regression` step before the broad coverage/Worker suites. It first runs `scripts/google-oauth-lifecycle-gate.mjs` as a structural tripwire, then runs the focused browser and workerd OAuth suites, then runs `scripts/verify-google-oauth-lifecycle-mutations.mjs` for behavioral mutation certification. The mutation verifier temporarily patches the checked-out source, executes the real targeted Vitest/workerd suite against that mutant, requires the specific pinned regression test to fail, and restores the original source before the next mutation and again in a final cleanup path. A compile error or unrelated failing test therefore does not count as a killed mutant.

The behavioral mutation verifier currently executes six hostile mutations: remove stable-subject continuity, remove revoked-grant recovery, remove browser revision invalidation, make unchanged-scope refresh churn the revision, remove monotonic replacement revisions, and reintroduce provider-scope-to-local-capability escalation. Every mutant must be killed by its independent runtime regression test. `scripts/check-verification-integrity.mjs` pins the exact lifecycle command, both certification scripts, all six mutation categories and the ordered CI step so this protection cannot be silently removed by a later cleanup.

Repository security/reliability gates continue to pin the reviewed credential consumers and require durable browser brokerage, signed Worker requests, AES-GCM vaulting, nonce replay protection, the dedicated Durable Object and the isolated Worker composition root.

`e2e/google-oauth-settings.spec.ts` exercises the real Settings flow by stubbing only Google's external GIS/userinfo boundary. It pins the single **Connect Google Workspace** CTA, bundled multi-scope request, provider-granular partial grants, central review action, live-session gating, reload-time session refresh, and disconnect cleanup. `src/google/oauth/authority.test.ts` separately pins the canonical onboarding scope bundle, memory-only access tokens, provider-scope truth and `sessionReady` semantics. Durable Worker behavior is covered by unit + workerd tests because production credentials must never be required by CI.

## 8. Current boundary

Pass 0 establishes durable authorization; it does **not** by itself give cloud autonomy permission to execute Google Workspace tools. Calendar/Tasks/Gmail/Drive/Docs/Sheets expansion and later orchestration must consume this authority through explicit tool/execution contracts. The existence of an encrypted refresh token is not autonomous permission.
