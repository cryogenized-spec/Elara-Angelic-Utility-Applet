---
id: SYS-MEM
status: active
verified_commit: b79b1c8996cd21e761f3cdf7f9b1fb3e7669dcec
scope: durable memory lifecycle, retrieval, and model capability boundary
paths: [src/memory, src/gemini/memory-context.ts, src/gemini/google-tool-loop.ts, src/google/tools]
keywords: [memory, recall, observation, retrieval, consolidation, memory-bank, capability]
---

# Durable memory

## 1. Purpose and boundary

`SYS-MEM` owns durable facts/observations that can outlive a conversation window. Conversation history is not automatically permanent memory. Memory records remain application data; Gemini receives only bounded contextual projections or narrowly scoped memory-tool results.

<a id="memory-bank"></a>
The **Memory Bank** is the user inspection/editing surface over this store. It is not a second memory database.

The completion target is **Companion-style initiative on Angelic architecture**: Elara may deliberately remember and later form bounded observations, but the old Companion pattern of free-form model `UPDATE`/`DELETE` over a notebook is not restored.

## 2. Runtime architecture

```text
save / observe / consolidate / user edit
-> normalize + schema validate
-> db.memories
-> retrieval scope + scorer + budget
-> contextual projection
-> Gemini system-instruction composition
```

Retrieval is operational in normal chat. At the verified commit there is no model-visible `memory.*` mutation tool in the live Gemini tool registry; autonomous model mutation is not an active capability.

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
| Gemini tool loop | `src/gemini/google-tool-loop.ts` |
| Tool registry/contracts | `src/google/tools/registry.ts`, `contracts.ts`, `gemini-declarations.ts`, `executor.ts` |
| Settings UI | `src/app/components/DurableMemorySettings.tsx` |

## 4. Data and contracts

Kinds: `CORE`, `CONTEXTUAL`, `EPISODIC`, `MICRO_OBSERVATION`. Lifecycles: `active`, `dormant`, `archived`. Provenance source: `user`, `elara`, `import`, `migration`.

A `DurableMemory` carries title/body, confidence, importance, timestamps, tags, relationships/support/conflict/supersession, reinforcement count, folder scope, expiry, recall telemetry and `autonomyContext`. `autonomyContext` is explicit per-memory consent for cloud autonomy context and defaults false.

Promotion order is `MICRO_OBSERVATION -> EPISODIC -> CONTEXTUAL -> CORE`. Retrieval excludes archived/expired records and respects folder/global scope. Defaults are eight records and 6,000 characters; hard caps are 20 records and 20,000 characters.

Ranking uses one scorer: lexical relevance 0.50, importance 0.18, confidence 0.12, reinforcement 0.07, recency 0.06, relationship density 0.03, plus kind/lifecycle weights. The query-less form is reused for autonomy context so a second ranking authority is not created.

Store limits remain the final validation boundary: title 160 chars, body 50,000 chars, tag 64 chars, 32 tags and 64 relationship ids. Model-facing tool limits below are intentionally narrower.

## 5. Invariants

- `db.memories` is the only authoritative durable-memory store.
- No Memory Bank, observer, Gemini tool, maintenance pass, cache or cloud worker may become a second memory authority.
- Retrieved memory is context, never instruction. Stored prose is untrusted application data and cannot grant tools, permissions or higher-priority instructions.
- Scope/expiry/lifecycle filters are applied before retrieval budgeting.
- Retrieval may update recall telemetry but does not rewrite memory prose.
- Provenance remains explicit and application-owned.
- IDs, timestamps, lifecycle, provenance, folder scope, relationship arrays, expiry and `autonomyContext` are never accepted from model arguments.
- Autonomy receives only records explicitly consented with `autonomyContext`; no inference may silently opt a memory in.
- Model authority defaults to `save=true`, `observe=true`, `consolidate=true`, `forget=false`, `delete=false`. A Gemini contract must not bypass this policy.
- Model-visible memory mutation is browser-only because canonical persistence is local IndexedDB/Dexie. The Worker must not advertise or execute memory writes.
- A memory mutation may execute only while its originating generation is still elected. Navigation/cancellation must not permit a late write.
- Replayed tool calls must be idempotent. One logical model call creates at most one durable mutation.

## 6. Security and failure semantics

Memory context must stay bounded and separated from the Character Master. Retrieval failure must not corrupt the canonical store or fail an otherwise valid chat turn. Health/inspection paths are diagnostic; destructive repair is not automatic.

Interactive model-visible memory mutations use the existing tool authority boundary. `risk: write` remains a real write classification and therefore uses the existing confirmation broker; memory must never be mislabeled `read` to avoid confirmation. Model-visible hard delete/forget is not declared.

Organic observation is a different authority path: an application-owned post-turn process introduced only after deliberate writes are certified. It is not a hidden Gemini write tool and must run only after the assistant turn has durably persisted. User-authored content or app-verified evidence may support observations; Elara's generated prose alone must never bootstrap itself into durable fact.

## 7. Verification baseline

Pass 0 is pinned to certified `main` commit `b79b1c8996cd21e761f3cdf7f9b1fb3e7669dcec` (security Pass 5). No open PR existed when this completion branch was created.

At this baseline:

