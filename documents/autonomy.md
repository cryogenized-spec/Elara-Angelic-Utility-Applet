---
id: SYS-AUTO
status: active
verified_commit: 3ca672db8efe8710bba0bc83d536583c577a9e0e
scope: autonomous routine definitions, scheduling, context and cloud synchronization
paths: [src/autonomy, src/persistence/autonomy.ts, worker/src/autonomy]
keywords: [autonomy, routine, schedule, cloud, durable-object, workflow, pairing]
---

# Autonomy

## 1. Purpose and boundary

`SYS-AUTO` owns opt-in autonomous routines: instruction, schedule, read-only authority, bounded context, execution history and local/cloud synchronization. Autonomy is disabled by default. Routine prose describes work; structured permissions are the authority for what may execute.

The optional self-hosted Worker now also contains a **separate** durable Google OAuth vault under `SYS-GAUTH/SYS-WORKER`. That vault is credential infrastructure, not an autonomy permission store. A stored Google refresh grant does not add Google tools or mutation authority to a routine.

## 2. Runtime architecture

```text
routine + schedule + permissions
-> local authority/context projection
-> local or paired cloud scheduler
-> execution envelope
-> bounded tool surface
-> outcome/history
```

Cloud routines execute in `SYS-WORKER / worker.md` using Worker secrets and memory-pack context. Device routines may use authorized Google read tools plus local context; current Worker scheduling can record device-due work, but browser/device catch-up execution is not yet complete.

### Cloud setup

The user pairs their own Worker URL and installation token from Settings. The client verifies protocol compatibility before synchronization. The same protected device credential may also authenticate browser requests to that deployment's Google OAuth vault, but the OAuth vault independently verifies signed writes and stores its state outside the autonomy database.

The Worker schedules on its configured hourly cron and isolates installation state in its Durable Object/Workflow boundary.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Contracts/schemas | `src/autonomy/contracts.ts` |
| Authority/policy | `src/autonomy/authority.ts`, `policy.ts` |
| Schedule/scheduler | `src/autonomy/schedule.ts`, `scheduler.ts` |
| Context projection | `src/autonomy/context.ts` |
| Local runner | `src/autonomy/runner.ts` |
| Protocol/envelopes | `src/autonomy/protocol.ts`, `envelope.ts` |
| Cloud client/sync | `src/autonomy/cloud/` |
| Installation credential store/pairing | `src/autonomy/cloud/credential.ts`, `pairing.ts` |
| Persistence | `src/persistence/autonomy.ts` |
| Cloud execution | `worker/src/autonomy/` |
| Settings | `AutonomySettings.tsx`, `AutonomyCloud.tsx` |

## 4. Data and contracts

The autonomy context is explicit and bounded. Only memories with per-record `autonomyContext=true` may enter the cloud memory pack. The projection excludes archived/expired records and uses the existing memory ranking authority; current transfer limits are 200 records / 100 KiB. Full transcripts, unconsented memories, memory relationship graphs, folder metadata, artifacts, Google tokens, Lockbox credentials and fetched Google data are not context payloads.

Google refresh/access tokens are not autonomy records. The autonomy database does not persist them, mirror them or infer routine authority from their existence.

Cloud configuration uses generation/identity material so a stale run cannot publish an outcome for superseded configuration. Memory packs are atomically replaced and hashed; absent/stale context degrades the run rather than silently expanding authority.

Current retention bounds include event/history limits in the autonomy persistence/worker contracts; source constants are authoritative if these values change.

## 5. Invariants

- Master autonomy switch off means no scheduled autonomous execution.
- Autonomous authority is structured and read-only unless a future architecture explicitly expands it.
- Google writes remain interactive and confirmation-gated until a later orchestration contract explicitly changes that rule.
- A durable Google refresh grant is credential availability, not tool permission.
- Cloud routines never receive browser OAuth tokens or local Lockbox secrets through the memory/config sync plane.
- Per-memory cloud consent is explicit, default-off and revocable.
- Stale configuration/execution identities fail closed.
- Pairing/installation credentials are device secrets, not ordinary routine data.

## 6. Security and failure semantics

Pairing tokens and Worker secrets remain in their owning runtimes. Protocol inputs are schema-validated. Cloud/device locus is explicit; the Worker must not impersonate unavailable browser-only tools. Missing context, stale generations, incompatible protocol and network failures produce explicit degraded/failed outcomes rather than broadening permissions.

Google OAuth has its own route/vault admission, nonce replay protection and durable credential storage. Autonomy cannot bypass that boundary simply because both systems share a self-hosted Worker deployment.

A runtime AutonomyPairing object is not credential authority by itself. Before returning an in-memory or protected installation token, the pairing layer verifies that shared pairing metadata still identifies the same Worker URL and installation id, and repeats that check after the asynchronous credential boundary. Sibling-tab pairing changes clear the local session-token cache. Unpairing in one tab therefore prevents a stale object in another tab from resurrecting the installation credential.

## 7. Verification and tests

Use `src/autonomy/*.test.ts`, cloud sync/client tests, persistence tests, `worker/test/autonomy-*.test.ts`, `test:workers`, `e2e/autonomy.spec.ts` and `e2e/autonomy-cloud.spec.ts`. Worker verification is additionally covered by dedicated scripts and `SYS-REL / reliability.md`.

Credential-propagation security checks pin the protected pairing store and the only reviewed runtime consumers of the installation token: the autonomy cloud client and Google OAuth authority.

## 8. Known gaps

Notifications/quiet hours, general web tools, device catch-up execution and richer bulk consent management are not current capabilities. Durable Google OAuth now exists, but **cloud Google Workspace execution/orchestration does not**; add that later as an explicit tool/authority contract rather than inferring it from credential availability.
