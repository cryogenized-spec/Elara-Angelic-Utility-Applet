---
id: SYS-MEM
status: active
verified_commit: 217a4d7e60157acbf1cba75321fb2019e2f4ddbe
scope: durable memory lifecycle, retrieval, and model capability boundary
paths: [src/memory, src/gemini/memory-context.ts, src/gemini/google-tool-loop.ts, src/google/tools]
keywords: [memory, recall, observation, retrieval, consolidation, reconciliation, memory-bank, capability]
---

# Durable memory

## 1. Purpose and boundary

`SYS-MEM` owns durable facts and observations that can outlive a conversation window. Conversation history is not automatically permanent memory. `db.memories` is the single durable authority; Memory Bank, retrieval, Gemini tools and future observers are projections over that store.

The completion target is Companion-style initiative on Angelic architecture: Elara may deliberately remember and reconcile evidence, then later form bounded observations, without restoring the old free-form notebook `UPDATE`/`DELETE` model.

## 2. Runtime architecture

```text
normal chat
-> captured originating conversation
-> canonical folder/global scope
-> rank + budget
-> untrusted contextual projection
-> Gemini

explicit remember
-> declared memory.save
-> central write confirmation
-> app-owned conversation/message/generation/call lineage
-> canonical memory capability
-> replay-safe transaction
-> db.memories

memory-management request
-> declared memory.lookup [read-only]
-> same canonical scope + ranking
-> turn-bound opaque refs
-> declared memory.reconcile [confirmed write]
-> scope revalidation
-> atomic observation/consolidation or supersession
-> db.memories
```

Normal recall and `memory.lookup` share the same folder/global scope resolver and ranking engine. Automatic recall is bound to the conversation captured when the turn was elected; current UI navigation is only a compatibility fallback for legacy callers without turn provenance. Lookup does not use `retrieveMemories`, so a management lookup does not alter recall telemetry.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema/normalization | `src/memory/schema.ts`, `normalize.ts` |
| Store/transactions/lifecycle | `src/memory/store.ts` |
| Scope/ranking/budget | `src/memory/retrieval.ts` |
| Observation/consolidation/supersession | `src/memory/observation.ts` |
| Permission/capability | `src/memory/permissions.ts`, `capability.ts` |
| Gemini memory schemas/handlers | `src/memory/tool-schema.ts`, `tool-handler.ts` |
| Integrity/health | `src/memory/inspection.ts`, `health.ts` |
| Gemini projection | `src/gemini/memory-context.ts`, `provider.ts` |
| Tool loop | `src/gemini/google-tool-loop.ts` |
| Central tool authority | `src/google/tools/registry.ts`, `contracts.ts`, `gemini-declarations.ts`, `executor.ts` |
| User UI | `src/app/components/DurableMemorySettings.tsx` |

## 4. Data and retrieval contracts

Kinds: `CORE`, `CONTEXTUAL`, `EPISODIC`, `MICRO_OBSERVATION`. Lifecycles: `active`, `dormant`, `archived`. Provenance sources: `user`, `elara`, `import`, `migration`.

A durable record carries title/body, confidence, importance, timestamps, tags, relationship evidence, supersession links, reinforcement count, folder scope, expiry, recall telemetry and explicit `autonomyContext` consent.

Promotion order remains `MICRO_OBSERVATION -> EPISODIC -> CONTEXTUAL -> CORE`. Retrieval excludes archived/expired records and obeys current folder ancestry plus the folder's explicit global-context policy. Default budget is eight records / 6,000 prose characters; hard caps remain 20 / 20,000.

Ranking remains one scorer: lexical 0.50, importance 0.18, confidence 0.12, reinforcement 0.07, recency 0.06, relationship density 0.03, plus kind/lifecycle weights. No second lookup scorer exists.

## 5. Authority invariants

