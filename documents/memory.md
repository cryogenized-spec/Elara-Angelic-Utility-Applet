---
id: SYS-MEM
status: active
verified_commit: 7ab3a8aee8574f2ce32614621ac93c60f7eb67af
scope: durable memory lifecycle, retrieval, model capabilities, organic observation, evidence maturity, Memory Bank maintenance, archive transfer, and adversarial authority boundaries
paths: [src/memory, src/gemini/memory-context.ts, src/gemini/memory-observer.ts, src/gemini/google-tool-loop.ts, src/chat/generation-sync.ts, src/google/tools]
keywords: [memory, recall, observation, retrieval, consolidation, reconciliation, organic-observer, lifecycle, reinforcement, supersession, memory-bank, landmark, audit, archive, import, export, provenance, idempotency, adversarial, capability]
---

# Durable memory

## 1. Purpose and boundary

`SYS-MEM` owns durable facts and observations that can outlive a conversation window. Conversation history is not automatically permanent memory. `db.memories` is the single durable authority; Memory Bank, recall, Gemini tools, lifecycle policy, archive transfer and the organic observer are projections or operations over that store.

The design recovers the useful initiative of Elara Companion Old without restoring its unsafe free-form notebook authority. Elara may deliberately remember, reconcile evidence, form bounded user-grounded observations and learn from repetition, but assistant-generated prose cannot bootstrap itself into fact and no model path receives delete/forget/raw-lifecycle authority.

The governing principle is: **observation is cheap; belief is earned**.

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a separate general `WorldState` memory database are outside this subsystem.

## 2. Runtime architecture

```text
normal chat
-> captured originating conversation
-> canonical folder/global scope
-> bounded rank + budget
-> untrusted memory projection
-> freeze one composed instruction for the elected turn
-> Gemini initial interaction + all tool continuations
-> terminal assistant response
-> durable conversation save
-> bounded organic classifier [persisted USER message only]
-> exact-span validation + application-owned metadata
-> replay-safe MICRO_OBSERVATION transaction
-> optional deterministic exact-evidence support reconciliation
-> lifecycle evaluation
-> db.memories
-> optional Generation Activity trace
-> unlock next turn

explicit remember
-> declared memory.save
-> central write confirmation
-> app-owned conversation/message/generation/call lineage
-> canonical memory capability
-> replay-safe transaction
-> db.memories

memory management
-> declared memory.lookup [read]
-> canonical scope/ranking
-> turn-bound opaque memref_*
-> declared memory.reconcile [confirmed write]
-> scope + target revalidation
-> atomic consolidation or supersession
-> lifecycle evaluation
-> db.memories

Memory Bank
-> inspect/search/filter canonical records
-> optional landmark salience
-> deterministic read-only audit
-> explicitly applied lifecycle recommendations
-> guarded portable export/import
-> db.memories
```

Normal recall and `memory.lookup` share one conversation-to-memory scope resolver and one ranking engine. Recall is bound to the conversation captured when the turn is elected; current UI navigation is only a compatibility fallback for legacy callers without turn provenance. Management lookup does not mutate recall telemetry.

Gemini Interactions treats `system_instruction` as interaction-scoped. Interactive turns therefore compose durable memory once at the top-level elected turn and reuse that exact frozen instruction for every tool-result continuation. A memory mutation during the turn cannot silently rewrite the context that turn is already reasoning over.

Organic formation is downstream of conversation durability. `generation-sync.ts` extends the existing terminal persistence promise; it does not introduce another queue or lifecycle owner. The assistant response must save first. Observer failure cannot roll that response back.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema / normalization | `src/memory/schema.ts`, `normalize.ts` |
| Canonical store / transactions | `src/memory/store.ts` |
| Permission / capability | `src/memory/permissions.ts`, `capability.ts` |
| Scope / ranking / budget | `src/memory/retrieval.ts` |
| Lifecycle / reinforcement | `src/memory/lifecycle.ts` |
| Observation / consolidation / supersession | `src/memory/observation.ts` |
| Organic observation write policy | `src/memory/organic-observer.ts` |
| Organic Gemini classifier | `src/gemini/memory-observer.ts` |
| Gemini memory tool schemas / handlers | `src/memory/tool-schema.ts`, `tool-handler.ts` |
| Gemini recall projection | `src/gemini/memory-context.ts`, `provider.ts` |
| Central tool authority | `src/google/tools/registry.ts`, `contracts.ts`, `gemini-declarations.ts`, `executor.ts` |
| Tool continuation loop | `src/gemini/google-tool-loop.ts` |
| Terminal persistence barrier | `src/chat/generation-sync.ts` |
| Inspection / audit | `src/memory/inspection.ts`, `health.ts` |
| Provenance presentation | `src/memory/provenance.ts` |
| Portable archive boundary | `src/memory/archive.ts` |
| Human Memory Bank | `src/app/components/DurableMemorySettings.tsx`, `durable-memory-settings.css` |
| Browser acceptance | `e2e/memory-bank.spec.ts`, `e2e/memory-chat.spec.ts` |
| Final hostile matrix | `src/memory/adversarial-certification.test.ts` plus owning subsystem tests |