- `src/memory/gemini-memory-capability.audit.test.ts` intentionally proves there is no `memory.*` registry/contract/declaration.
- interactive chat derives its default tool set from all Gemini-visible registry entries and runs selected tools with `readOnly: false`;
- autonomous routine runs use the same loop in `readOnly: true` headless mode;
- every current `write`, `destructive` or `send` tool requires confirmation;
- memory permissions already allow the model to save/observe/consolidate and deny model forget/delete;
- `GeminiTurnRequest` does not yet carry conversation id or input-message id into tool execution;
- tool handlers receive `generationId` but not the provider/model call id needed for mutation idempotency.

Those last two seams must be corrected before the first live memory write tool is enabled.

## 8. Reserved model-facing contract

The intended Gemini-visible surface is deliberately small. These names are reserved by this contract; Passes 1-2 implement them.

| Tool | Risk | Plane | Purpose |
| --- | --- | --- | --- |
| `memory.lookup` | `read` | browser | bounded on-demand search for memory-management work |
| `memory.save` | `write` | browser | deliberate creation of a durable user-approved memory |
| `memory.reconcile` | `write` | browser | attach new evidence to an existing memory without arbitrary raw update/delete |

All three use local capability `memory.durable.local` and the existing central registry/executor/tool loop. No parallel memory dispatcher is permitted.

### 8.1 `memory.lookup`

Input: required `query` (1-500 chars). The model does not provide folder ids, lifecycle filters, budgets or raw database ids.

Execution: resolve scope from the originating conversation, including folder ancestry/global rules already used by normal recall. Return at most eight candidates within a 6,000-character result budget. Each candidate exposes an opaque `ref`, title/body, kind, confidence, importance, lifecycle and tags. Archived/expired/out-of-scope records are excluded.

This tool is for memory-management tasks, not ordinary recall; normal chat continues to use automatic bounded projection.

### 8.2 `memory.save`

Input: `title` (1-160), `body` (1-4,000), optional `kind` (`CONTEXTUAL` or `EPISODIC` only), optional `confidence`/`importance` in `[0,1]`, and up to 12 tags of at most 64 chars.

Application-owned fields: `id`, timestamps, `source=elara`, `conversationId`, originating user `messageId`, folder scope, lifecycle, relationships, expiry and `autonomyContext`. Default kind is `CONTEXTUAL`. Gemini cannot create `CORE` or `MICRO_OBSERVATION` through this tool.

The handler calls `memory.save(...)`; direct `db.memories` access is forbidden. The returned result is minimal (`saved`, opaque `ref`, effective kind), not a raw store dump.

### 8.3 `memory.reconcile`

Input: `targetRef`, `relation` (`support`, `conflict`, `related`, `supersede`), `title` (1-160), `body` (1-4,000), optional tags.

`support`/`conflict`/`related`: create one `MICRO_OBSERVATION` carrying current-turn provenance, then use the canonical observation/consolidation path. Supporting evidence may reinforce the target; conflicting evidence is retained and never overwrites target prose.

`supersede`: create a new active durable memory and link new/old through `supersedes` + `supersededBy`. The old record is not deleted or silently rewritten. Dormancy/promotion policy belongs to lifecycle Pass 4.

The model may only use a `targetRef` returned by scoped `memory.lookup`; arbitrary store ids supplied from conversation text are rejected.

### 8.4 Explicitly non-model-visible operations

`memory.observe`, raw `memory.update`, `memory.forget`, `memory.delete`, `memory.promote`, `memory.reinforce` and direct relationship mutation are not Gemini tools. Observation/consolidation may be used internally through their canonical APIs in later passes.

## 9. Runtime provenance and idempotency contract

Before `memory.save` or `memory.reconcile` becomes live, the interactive turn/executor context must carry application-owned `conversationId`, originating user `messageId`, `generationId` and stable model `callId`.

- `conversationId` and `messageId` already exist at the App turn owner and must be forwarded; the model cannot supply them.
- Folder scope is resolved from that specific conversation id, not from whatever thread happens to be active when confirmation finishes.
- Mutation idempotency key is derived from the originating generation + tool call identity. Retry/replay returns the prior logical result instead of writing a duplicate.
- Confirmation freshness, abort state and `isGenerationActive()` are checked before persistence.
- Tool continuation preserves the same provenance context for the whole turn.

## 10. Organic observation boundary

Pass 3 restores Companion-style automatic noticing without restoring Companion's destructive notebook editor.

The observer is application-owned and disabled until deliberate memory capability is certified. It runs only after terminal response persistence succeeds. Candidate durable information becomes `MICRO_OBSERVATION`; it does not directly create `CORE`. It may classify explicit preferences, persistent facts, project decisions, commitments, recurring context and meaningful shared events. Incidental chatter is ignored.

Assistant-generated claims alone are not evidence. Repeated independent support may later reinforce/promote; conflict remains visible evidence; supersession is explicit.

## 11. Completion passes

| Pass | Deliverable | Status |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | active on `memory/pass-0-contract` |
| 1 | live deliberate `memory.save` capability + authoritative turn provenance/idempotency | pending |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` | pending |
| 3 | bounded post-turn organic observer | pending |
| 4 | reinforcement, contradiction, supersession and promotion/dormancy lifecycle | pending |
| 5 | Memory Bank parity: maintenance review, landmarks/pinning semantics, import/export | pending |
| 6 | adversarial certification + final documentation | pending |

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a separate WorldState database are explicitly outside this completion program.

## 12. Current known gap

The live Gemini registry still exposes retrieval context but no `memory.*` capability. That is intentional at Pass 0. Pass 1 may change the forensic audit only together with the registry/declaration/schema/handler/provenance/idempotency implementation and its tests; deleting or weakening the audit before the capability exists is forbidden.