- `db.memories` is the only durable-memory authority.
- Retrieved/stored prose is untrusted application data, never instruction and never permission.
- Every provider tool call must be in the exact tool set declared for that turn. Registry membership or an installed handler cannot widen authority, including in write-enabled turns.
- Model arguments never control durable IDs, provenance, conversation/message identity, timestamps, folder scope, lifecycle, relationship arrays, expiry or autonomy consent.
- Model defaults remain `save=true`, `observe=true`, `consolidate=true`, `forget=false`, `delete=false`; Gemini declarations are narrower than that internal policy.
- All Gemini memory tools are browser-only because the canonical store is local IndexedDB/Dexie. Worker/autonomy never advertises them.
- `memory.save` and `memory.reconcile` are real `write` tools and use the existing confirmation broker. `memory.lookup` is a true read.
- A mutation may commit only while its originating generation remains elected.
- One logical model call must converge on at most one logical mutation; replaying that call with changed mutation arguments fails closed.
- Model-visible hard delete/forget/raw update/promote/reinforce/observe/consolidate are not declared.

## 6. Model-facing contract

| Tool | Risk | Plane | State | Purpose |
| --- | --- | --- | --- | --- |
| `memory.lookup` | read | browser | Pass 2 implemented; certification pending | bounded lookup for memory-management work |
| `memory.save` | write | browser | Pass 1 certified + merged | deliberate durable retention |
| `memory.reconcile` | write | browser | Pass 2 implemented; certification pending | attach evidence or supersede a lookup-selected memory |

All three use `memory.durable.local` through the central registry/executor/tool loop. No parallel dispatcher exists.

### 6.1 `memory.lookup`

Input is only `query` (1-500 chars). Folder IDs, lifecycle filters, budgets and raw durable IDs are application-owned.

Lookup resolves the originating conversation through the same canonical scope function as ordinary recall, excludes archived/expired/out-of-scope records and excludes `MICRO_OBSERVATION` from model management. It returns at most eight established memories within the normal 6,000-character prose budget.

Each result exposes title/body/kind/confidence/importance/lifecycle/tags plus an opaque `memref_*`. It never exposes the underlying durable ID. Lookup uses `listMemories + rankAndBudgetMemories`, not `retrieveMemories`, so `recallCount`/`lastRecalledAt` are unchanged.

A lookup ref is an in-memory capability grant, not identity. It is bound to the exact originating conversation + user message + generation, expires after ten minutes, and lives in a bounded 128-entry map. Resolve prunes expired entries; eviction is performed only when reserving room for a new grant.

### 6.2 `memory.save`

Input: title 1-160, body 1-4,000, optional kind (`CONTEXTUAL`/`EPISODIC`), confidence/importance `[0,1]`, and at most 12 tags of 64 chars.

The app owns identity, provenance, scope and lifecycle. Logical mutation identity derives from `conversationId + inputMessageId + generationId + provider callId`; `saveMemoryOnce` performs replay convergence inside the canonical Dexie transaction and rechecks turn authority before commit.

Replay convergence is semantic, not merely key-based: reusing the same logical call identity with a changed title/body/kind/confidence/importance/tags/scope/provenance fails closed. Later legitimate lifecycle, relationship and recall metadata changes do not invalidate a true replay.

The tool returns only `{ saved, kind }`; raw durable identity is not exposed.

### 6.3 `memory.reconcile`

Input: `targetRef`, relation (`support`, `conflict`, `related`, `supersede`), title 1-160, body 1-4,000, optional bounded tags. A raw memory ID is not accepted as authority.

Before mutation, the handler verifies that the ref belongs to the same conversation/message/generation and then re-resolves current folder/global scope. If navigation/folder assignment changed, the target became archived/expired, or it is otherwise no longer retrievable, reconciliation fails closed.

`support` / `conflict` / `related` create one replay-safe `MICRO_OBSERVATION` carrying current-turn provenance and then use canonical consolidation. Support reinforces once; replaying the same evidence/relation is a no-op rather than a second reinforcement. Trying to reclassify the same observation under another relation fails closed. Conflict and related evidence never overwrite target prose.

