---
id: SYS-GAUTH
status: active
verified_commit: c9650583b813b6914d8f3f11161e646215330421
scope: Google identity, OAuth capability and scope authority
paths: [src/google/oauth]
keywords: [google, oauth, gis, scope, capability, token, account]
---

# Google authorization

## 1. Purpose and boundary

`SYS-GAUTH` owns Google account authorization, capability-to-scope mapping, browser GIS token acquisition, authorization state and approved Google API request boundaries. Workspace tools request application capabilities; they do not handle raw OAuth scopes or tokens themselves.

The current live authority is browser-side Google Identity Services. The product is intentionally self-contained for this boundary: no external Google-auth server, durable browser refresh-token store or second authorization Worker is part of the active architecture.

## 2. Runtime architecture

```text
application capability
-> scope registry
-> enabled capability policy
-> GIS authorization/token acquisition
-> effective capability check
-> approved Google API fetch
```

Authorization is capability-driven and incremental. Provider grants are evidence, not permission to silently enable broader application capabilities.

## 3. Source map

| Concern | Authority |
| --- | --- |
| OAuth contracts/state | `src/google/oauth/contracts.ts` |
| Browser authority + persisted auth metadata | `src/google/oauth/authority.ts` |
| GIS adapter | `src/google/oauth/gis.ts` |
| Capability policy | `src/google/oauth/capability-policy.ts` |
| Provider scopes | `src/google/oauth/scope-registry.ts` |
| Request brokerage | `src/google/oauth/request-broker.ts` |
| Diagnostics | `src/google/oauth/diagnostics.ts` |
| Settings UI | `src/app/components/GoogleOAuthSettings.tsx` |

`src/google/oauth/code-flow.ts` is unit-tested but unreferenced by the live authority. It is not an implemented authorization boundary.

## 4. Data and contracts

The registry maps application capabilities to narrow provider scopes and sensitivity. Calendar/Tasks use dedicated read/write scopes; Gmail read/modify/labels are restricted and send is sensitive; Docs/Sheets/app-file Drive operations use `drive.file`; broader Drive library reads use `drive.readonly` as a distinct capability. Google Chat scopes exist in the registry but Chat remains deferred from Workspace v1.

Effective authorization is the intersection of application-enabled capabilities and provider-satisfied grants. A provider scope that technically permits writing does **not** imply that Elara enabled the matching write capability. `drive.library.read` may satisfy compatible read access but never write authority.

The persisted authorization record is version 3 and stores enabled capabilities, current provider scopes, optional account metadata, optional reauthorization state and an update timestamp. The storage key retains its historical `elara.google.authorization.v2` name; the record version, not the key name, determines the current schema. Access tokens remain memory-only.

After successful GIS token acquisition, `authority.ts` best-effort resolves Google userinfo and is the production writer for `account.email` and optional `account.displayName`. Interactive acquisition clears stale account identity when userinfo cannot establish the current account; silent refresh may preserve the previous identity when lookup fails.

Core connection state is based on the required v1 capability set; optional capabilities such as Gmail labels/send and Drive library search do not redefine the core connection.

## 5. Invariants

- OAuth tokens and provider scope strings never appear in model-visible tool schemas.
- Provider grants never auto-promote application write/send capabilities.
- Access tokens live in memory; small connection/capability/account metadata may persist separately.
- Account identity has one production writer: successful browser authorization in `authority.ts`; tests may stub provider responses but must not treat forged stored identity as evidence that the writer works.
- Requests are restricted to approved Google API hosts.
- Reauthorization is explicit when browser state can no longer silently satisfy a capability.
- Local capabilities such as Roleplay World do not require a fake Google scope.

## 6. Security and failure semantics

Token acquisition failures, denied scopes, account mismatch and reauthorization requirements are normalized to safe diagnostic states. Raw tokens/provider exception detail are not exposed to the model. Consequential Workspace mutations require the separate confirmation boundary in `SYS-GWS / google-workspace.md` even after OAuth capability checks succeed.

## 7. Verification and tests

Use `src/google/oauth/*.test.ts`, scope/capability registry tests, Google service contract tests and relevant Settings/E2E flows. Any scope change must be rechecked against current Google OAuth documentation and production verification requirements.

At the verified commit, `e2e/google-oauth-settings.spec.ts` seeds a version-3 local authorization record directly. That proves Settings can read/render normalized stored state, but it does **not** prove the real GIS -> userinfo -> account writer path. Keep writer coverage separate and honest.

## 8. Known gaps

Durable offline refresh-token authorization is intentionally outside the active self-contained architecture unless a future explicit decision reopens it. Do not describe `code-flow.ts` or old server-refresh designs as live capability.

The Settings E2E should eventually drive or stub the real external GIS/userinfo boundary rather than forging production app state when claiming end-to-end account-identity coverage.