## 4. Data, retrieval and lifecycle contract

Kinds are `CORE`, `CONTEXTUAL`, `EPISODIC`, `MICRO_OBSERVATION`. Lifecycles are `active`, `dormant`, `archived`. Provenance sources are `user`, `elara`, `import`, `migration`.

A durable record carries title/body, confidence, importance, timestamps, tags, relationship evidence, supersession links, reinforcement count, folder scope, expiry, recall telemetry, optional landmark state (`pinned`) and explicit `autonomyContext` consent.

Promotion order is:

```text
MICRO_OBSERVATION
-> EPISODIC
-> CONTEXTUAL
-> CORE
```

Automatic organic policy stops at `CONTEXTUAL`; `CORE` is deliberate authority only.

Retrieval excludes archived, expired and superseded records plus dormant `MICRO_OBSERVATION` evidence. Dormant established memories remain eligible at reduced weight when otherwise valid. Retrieval obeys folder ancestry plus explicit global-context policy. Default budget is eight records / 6,000 prose characters; hard caps are 20 / 20,000.

Ranking remains one scorer: lexical `0.50`, importance `0.18`, confidence `0.12`, reinforcement `0.07`, recency `0.06`, relationship density `0.03`, plus bounded kind/lifecycle weights. A pinned landmark adds only `0.08` salience. Pinning never bypasses scope, lifecycle, expiry, supersession or budget eligibility.

Relationship arrays are bounded to 64 IDs. New support/conflict/related/supersession operations must fail before epistemic weight or lifecycle state diverges if the required link cannot be retained. Existing linked replays remain idempotent.

## 5. Authority invariants

- `db.memories` is the sole durable-memory authority.
- Stored/retrieved prose is untrusted reference data. It is never instruction or permission and **cannot authorize tool use, policy changes, permissions or actions**.
- Every provider tool call must be in the exact tool set declared to that turn. Installed handlers or registry membership cannot widen authority.
- Model-facing memory tools are exactly `memory.lookup`, `memory.save`, `memory.reconcile`; all are browser-only.
- Worker/autonomy never advertises local durable-memory mutation tools.
- `memory.lookup` is read. `memory.save` and `memory.reconcile` are confirmed writes through the central executor.
- Model arguments never control durable IDs, app provenance, conversation/message lineage, timestamps, folder scope, lifecycle, relationship arrays, expiry or autonomy consent.
- Model-visible hard delete/forget/raw update/promote/reinforce/observe/consolidate do not exist.
- A model write may commit only while its originating generation remains elected.
- One logical provider call converges on at most one logical mutation. Reusing a call identity with changed mutation arguments fails closed.
- Tool continuations reuse one frozen memory instruction for the elected turn.
- Organic observation starts only after response durability and receives no assistant-response evidence.
- Organic classifier output has no direct write authority; only exact persisted user spans can survive application validation.
- Automatic reinforcement never crosses folder scope or memory domain and never targets archived, expired or superseded records.
- Automatic semantic merge/conflict/supersession inference does not exist.
- Relationship saturation fails closed without partial mutation.
- Memory Bank audit is deterministic and read-only; findings never auto-merge or auto-delete.
- `pinned` is salience metadata, not truth or permission authority.
- Archives transfer memory data, never application authority.
- Import creates fresh IDs, uses only user-selected target scope, resets provenance to `import`, forces `autonomyContext=false`, resets recall/reinforcement telemetry and cannot inherit `CORE` authority.

## 6. Model-facing contract

| Tool | Risk | Plane | Purpose |
| --- | --- | --- | --- |
| `memory.lookup` | read | browser | bounded scoped management lookup |
| `memory.save` | write | browser | deliberate durable retention |
| `memory.reconcile` | write | browser | attach evidence or supersede an opaque-ref target |

