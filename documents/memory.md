---
id: SYS-MEM
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: durable memory lifecycle and retrieval
paths: [src/memory, src/gemini/memory-context.ts]
keywords: [memory, recall, observation, retrieval, consolidation, memory-bank]
---

# Durable memory

## 1. Purpose and boundary

`SYS-MEM` owns durable facts/observations that can outlive a conversation window. Conversation history is not automatically permanent memory. Memory records remain application data; Gemini receives only a bounded contextual projection.

<a id="memory-bank"></a>
The **Memory Bank** is the user inspection/editing surface over this store. It is not a second memory database.

## 2. Runtime architecture

```text
save / observe / consolidate / user edit
-> normalize + schema validate
-> db.memories
-> retrieval scope + scorer + budget
-> contextual projection
-> Gemini system-instruction composition
```

Retrieval is operational in normal chat. At the verified commit there is no model-visible `memory.*` mutation tool in the live Gemini tool registry; do not describe autonomous model mutation as an active capability.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema/normalization | `src/memory/schema.ts`, `normalize.ts` |
| Store/lifecycle | `src/memory/store.ts` |
| Ranking/budget | `src/memory/retrieval.ts` |
| Observation/consolidation | `src/memory/observation.ts`, related modules |
| Permission policy | `src/memory/permissions.ts`, `capability.ts` |
| Integrity/health | `src/memory/inspection.ts`, `health.ts` |
| Gemini projection | `src/gemini/memory-context.ts` |
| Settings UI | `src/app/components/DurableMemorySettings.tsx` |

## 4. Data and contracts

Kinds: `CORE`, `CONTEXTUAL`, `EPISODIC`, `MICRO_OBSERVATION`. Lifecycles: `active`, `dormant`, `archived`. Provenance source: `user`, `elara`, `import`, `migration`.

A `DurableMemory` carries title/body, confidence, importance, timestamps, tags, relationships/support/conflict/supersession, reinforcement count, folder scope, expiry, recall telemetry and `autonomyContext`. `autonomyContext` is explicit per-memory consent for cloud autonomy context and defaults false.

Promotion order is `MICRO_OBSERVATION -> EPISODIC -> CONTEXTUAL -> CORE`. Retrieval excludes archived/expired records and respects folder/global scope. Defaults are eight records and 6,000 characters; hard caps are 20 records and 20,000 characters.

Ranking uses one scorer: lexical relevance 0.50, importance 0.18, confidence 0.12, reinforcement 0.07, recency 0.06, relationship density 0.03, plus kind/lifecycle weights. The query-less form is reused for autonomy context so a second ranking authority is not created.

## 5. Invariants

- `db.memories` is authoritative for durable memory records.
- Retrieved memory is context, never instruction: formatted projection explicitly says to treat it as contextual notes.
- Scope/expiry/lifecycle filters are applied before budgeting.
- Retrieval records recall metadata but does not rewrite memory prose.
- Elara/user/import/migration provenance remains explicit.
- Autonomy receives only records explicitly consented with `autonomyContext`; no inference may silently opt a memory in.

## 6. Security and failure semantics

Memory context must be bounded and separated from the Character Master. Retrieval failure should not corrupt the canonical store or silently replace it. Health/inspection paths are diagnostic; destructive repair is not automatic. User deletion/archival semantics remain distinct from model authority and are enforced through memory permission code.

## 7. Verification and tests

The `src/memory/` test suite covers schema, permissions, observations, health, inspection, retrieval and capability audit. `src/gemini/memory-context.test.ts` verifies provider projection. Persistence migration behavior is owned by `SYS-PERSIST / persistence.md`.

## 8. Known gaps

The live Gemini registry currently exposes retrieval context but no `memory.*` mutation tools. If model mutation is introduced later, it must reuse the existing permission/capability boundary rather than bypass the Memory Bank or store API.
