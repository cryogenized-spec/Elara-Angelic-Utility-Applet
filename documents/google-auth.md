---
id: SYS-GAUTH
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: Google identity, OAuth capability and scope authority
paths: [src/google/oauth]
keywords: [google, oauth, gis, scope, capability, token, account]
---

# Google authorization

## 1. Purpose and boundary

`SYS-GAUTH` owns Google account authorization, capability-to-scope mapping, browser GIS token acquisition, authorization state and approved Google API request boundaries. Workspace tools request application capabilities; they do not handle raw OAuth scopes or tokens themselves.

The current live authority is browser-side Google Identity Services. There is no implemented durable server-side Google refresh-token authority for normal Workspace use.

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
| Browser authority | `src/google/oauth/authority.ts` |
| GIS adapter | `src/google/oauth/gis.ts` |
| Capability policy | `src/google/oauth/capability-policy.ts` |
| Provider scopes | `src/google/oauth/scope-registry.ts` |
| Request brokerage | `src/google/oauth/request-broker.ts` |
| Diagnostics | `src/google/oauth/diagnostics.ts` |
| Settings UI | Google OAuth settings components under `src/app/components/` |

## 4. Data and contracts

The registry maps application capabilities to narrow provider scopes and sensitivity. Calendar/Tasks use dedicated read/write scopes; Gmail read/modify/labels are restricted and send is sensitive; Docs/Sheets/app-file Drive operations use `drive.file`; broader Drive library reads use `drive.readonly` as a distinct capability. Google Chat scopes exist in the registry but Chat remains deferred from Workspace v1.

Effective authorization is the intersection of application-enabled capabilities and provider-satisfied grants. A provider scope that technically permits writing does **not** imply that Elara enabled the matching write capability. `drive.library.read` may satisfy compatible read access but never write authority.

Core connection state is based on the required v1 capability set; optional capabilities such as Gmail labels/send and Drive library search do not redefine the core connection.

## 5. Invariants

- OAuth tokens and provider scope strings never appear in model-visible tool schemas.
- Provider grants never auto-promote application write/send capabilities.
- Access tokens live in memory; small connection/capability metadata may persist separately.
- Requests are restricted to approved Google API hosts.
- Reauthorization is explicit when browser state can no longer silently satisfy a capability.
- Local capabilities such as Roleplay World do not require a fake Google scope.

## 6. Security and failure semantics

Token acquisition failures, denied scopes, account mismatch and reauthorization requirements are normalized to safe diagnostic states. Raw tokens/provider exception detail are not exposed to the model. Consequential Workspace mutations require the separate confirmation boundary in `SYS-GWS / google-workspace.md` even after OAuth capability checks succeed.

## 7. Verification and tests

Use `src/google/oauth/*.test.ts`, scope/capability registry tests, Google service contract tests and relevant Settings/E2E flows. Any scope change must be rechecked against current Google OAuth documentation and production verification requirements.

## 8. Known gaps

Durable offline Google authorization is not implemented. Code-flow/server refresh foundations must not be described as the active browser authority until they actually replace or extend GIS through an explicit architecture change. Gmail restricted scopes require production compliance planning.