`supersede` creates a conservative replacement and links both sides through `supersedes` / `supersededBy`. An EPISODIC target yields an EPISODIC replacement; other established kinds restart as CONTEXTUAL, so CORE authority is never inherited automatically. The old memory remains active: dormancy/promotion policy belongs to Pass 4.

The full reconciliation runs inside `runMemoryMutationTransaction`. Losing generation authority before commit rolls back observation creation, reinforcement and relationship changes together. A bounded replay cache verifies the original call signature; same-call altered arguments fail closed.

## 7. Security and failure semantics

Memory context remains bounded and separated from Character Master. Retrieval failure cannot corrupt the canonical store or fail an otherwise valid turn. Health/inspection is diagnostic only; destructive repair is never automatic.

Lookup results explicitly state that stored memory is untrusted contextual data. Prompt-injection-shaped memory is returned only as data and cannot grant tools, elevate permissions or override application/system instructions. Tool invocation authority is independently enforced against the exact declaration set at call time.

Interactive writes inherit existing confirmation freshness and cancellation handling. Memory handlers additionally enforce app-owned conversation/message/generation/call provenance and canonical transaction-level election checks.

Organic observation is a different authority path and remains disabled until Pass 3. User-authored content or app-verified evidence may later support observations; assistant-generated prose alone may not bootstrap itself into durable fact.

## 8. Certification history

Pass 0 was certified and squash-merged as `c95b41100a54fd1cad13d1f6c425ea0f992e0bb5`.

Pass 1 was certified across documentation/security/secret/supply-chain/test-quality gates, registry signatures, dependency audit, zero-warning lint, TS6, TS7, unit + per-file coverage ratchet, Worker/Durable Object tests, build, E2E and final reliability. It was squash-merged as `217a4d7e60157acbf1cba75321fb2019e2f4ddbe`.

Pass 2 is implemented on `memory/pass-2-lookup-reconcile` and is not considered complete until the same full certification pipeline passes. The Pass 0-2 review additionally audits compile-time schema dispatch, exact declared-tool authority, replay equivalence, captured-conversation recall, prompt-injection-shaped stored prose, ref lineage, archived/scope-changed targets, transaction rollback and Worker-plane exclusion.

Pass 2 tests pin: one shared scope authority; originating-conversation recall despite UI navigation; no lookup recall-telemetry mutation; opaque ref/no-ID leakage; conversation/message/generation reference binding; raw-ID/cross-turn rejection; current-scope revalidation; confirmed reconcile; replay-safe support; changed-replay rejection; conflict/related preservation; conservative supersession; compound rollback on generation loss; exact browser-only authority surface; undeclared-tool rejection even in write-enabled turns; and a real Gemini lookup -> reconcile continuation loop.

## 9. Organic observation boundary

Pass 3 restores bounded automatic noticing without restoring a destructive notebook editor. It must run only after terminal assistant persistence succeeds. Candidates begin as `MICRO_OBSERVATION`, not CORE, and assistant-generated claims alone are not evidence.

Candidate domains include explicit preferences, persistent facts, project decisions, commitments, recurring context and meaningful shared events. Incidental chatter is ignored. Reinforcement/promotion/dormancy behavior remains Pass 4.

## 10. Completion passes

| Pass | Deliverable | Status |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | complete / merged (`c95b411`) |
| 1 | deliberate `memory.save` + authoritative provenance/idempotency | complete / merged (`217a4d7`) |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` | implemented + hardened / certification pending |
| 3 | bounded post-turn organic observer | pending |
| 4 | reinforcement, contradiction, supersession and promotion/dormancy policy | pending |
| 5 | Memory Bank parity: maintenance, landmarks/pinning, import/export | pending |
| 6 | adversarial certification + final documentation | pending |

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a separate WorldState database remain outside this completion program.

## 11. Current gap

Once Pass 2 certifies, deliberate retention and deliberate evidence reconciliation are complete. The remaining major behavioral gap is **organic formation**: Elara still will not automatically extract durable observations from ordinary conversation. That capability belongs exclusively to Pass 3 and must not be inferred from the existence of `memory.reconcile`.