All three use `memory.durable.local` through the central registry/executor/tool loop. There is no parallel memory dispatcher.

### 6.1 `memory.lookup`

Input is only `query` (1-500 chars). Scope, budgets, lifecycle eligibility and durable identity are application-owned.

Results contain title/body/kind/confidence/importance/lifecycle/tags plus opaque `memref_*` grants. Raw durable IDs are never returned. Lookup excludes `MICRO_OBSERVATION` management targets and does not mutate `recallCount` or `lastRecalledAt`.

A lookup ref is an in-memory capability grant bound to the exact originating conversation + user message + generation. It expires after ten minutes and lives in a bounded 128-entry map. Reconciliation revalidates current target scope/eligibility before mutation.

### 6.2 `memory.save`

Input: title 1-160, body 1-4,000, optional kind (`CONTEXTUAL`/`EPISODIC`), confidence/importance `[0,1]`, and at most 12 tags of 64 chars.

Logical mutation identity derives from application-owned `conversationId + inputMessageId + generationId + provider callId`. `saveMemoryOnce` performs replay convergence inside the canonical transaction and checks mutation authority before commit. Overlong lineage keys use SHA-256 provenance markers rather than truncation.

Replay equivalence is semantic: changed title/body/kind/confidence/importance/tags/scope/provenance under the same logical call fails closed. Legitimate later lifecycle/relationship/recall changes do not invalidate a true replay.

The tool returns only `{ saved, kind }`.

### 6.3 `memory.reconcile`

Input: `targetRef`, relation (`support`, `conflict`, `related`, `supersede`), title 1-160, body 1-4,000 and optional bounded tags. Raw durable IDs are not accepted as target authority.

`support` / `conflict` / `related` create one replay-safe `MICRO_OBSERVATION` and use canonical consolidation. Support reinforces once; exact same-relation replay is a no-op; relation reclassification fails closed. Conflict and related evidence never overwrite target prose.

`supersede` creates a conservative replacement and links `replacement.supersedes -> target` and `target.supersededBy -> replacement`. EPISODIC targets produce EPISODIC replacements; all other established kinds restart as CONTEXTUAL. CORE is never inherited automatically. The replaced record is preserved and dormanted.

The full operation is transactional. Cached exact replay identity is checked before a successful supersession's now-nonretrievable target can incorrectly reject the retry. If the short-lived replay cache is absent but the opaque ref remains valid, a superseded target is admitted only as a transactional replay candidate: canonical idempotency must resolve to an already-linked replacement. A changed/new operation cannot use that stale ref to create another replacement; the transaction rolls back.

## 7. Organic formation and Memory Bank

### 7.1 Capture criteria

The organic classifier receives at most 6,000 characters from the persisted user message, with no assistant response, retrieved memory, Character Master or tools. It may nominate at most three strict `{domain,evidence}` candidates.

Allowed domains: `preference`, `persistent_fact`, `project_decision`, `commitment`, `recurring_context`, `shared_event`.

A candidate should remain useful beyond the immediate exchange. Ordinary questions, temporary task wording, acknowledgements, jokes, speculative hypotheticals, quoted third-party claims and incidental chatter are excluded. `evidence` is capped at 500 characters and must be an exact substring of the full user message. Paraphrases/inferences are discarded. Obvious credential-shaped evidence is deterministically rejected; highly sensitive personal facts are excluded by classifier policy.

Accepted candidates become application-titled/tagged `MICRO_OBSERVATION`s with confidence `0.60`, importance `0.35`, tag `organic`, and `domain:<domain>`. The classifier cannot choose identity, title, kind, weight, provenance or scope.

A stable organic replay key derives from conversation + user message + domain + SHA-256(exact evidence). A deliberate `memory.*` turn and regeneration variants skip organic formation.

### 7.2 Reinforcement and maturity

Automatic support requires same folder scope, same domain and NFKC/case/whitespace-equivalent body text. Punctuation and semantic paraphrases do not collapse.

One support adds `+0.08` confidence (ceiling `0.92`), `+0.04` importance (ceiling `0.75`) and one reinforcement. Values are quantized to hundredths.

```text
MICRO_OBSERVATION
-> EPISODIC after >=1 support, >=1 linked support, confidence >=0.68
-> CONTEXTUAL after >=3 supports, >=3 linked supports, confidence >=0.80
-> CORE never automatic
```

