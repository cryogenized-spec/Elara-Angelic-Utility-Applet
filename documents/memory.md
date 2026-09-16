---
id: SYS-MEM
status: active
verified_commit: c95b41100a54fd1cad13d1f6c425ea0f992e0bb5
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
normal recall
-> scoped retrieval + scorer + budget
-> contextual projection
-> Gemini system-instruction composition

explicit user-approved remember request
-> Gemini memory.save proposal
-> bounded tool schema
-> existing write-confirmation broker
-> application-owned turn provenance + folder scope
-> memory capability permission boundary
-> replay-safe canonical save transaction
-> db.memories
```

Normal retrieval remains operational in chat and is independent of the write tool. Pass 1 introduces only deliberate `memory.save`; `memory.lookup`, `memory.reconcile`, organic observation and model-visible forget/delete remain unavailable until their later passes.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema/normalization | `src/memory/schema.ts`, `normalize.ts` |
| Store/lifecycle | `src/memory/store.ts` |
| Ranking/budget | `src/memory/retrieval.ts` |
| Observation/consolidation | `src/memory/observation.ts`, related modules |
| Permission policy | `src/memory/permissions.ts`, `capability.ts` |
| Gemini memory tool schema | `src/memory/tool-schema.ts` |
| Gemini memory tool handler | `src/memory/tool-handler.ts` |
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

Store limits remain the final validation boundary: title 160 chars, body 50,000 chars, tag 64 chars, 32 tags and 64 relationship ids. Model-facing `memory.save` is intentionally narrower: title 160, body 4,000, at most 12 tags and only `CONTEXTUAL`/`EPISODIC` kinds.

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

Interactive model-visible memory mutations use the existing tool authority boundary. `memory.save` is classified `risk: write`, so it uses the same existing confirmation broker and freshness/replay protections as other interactive writes; memory is never mislabeled `read` to avoid confirmation. Model-visible hard delete/forget is not declared.

`memory.save` is browser-only (`executionPlane: browser`) and uses local capability `memory.durable.local`. The Worker plane therefore does not receive its Gemini declaration. Autonomous routines remain read-only/headless and cannot acquire this mutation path.

Organic observation is a different authority path: an application-owned post-turn process introduced only after deliberate writes are certified. It is not a hidden Gemini write tool and must run only after the assistant turn has durably persisted. User-authored content or app-verified evidence may support observations; Elara's generated prose alone must never bootstrap itself into durable fact.

## 7. Verification baseline

Pass 0 was certified on branch commit `97f37f071e2fc51e83f9bc4479c18d806c54297d` and squash-merged as `c95b41100a54fd1cad13d1f6c425ea0f992e0bb5`. Its CI passed architecture/security gates, lint, TypeScript 6 and 7 checks, unit/coverage, Worker/Durable Object tests, build, E2E and final reliability verification.

Pass 1 is implemented on `memory/pass-1-deliberate-save` and remains **uncertified until that branch's CI completes**. Its verification suite pins the following behavior:

- exactly one Gemini-visible `memory.*` operation exists: `memory.save`;
- `memory.save` is a browser-only write and absent from Worker declarations;
- model arguments are strict/bounded and cannot contain app-owned durable fields;
- application-owned conversation id, input-message id, generation id and provider call id are carried into tool execution;
- folder scope resolves from the captured conversation, not current UI navigation state;
- save uses the canonical `memory.save(...)` capability rather than direct DB writes;
- replay of one generation/call pair converges on one record;
- loss of generation authority before transaction commit aborts/rolls back the mutation;
- destructive/future memory tools remain undeclared.

## 8. Model-facing contract

The completion surface remains deliberately small. Pass 1 implements only `memory.save`; Pass 2 adds lookup/reconciliation after this path is certified.

| Tool | Risk | Plane | State | Purpose |
| --- | --- | --- | --- | --- |
| `memory.lookup` | `read` | browser | Pass 2 pending | bounded on-demand search for memory-management work |
| `memory.save` | `write` | browser | Pass 1 implemented, certification pending | deliberate creation of a durable user-approved memory |
| `memory.reconcile` | `write` | browser | Pass 2 pending | attach new evidence to an existing memory without arbitrary raw update/delete |

All three use local capability `memory.durable.local` and the existing central registry/executor/tool loop. No parallel memory dispatcher is permitted.

### 8.1 `memory.lookup`

Input: required `query` (1-500 chars). The model does not provide folder ids, lifecycle filters, budgets or raw database ids.

Execution: resolve scope from the originating conversation, including folder ancestry/global rules already used by normal recall. Return at most eight candidates within a 6,000-character result budget. Each candidate exposes an opaque `ref`, title/body, kind, confidence, importance, lifecycle and tags. Archived/expired/out-of-scope records are excluded.

This tool is for memory-management tasks, not ordinary recall; normal chat continues to use automatic bounded projection.

### 8.2 `memory.save`

Input: `title` (1-160), `body` (1-4,000), optional `kind` (`CONTEXTUAL` or `EPISODIC` only), optional `confidence`/`importance` in `[0,1]`, and up to 12 tags of at most 64 chars.

Application-owned fields: `id`, timestamps, `source=elara`, `conversationId`, originating user `messageId`, folder scope, lifecycle, relationships, expiry and `autonomyContext`. Default kind is `CONTEXTUAL`. Gemini cannot create `CORE` or `MICRO_OBSERVATION` through this tool.

The handler validates the bounded schema, resolves the originating conversation's folder, and calls `memory.save(...)`; direct `db.memories` access from the tool handler is forbidden. The returned result is minimal (`saved`, opaque `ref`, effective kind), not a raw store dump.

The logical mutation identity is application-derived from `generationId + provider callId`. The canonical capability stores that key as bounded provenance metadata and `saveMemoryOnce` resolves replay inside one Dexie transaction. If generation authority is lost while persistence is settling, the transaction throws before commit and rolls back.

### 8.3 `memory.reconcile`

Input: `targetRef`, `relation` (`support`, `conflict`, `related`, `supersede`), `title` (1-160), `body` (1-4,000), optional tags.

`support`/`conflict`/`related`: create one `MICRO_OBSERVATION` carrying current-turn provenance, then use the canonical observation/consolidation path. Supporting evidence may reinforce the target; conflicting evidence is retained and never overwrites target prose.

`supersede`: create a new active durable memory and link new/old through `supersedes` + `supersededBy`. The old record is not deleted or silently rewritten. Dormancy/promotion policy belongs to lifecycle Pass 4.

The model may only use a `targetRef` returned by scoped `memory.lookup`; arbitrary store ids supplied from conversation text are rejected.

### 8.4 Explicitly non-model-visible operations

`memory.observe`, raw `memory.update`, `memory.forget`, `memory.delete`, `memory.promote`, `memory.reinforce` and direct relationship mutation are not Gemini tools. Observation/consolidation may be used internally through their canonical APIs in later passes.

## 9. Runtime provenance and idempotency contract

Interactive tool execution carries application-owned `conversationId`, originating user `messageId`, `generationId` and stable provider `callId`.

- App owns `conversationId` and `messageId`; the model cannot supply them.
- The tool loop forwards those identifiers into the central executor for the entire originating turn.
- The executor preserves provider `callId` outside model arguments and supplies it to handlers.
- Folder scope is resolved from the captured conversation id, not from whatever thread is active when confirmation finishes.
- Mutation idempotency key is derived from generation + call identity. Retry/replay returns the prior logical result instead of writing a duplicate.
- Confirmation freshness, abort state and `isGenerationActive()` are checked before execution; the memory transaction also rechecks turn authority immediately before commit.
- Tool continuation cannot rewrite the application-owned provenance context.

## 10. Organic observation boundary

Pass 3 restores Companion-style automatic noticing without restoring Companion's destructive notebook editor.

The observer is application-owned and disabled until deliberate memory capability is certified. It runs only after terminal response persistence succeeds. Candidate durable information becomes `MICRO_OBSERVATION`; it does not directly create `CORE`. It may classify explicit preferences, persistent facts, project decisions, commitments, recurring context and meaningful shared events. Incidental chatter is ignored.

Assistant-generated claims alone are not evidence. Repeated independent support may later reinforce/promote; conflict remains visible evidence; supersession is explicit.

## 11. Completion passes

| Pass | Deliverable | Status |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | complete / merged (`c95b411`) |
| 1 | live deliberate `memory.save` capability + authoritative turn provenance/idempotency | implemented / certification pending |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` | pending |
| 3 | bounded post-turn organic observer | pending |
| 4 | reinforcement, contradiction, supersession and promotion/dormancy lifecycle | pending |
| 5 | Memory Bank parity: maintenance review, landmarks/pinning semantics, import/export | pending |
| 6 | adversarial certification + final documentation | pending |

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a separate WorldState database are explicitly outside this completion program.

## 12. Current known gaps

At Pass 1, deliberate user-approved saving is the only new model memory capability. Elara still cannot query internal memory references on demand, reconcile new evidence with existing records, autonomously form post-turn observations, or perform model-visible forgetting/deletion. Those omissions are intentional and define the boundaries of Passes 2-3 rather than incompleteness in Pass 1.
