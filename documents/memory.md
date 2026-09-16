---
id: SYS-MEM
status: active
verified_commit: 6d4c90677d00fdc4c4df9b717859e08e42dbfb24
scope: durable memory lifecycle, retrieval, model capabilities, and organic observation
paths: [src/memory, src/gemini/memory-context.ts, src/gemini/memory-observer.ts, src/gemini/google-tool-loop.ts, src/chat/generation-sync.ts, src/google/tools]
keywords: [memory, recall, observation, retrieval, consolidation, reconciliation, organic-observer, memory-bank, capability]
---

# Durable memory

## 1. Purpose and boundary

`SYS-MEM` owns durable facts and observations that can outlive a conversation window. Conversation history is not automatically permanent memory. `db.memories` is the single durable authority; Memory Bank, recall, Gemini tools and the organic observer are projections over that store.

The target is Companion-style initiative on Angelic architecture: Elara may deliberately remember, reconcile evidence, and form bounded observations without restoring the old free-form notebook `UPDATE`/`DELETE` model or allowing assistant prose to bootstrap itself into fact.

## 2. Runtime architecture

```text
normal chat
-> captured originating conversation
-> canonical folder/global scope
-> rank + budget
-> untrusted contextual projection
-> freeze one composed instruction for the elected turn
-> Gemini initial interaction + every tool continuation
-> terminal assistant response
-> durable conversation save
-> bounded organic classifier [user message only]
-> exact-span validation + app-owned metadata
-> replay-safe MICRO_OBSERVATION transaction
-> db.memories
-> unlock next turn

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

Normal recall and `memory.lookup` share the same folder/global scope resolver and ranking engine. Automatic recall is bound to the conversation captured when the turn was elected; current UI navigation is only a compatibility fallback for legacy callers without turn provenance. Lookup does not use `retrieveMemories`, so management lookup does not alter recall telemetry.

Gemini Interactions treats `system_instruction` as interaction-scoped rather than conversation-history state. Interactive tool turns therefore compose durable memory once at the elected top-level turn, pass the provider `memoryContext: none`, and reuse that exact composed instruction for every tool-result continuation. Memory is neither dropped after a tool call nor re-retrieved mid-turn after a mutation.

Organic formation is downstream of conversation durability. `generation-sync.ts` extends the existing terminal persistence promise rather than creating another queue or lifecycle owner: the assistant response must save first; observer failure cannot roll that response back; the composer remains in `saving` until the bounded observer stage completes or safely degrades.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema/normalization | `src/memory/schema.ts`, `normalize.ts` |
| Store/transactions/lifecycle | `src/memory/store.ts` |
| Scope/ranking/budget | `src/memory/retrieval.ts` |
| Observation/consolidation/supersession | `src/memory/observation.ts` |
| Organic observation policy/write path | `src/memory/organic-observer.ts` |
| Organic Gemini classifier | `src/gemini/memory-observer.ts` |
| Permission/capability | `src/memory/permissions.ts`, `capability.ts` |
| Gemini memory schemas/handlers | `src/memory/tool-schema.ts`, `tool-handler.ts` |
| Integrity/health | `src/memory/inspection.ts`, `health.ts` |
| Gemini recall projection | `src/gemini/memory-context.ts`, `provider.ts` |
| Tool loop | `src/gemini/google-tool-loop.ts` |
| Terminal persistence barrier | `src/chat/generation-sync.ts` |
| Central tool authority | `src/google/tools/registry.ts`, `contracts.ts`, `gemini-declarations.ts`, `executor.ts` |
| User UI | `src/app/components/DurableMemorySettings.tsx` |

## 4. Data and retrieval contracts

Kinds: `CORE`, `CONTEXTUAL`, `EPISODIC`, `MICRO_OBSERVATION`. Lifecycles: `active`, `dormant`, `archived`. Provenance sources: `user`, `elara`, `import`, `migration`.

A durable record carries title/body, confidence, importance, timestamps, tags, relationship evidence, supersession links, reinforcement count, folder scope, expiry, recall telemetry and explicit `autonomyContext` consent.

Promotion order remains `MICRO_OBSERVATION -> EPISODIC -> CONTEXTUAL -> CORE`. Retrieval excludes archived/expired records and obeys current folder ancestry plus the folder's explicit global-context policy. Default budget is eight records / 6,000 prose characters; hard caps remain 20 / 20,000.

Ranking remains one scorer: lexical 0.50, importance 0.18, confidence 0.12, reinforcement 0.07, recency 0.06, relationship density 0.03, plus kind/lifecycle weights. No second lookup scorer exists.

Organic observations deliberately start below explicit durable saves: `kind=MICRO_OBSERVATION`, confidence `0.60`, importance `0.35`, tags `organic` + `domain:<domain>`. The classifier cannot override those values.

## 5. Authority invariants

- `db.memories` is the only durable-memory authority.
- Retrieved/stored prose is untrusted application data, never instruction and never permission.
- Every provider tool call must be in the exact tool set declared for that turn. Registry membership or an installed handler cannot widen authority, including in write-enabled turns.
- Model tool arguments never control durable IDs, provenance, conversation/message identity, timestamps, folder scope, lifecycle, relationship arrays, expiry or autonomy consent.
- Model defaults remain `save=true`, `observe=true`, `consolidate=true`, `forget=false`, `delete=false`; Gemini declarations are narrower than that internal policy.
- All Gemini memory tools are browser-only because the canonical store is local IndexedDB/Dexie. Worker/autonomy never advertises them.
- `memory.save` and `memory.reconcile` are real `write` tools and use the existing confirmation broker. `memory.lookup` is a true read.
- A live model-tool mutation may commit only while its originating generation remains elected.
- One logical model call must converge on at most one logical mutation; replaying that call with changed mutation arguments fails closed.
- Tool continuations reuse one frozen bounded-memory instruction for the entire elected turn; a mutation cannot rewrite model context halfway through that turn.
- Model-visible hard delete/forget/raw update/promote/reinforce/observe/consolidate are not declared.
- Organic observation starts only after the user turn and assistant response are durable. It receives no assistant-response evidence and cannot create established memory directly.
- Organic classifier output has no write authority. Only exact verbatim spans that occur in the persisted user message can pass application validation.

## 6. Model-facing contract

| Tool | Risk | Plane | State | Purpose |
| --- | --- | --- | --- | --- |
| `memory.lookup` | read | browser | Pass 2 certified + merged | bounded lookup for memory-management work |
| `memory.save` | write | browser | Pass 1 certified + merged | deliberate durable retention |
| `memory.reconcile` | write | browser | Pass 2 certified + merged | attach evidence or supersede a lookup-selected memory |

All three use `memory.durable.local` through the central registry/executor/tool loop. Normal interactive chat derives its offered tool list from the Gemini-visible registry; Worker/autonomy derives a separate execution-plane surface. No parallel memory dispatcher exists. Phase 3 adds no model-visible memory tool.

### 6.1 `memory.lookup`

Input is only `query` (1-500 chars). Folder IDs, lifecycle filters, budgets and raw durable IDs are application-owned.

Lookup resolves the originating conversation through the same canonical scope function as ordinary recall, excludes archived/expired/out-of-scope records and excludes `MICRO_OBSERVATION` from model management. It returns at most eight established memories within the normal 6,000-character prose budget.

Each result exposes title/body/kind/confidence/importance/lifecycle/tags plus an opaque `memref_*`. It never exposes the underlying durable ID. Lookup uses `listMemories + rankAndBudgetMemories`, not `retrieveMemories`, so `recallCount`/`lastRecalledAt` are unchanged.

A lookup ref is an in-memory capability grant, not identity. It is bound to the exact originating conversation + user message + generation, expires after ten minutes, and lives in a bounded 128-entry map.

### 6.2 `memory.save`

Input: title 1-160, body 1-4,000, optional kind (`CONTEXTUAL`/`EPISODIC`), confidence/importance `[0,1]`, and at most 12 tags of 64 chars.

The app owns identity, provenance, scope and lifecycle. Logical mutation identity derives from `conversationId + inputMessageId + generationId + provider callId`; `saveMemoryOnce` performs replay convergence inside the canonical Dexie transaction and rechecks turn authority before commit. Normal bounded keys remain human-readable in provenance; an overlong full-lineage key is represented by a SHA-256 marker rather than truncated.

Replay convergence is semantic, not merely key-based: reusing the same logical call identity with a changed title/body/kind/confidence/importance/tags/scope/provenance fails closed. Later legitimate lifecycle, relationship and recall metadata changes do not invalidate a true replay.

The tool returns only `{ saved, kind }`; raw durable identity is not exposed.

### 6.3 `memory.reconcile`

Input: `targetRef`, relation (`support`, `conflict`, `related`, `supersede`), title 1-160, body 1-4,000, optional bounded tags. A raw memory ID is not accepted as authority.

Before mutation, the handler verifies that the ref belongs to the same conversation/message/generation and then re-resolves current folder/global scope. If the target became archived/expired or otherwise left scope, reconciliation fails closed.

`support` / `conflict` / `related` create one replay-safe `MICRO_OBSERVATION` and use canonical consolidation. Support reinforces once; same-relation replay is a no-op; relation reclassification fails closed. Conflict/related evidence never overwrite target prose.

`supersede` creates a conservative replacement and links both sides through `supersedes` / `supersededBy`. An EPISODIC target yields an EPISODIC replacement; other established kinds restart as CONTEXTUAL, so CORE authority is never inherited automatically. The old memory remains active; dormancy/promotion belongs to Pass 4.

The full reconciliation runs inside `runMemoryMutationTransaction`. Losing generation authority before commit rolls back the compound operation.

## 7. Organic observer contract

### 7.1 Evidence boundary

The classifier receives at most 6,000 characters from the current persisted user message. It receives no assistant response, no retrieved durable memory, no Character Master and no tools. Its only useful output is strict JSON containing at most three `{domain,evidence}` candidates.

Allowed domains: `preference`, `persistent_fact`, `project_decision`, `commitment`, `recurring_context`, `shared_event`. `evidence` is capped at 500 characters and must be an exact substring of the full user message. Paraphrases/inferences are discarded. Malformed or extra-property output fails closed. Obvious credential-shaped evidence is deterministically rejected in application code; the classifier is additionally instructed not to select highly sensitive personal facts for automatic persistence.

The Gemini classifier uses the one canonical browser provider with `memoryContext: none` and an empty tool list. It has an eight-second internal timeout and a 4,000-character output ceiling. Provider failure, invalid JSON, timeout or cancellation becomes a non-fatal unavailable observer result.

### 7.2 Write boundary

Accepted candidates are converted by application code into app-titled, app-tagged low-weight `MICRO_OBSERVATION` records. The classifier never chooses the memory title, kind, confidence, importance, provenance, folder scope or durable identity.

Each write uses the existing `recordObservation -> memory.save -> saveMemoryOnce -> db.memories` path and the existing permission policy. A stable idempotency identity derives from conversation + user message + domain + exact evidence, so a retry of the same persisted user evidence converges on one record even if the assistant generation changes.

At most three accepted candidates are written inside one canonical memory transaction. A deliberate `memory.*` tool turn skips organic formation. Regeneration variants (`responseVariant > 1`) skip organic formation; a failed first response cannot form memory because its conversation save never crossed the durability boundary.

### 7.3 Turn lifecycle

`generation-sync.ts` hands the App one terminal promise covering both stages:

```text
save completed conversation
-> if save fails: reject; no observer
-> if save succeeds: run bounded observer
-> observer records / returns empty / safely degrades
-> resolve terminal barrier
-> App refreshes thread list, unlocks composer, releases generation
```

After the conversation save succeeds, the durable turn—not the currently visible UI thread—is sufficient authority for this best-effort post-turn observation. Navigating during `saving` therefore does not create a second lifecycle or silently roll back the already-saved reply.

## 8. Security and failure semantics

Memory context remains bounded and separated from Character Master. Retrieval failure cannot corrupt the canonical store or fail an otherwise valid turn. Health/inspection is diagnostic only; destructive repair is never automatic.

Lookup results explicitly state that stored memory is untrusted contextual data. Prompt-injection-shaped memory is returned only as data and cannot grant tools, elevate permissions or override application/system instructions. Tool invocation authority is independently enforced against the exact declaration set at call time.

Interactive writes inherit existing confirmation freshness and cancellation handling. Memory handlers additionally enforce app-owned conversation/message/generation/call provenance and canonical transaction-level election checks.

Organic classifier prose has zero direct authority. A malicious user message can influence classifier output only to the extent that the classifier points at a literal span; application validation still enforces schema, exact-span membership, candidate count, secret rejection, app-owned metadata and canonical transactional storage. Observer failure never converts a saved assistant turn into a failed chat turn.

## 9. Certification history

Pass 0 was certified and squash-merged as `c95b41100a54fd1cad13d1f6c425ea0f992e0bb5`.

Pass 1 was fully certified and squash-merged as `217a4d7e60157acbf1cba75321fb2019e2f4ddbe`.

Pass 2 plus the Pass 0-2 hardening review passed documentation, verification, security, secret, supply-chain, test-quality/adversarial, registry-signature, dependency-audit, zero-warning lint, TS6, TS7, unit + per-file coverage, Worker/Durable Object, build, E2E and final-reliability gates. It was squash-merged as `6d4c90677d00fdc4c4df9b717859e08e42dbfb24`.

Pass 3 is implemented on `memory/pass-3-organic-observer` and remains uncertified until the same exact-head pipeline passes.

Pass 3 tests pin: trivial-turn skip; exact-user-span evidence; app-owned kind/title/tags/confidence/importance/scope; paraphrase rejection; credential rejection; strict schema; duplicate-candidate collapse; retry idempotency; deliberate-memory and regeneration exclusion; classifier failure isolation; tool-less/memory-less Gemini classifier calls; bounded output; explicit provider completion; response-save-before-observer ordering; no observer after failed persistence; and observer degradation without chat failure.

## 10. Completion passes

| Pass | Deliverable | Status |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | complete / merged (`c95b411`) |
| 1 | deliberate `memory.save` + authoritative provenance/idempotency | complete / merged (`217a4d7`) |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` | complete / merged (`6d4c906`) |
| 3 | bounded post-turn organic observer | implemented / certification pending |
| 4 | reinforcement, contradiction, supersession and promotion/dormancy policy | pending |
| 5 | Memory Bank parity: maintenance, landmarks/pinning, import/export | pending |
| 6 | adversarial certification + final documentation | pending |

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a separate WorldState database remain outside this completion program.

## 11. Current gap

After Pass 3 certifies, Elara can deliberately remember, deliberately reconcile established memory, and automatically notice bounded user-authored evidence after durable turns. The next gap is **evidence lifecycle policy**: relating repeated organic observations to established memories, contradiction handling, promotion, dormancy and supersession consequences. That work belongs to Pass 4; Phase 3 intentionally does not promote or rewrite established memory.