One lifecycle evaluation advances at most one promotion stage. Unresolved conflict blocks promotion.

Weak organic evidence recedes instead of disappearing: unsupported MICRO after 90 days, weak EPISODIC after 180 days, and low-confidence organic CONTEXTUAL after 365 days may become dormant. Deliberate memory is not aged by those organic rules.

Automatic observation performs only deterministic literal support. `conflict`, `related` and `supersede` remain explicit reconciliation relations. Conflict preserves both sides. Supersession preserves historical prose and removes the old record from normal recall rather than deleting it.

### 7.3 Persistence and activity visibility

```text
save completed conversation
-> if save fails: no observer
-> if save succeeds: bounded observer
-> record / empty / safely degrade
-> optional "Saved to memory" Generation Activity persistence
-> resolve terminal barrier
-> unlock composer / release generation
```

Memory activity uses the dedicated Lucide `BookOpen` icon. Recall is a context row; deliberate `memory.*` calls remain tool rows; successful organic capture adds `Saved to memory`. Failure of optional trace persistence is non-fatal after response/memory durability.

<a id="memory-bank"></a>
### 7.4 Memory Bank

Memory Bank is the human inspection/maintenance surface over `db.memories`. It supports search/filtering, create/edit/archive/restore/promote/delete controls, provenance views, landmark pinning, deterministic audit and guarded local backup/transfer without another memory store.

Audit is pure and deterministic. Duplicate groups require exact normalized title/body equality in the same scope. Contradiction clusters use explicit conflict relationships. Lifecycle recommendations come from the same pure preview consumed by the mutating lifecycle sweep. Applying lifecycle recommendations is an explicit user action and never hard-deletes history.

Archive format is strict `elara-memory-bank` version 1, capped at 5,000 records and 5 MB. Export contains portable content/weights/lifecycle/source category/tags/expiry/pin state plus archive-local relationship references. It deliberately omits canonical durable IDs, folder IDs, conversation/message lineage, provenance notes, recall telemetry, reinforcement counters and autonomy consent.

Import rejects unknown versions, duplicate archive IDs, self-links, dangling targets, duplicate relationship claims, malformed records and oversized text/objects before writes. Import is one canonical transaction: fresh durable IDs, application-owned `import` provenance, user-selected scope, `autonomyContext=false`, imported CORE -> CONTEXTUAL, and relationships remapped only within that archive. Any failure rolls back the whole import.

## 8. Security and failure semantics

Memory context is bounded and separated from Character Master. Retrieval failure cannot corrupt the store or fail an otherwise valid turn. Health inspection is diagnostic only; malformed records are surfaced, never silently repaired or deleted.

Prompt-injection-shaped stored text remains visible only as inert reference data. Both normal recall and management lookup explicitly state that memory cannot authorize tools, actions, policy or permissions. Tool authority is independently enforced by exact declaration membership, registry metadata, runtime schema validation, confirmation policy and elected-turn provenance.

Interactive writes inherit central confirmation freshness and cancellation handling. Memory transactions additionally recheck mutation authority before commit. Losing generation authority rolls back a compound mutation.

Observer/classifier failure never converts an already-durable chat response into a failed turn. A failed conversation save prevents observer execution entirely.

Archive import is an untrusted-data boundary. Application authority fields cannot be smuggled through the portable schema; imported identity, scope, provenance, autonomy consent and CORE authority are always re-owned by application policy.

## 9. Adversarial certification matrix

Pass 6 adds or reuses direct behavioral tests for these boundaries:

- **Model authority smuggling:** strict runtime schemas reject folder, provenance, lifecycle, autonomy, durable-ID and forbidden-kind attempts.
- **Opaque capability abuse:** raw IDs fail; refs are conversation/message/generation-bound; TTL expiry, folder movement, archive/expiry/supersession after lookup all fail closed.
- **Replay abuse:** changed save/reconcile arguments fail; long replay keys hash full lineage; final-slot supersession replay converges at primitive and handler layers; a fresh stale-ref operation rolls back.
- **Cancellation/races:** model writes and compound reconcile roll back if generation authority is lost; terminal conversation persistence precedes organic observation; failed persistence prevents observation.
- **Prompt injection:** hostile stored prose remains bounded data, exposes no durable identity, and carries zero tool/action authority.
- **Organic poisoning:** exact-user-span requirement, strict output shape, candidate cap, credential rejection, no assistant evidence, no automatic CORE, no semantic auto-merge.
- **Scope isolation:** canonical folder ancestry/global policy applies to normal recall and management lookup; sibling scopes do not leak.
- **Large-bank behavior:** retrieval stays bounded by item/character caps rather than loading arbitrary context into the model.
- **Malformed canonical data:** health scan reports corruption without repair; replay-safe valid writes can coexist with unrelated malformed legacy rows.
- **Relationship saturation:** support/conflict/related/supersession fail before partial epistemic mutation; organic transactions roll back newly created evidence if consolidation cannot retain the link.
- **Archive attacks:** strict version/byte/count ceilings, authority-field rejection, duplicate/self/dangling relationship rejection, fresh IDs, scope/provenance/autonomy reset and all-or-nothing transaction.
- **Memory Bank browser behavior:** landmark/audit/provenance/export/import acceptance remains E2E-covered.
- **Chat browser closure:** a real Playwright chat turn proves `memory.lookup/save/reconcile` are advertised to Gemini, the organic classifier is tool-less, the assistant response exists in IndexedDB before observation starts, the canonical Memory Bank receives the observation, and the `BookOpen` memory activity row survives reload.

A green test that passes for the wrong reason is a defect. Pass 5's media-suite failure demonstrated this rule: altered Settings timing exposed a pre-existing Playwright consent-fixture race; `global-setup.ts` now proves accepted YouTube policy survives reload before shared storage state is captured.

## 10. Certification history

| Pass | Deliverable | Certified / merged |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | `c95b41100a54fd1cad13d1f6c425ea0f992e0bb5` |
| 1 | deliberate `memory.save` + authoritative provenance/idempotency | `217a4d7e60157acbf1cba75321fb2019e2f4ddbe` |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` + Pass 0-2 hardening | `6d4c90677d00fdc4c4df9b717859e08e42dbfb24` |
| 3 | bounded post-turn organic observer | `6e74ced1e6f85014801122bdc1a33c700dcbad2a` |
| 4 | deterministic evidence lifecycle / contradiction / supersession | `14ae86d8b0a4713b3671183c0073db1bc53ac1dc` |
| 5 | Memory Bank parity / landmarks / provenance / audit / portable archive | `bdc10d79e1da8964de90debfef73c5ca0bc512cc` |
| 6 | hostile cross-boundary certification + final hardening | `766e94b9870ff5d9037950727534daa2e2587e6b` |
| closure | browser chat acceptance + exact-head final reliability | `7ab3a8aee8574f2ce32614621ac93c60f7eb67af` |

Every completed runtime pass cleared documentation/verification integrity, architecture/security, secret and supply-chain gates, registry signatures, dependency audit, zero-warning lint, TS6, TS7, unit + coverage ratchets, Worker/Durable Object tests, production build, Playwright E2E and final reliability before merge. PR #66 added the missing browser-boundary proof without changing production behavior and passed the same complete pipeline on exact head `f509e5aa5fc3588641a619508ef4c9ffe7bccbfe` before squash merge.

## 11. Agent handoff

**Program status: CLOSED / CERTIFIED.** The seven-pass durable-memory completion program and its final browser closure audit are merged. Treat `7ab3a8aee8574f2ce32614621ac93c60f7eb67af` as the certified handover baseline for memory work.

For future work, read `AGENTS.md`, route through `documents/manifest.json`, then load this document before modifying any memory path. Inspect only the exact source/tests needed for the requested change.

Preserve these non-negotiables unless the user deliberately changes the product contract:

1. one durable authority: `db.memories`;
2. stored prose is data with zero action authority;
3. browser-only model surface remains `lookup/save/reconcile` unless explicitly redesigned;
4. destructive/lifecycle authority stays outside model-visible tools;
5. organic evidence remains user-grounded and low-authority;
6. lifecycle and audit remain deterministic application policy;
7. archive transfer never transfers canonical authority;
8. all writes remain transactional, replay-safe and scope/election aware.

If a future `/skills` layer is added, `skills/memory/SKILL.md` should describe **procedure only**: which files to read, invariants to preserve, tests to run and which canonical document to update. It must point back to `SYS-MEM`; it must not become a second architectural source of truth.

The seven-pass memory completion program is closed. Any future memory change is a new scoped feature or maintenance program and must establish its own baseline, invariants and certification record rather than reopening Pass 0-6.