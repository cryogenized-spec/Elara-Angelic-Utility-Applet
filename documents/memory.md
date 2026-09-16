---
id: SYS-MEM
status: active
verified_commit: 6e74ced1e6f85014801122bdc1a33c700dcbad2a
scope: durable memory formation, lifecycle, retrieval, model capabilities, and Memory Bank
paths: [src/memory, src/gemini/memory-context.ts, src/gemini/memory-observer.ts, src/gemini/google-tool-loop.ts, src/chat/generation-sync.ts, src/google/tools]
keywords: [memory, recall, observation, retrieval, consolidation, reconciliation, lifecycle, reinforcement, supersession, organic-observer, memory-bank, capability]
---

# Durable memory

## 1. Purpose and authority

`SYS-MEM` owns durable facts and observations that may outlive a conversation window. Conversation history is not automatically permanent memory. `db.memories` is the single durable authority; Memory Bank, recall, Gemini memory tools, organic observation and lifecycle maintenance are projections or controlled mutations of that same store.

The design goal is **Companion-style initiative on Angelic architecture**: Elara can deliberately remember, automatically notice bounded user-authored evidence, learn from repetition, preserve contradiction and retire stale/superseded knowledge without restoring the legacy free-form notebook that allowed model-authored `UPDATE` / `MERGE` / `DELETE` operations to rewrite its own history.

## 2. Memory formation model

Memory enters the canonical store through three bounded paths.

### 2.1 Deliberate memory

A user-directed remember request may cause Gemini to invoke confirmed `memory.save`. The application owns scope, provenance, durable ID, timestamps and lifecycle. Model-facing save may create `CONTEXTUAL` or `EPISODIC`; it cannot create `CORE`, choose lifecycle, delete records or control relationship metadata.

### 2.2 Organic observation

After the assistant response has durably saved, a separate tool-less classifier receives only the current persisted **user-authored** message. It may nominate at most three exact spans that appear worth retaining. Application code validates those spans and, if accepted, stores low-authority `MICRO_OBSERVATION` evidence. Assistant prose is never supplied as evidence, preventing self-authored responses from becoming facts through a feedback loop.

### 2.3 Reconciliation

For deliberate memory-management work Gemini may use `memory.lookup`, receive short-lived opaque refs, and then use confirmed `memory.reconcile` to classify new evidence as `support`, `conflict`, `related`, or `supersede`. Raw durable IDs are never model authority. Scope is revalidated immediately before mutation.

Automatic organic processing performs only one relation inference: **literal repeated support**. It does not semantically infer contradiction, relatedness or supersession. Those higher-risk judgments remain explicit reconciliation/maintenance work.

## 3. Runtime sequence

```text
user turn
-> elected conversation + folder scope
-> bounded durable-memory recall
-> frozen untrusted memory projection
-> Gemini response / tools
-> terminal assistant response
-> durable conversation save
-> organic classifier [user message only, no tools, no memory]
-> exact-span application validation
-> MICRO_OBSERVATION write
-> optional exact-evidence support consolidation
-> lifecycle policy
-> canonical db.memories
-> optional "Saved to memory" activity row
-> unlock next turn
```

Explicit memory uses the same store:

```text
remember -> memory.save -> confirmation -> canonical transaction -> db.memories
manage/change memory -> memory.lookup -> opaque ref -> memory.reconcile -> canonical transaction -> db.memories
```

`generation-sync.ts` extends the existing terminal persistence promise; it does not create a second queue/controller. Conversation durability is crossed before organic observation begins. Observer failure therefore cannot roll back a saved reply.

## 4. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema / normalization | `src/memory/schema.ts`, `normalize.ts` |
| Canonical store / transactions | `src/memory/store.ts` |
| Lifecycle policy | `src/memory/lifecycle.ts` |
| Scope / ranking / budget | `src/memory/retrieval.ts` |
| Observation / consolidation / supersession | `src/memory/observation.ts` |
| Organic policy / write path | `src/memory/organic-observer.ts` |
| Organic Gemini classifier | `src/gemini/memory-observer.ts` |
| Permission / capability | `src/memory/permissions.ts`, `capability.ts` |
| Gemini schemas / handlers | `src/memory/tool-schema.ts`, `tool-handler.ts` |
| Health / inspection | `src/memory/inspection.ts`, `health.ts` |
| Recall projection | `src/gemini/memory-context.ts`, `provider.ts` |
| Tool loop | `src/gemini/google-tool-loop.ts` |
| Terminal persistence barrier | `src/chat/generation-sync.ts` |
| Central tool authority | `src/google/tools/registry.ts`, `contracts.ts`, `gemini-declarations.ts`, `executor.ts` |
| User Memory Bank | `src/app/components/DurableMemorySettings.tsx` |

## 5. Durable record contract

Kinds: `MICRO_OBSERVATION`, `EPISODIC`, `CONTEXTUAL`, `CORE`.

Lifecycles: `active`, `dormant`, `archived`.

Provenance: `user`, `elara`, `import`, `migration` plus app-owned conversation/message/note metadata.

A durable record contains title/body, confidence, importance, created/updated/observed timestamps, tags, folder scope, expiry, reinforcement count, recall telemetry, explicit `autonomyContext` consent, and relationship arrays for related/supporting/conflicting/supersession evidence.

`CORE` means deliberately elevated durable authority. Organic runtime policy never manufactures CORE from repetition.

## 6. Organic capture policy

The classifier sees at most 6,000 characters of the current persisted user message. Output is strict JSON with at most three `{domain,evidence}` candidates. Evidence is capped at 500 characters and must be an exact substring of the full user message; paraphrases and inferences are discarded.

Allowed automatic domains are:

```text
preference
persistent_fact
project_decision
commitment
recurring_context
shared_event
```

The classifier is instructed to reject ordinary questions, temporary task wording, acknowledgements, jokes, speculative hypotheticals, quoted third-party claims, incidental chatter and highly sensitive personal facts. Application code independently rejects obvious credential-shaped material. Pass 6 must treat privacy filtering as adversarial surface rather than trusting classifier obedience alone.

Accepted organic evidence receives application-owned defaults:

```text
kind        MICRO_OBSERVATION
confidence  0.60
importance  0.35
tags        organic + domain:<domain>
```

The classifier cannot choose title, kind, confidence, importance, durable identity, provenance, scope, lifecycle, relationships, expiry or autonomy consent.

Organic observation is skipped when the message is trivial, the first response never became durable, the turn already used deliberate `memory.*` tooling, the response is a regeneration variant, turn authority is lost, or classifier/validation fails. Failure is non-fatal to the already-saved chat.

## 7. Evidence lifecycle policy

### 7.1 Automatic support boundary

A later organic observation may automatically support an earlier memory only when all are true:

```text
same exact folder scope
same domain:<domain> tag
same evidence after NFKC + case + whitespace normalization
candidate target is not archived or superseded
```

Punctuation is not discarded and semantic paraphrases are not merged. “I prefer compact layouts” and a differently worded statement with similar meaning therefore remain separate evidence until deliberate reconciliation or future reviewed maintenance links them.

When literal support is accepted, the target gains one reinforcement and application-owned weight steps:

```text
confidence +0.08  [ceiling 0.92]
importance +0.04  [ceiling 0.75]
```

Weights are quantized to hundredth precision at the policy boundary so floating-point drift cannot alter promotion thresholds. Replaying the same logical observation does not reinforce twice.

The supporting micro-observation remains preserved as evidence but becomes `dormant`; dormant micro-observations are excluded from normal conversational recall so repeated evidence cannot consume the recall budget with duplicates.

### 7.2 Automatic maturity

Promotion is one stage per policy evaluation and unresolved conflict blocks promotion.

```text
MICRO_OBSERVATION
  -> EPISODIC
     when reinforcement >= 1
     + supporting evidence >= 1
     + confidence >= 0.68

EPISODIC
  -> CONTEXTUAL
     when reinforcement >= 3
     + supporting evidence >= 3
     + confidence >= 0.80

CONTEXTUAL
  -/-> CORE automatically
```

With default organic weights, four literal occurrences can mature the original observation to CONTEXTUAL: first occurrence creates evidence; the second produces reinforcement 1 / confidence 0.68 and may promote to EPISODIC; the fourth produces reinforcement 3 / confidence 0.84 and may promote to CONTEXTUAL. Further repetition can strengthen weights but never automatically grant CORE authority.

### 7.3 Conflict and related evidence

`memory.reconcile support` preserves the new micro-evidence, reinforces the target once and then applies lifecycle policy.

`conflict` preserves the contradictory observation as active evidence and links it through `conflictingMemoryIds`. Target prose is not overwritten. A conflicted established memory may still be recalled but is explicitly projected as `unresolved-conflict` and cannot auto-promote while conflict remains unresolved.

`related` links evidence without changing target confidence/prose; the evidence then recedes to dormant.

### 7.4 Supersession

`supersede` creates a replacement and links both sides through `supersedes` / `supersededBy`. EPISODIC targets yield EPISODIC replacements; other established kinds restart as CONTEXTUAL, so CORE authority is not inherited.

The old record becomes `dormant`, remains inspectable in the canonical store, and is excluded from ordinary recall. Supersession never deletes or rewrites history.

### 7.5 Dormancy

Superseded or expired records become dormant when lifecycle policy evaluates them. Weak stale **organic** evidence may also recede:

```text
MICRO_OBSERVATION  90 days with reinforcement 0
EPISODIC           180 days with reinforcement < 3
CONTEXTUAL         365 days when confidence < 0.80
CORE               never age-dormant automatically
```

Age policy applies only to records tagged `organic`; deliberate memory is not silently aged out. New valid support may reactivate a dormant, non-superseded target.

`sweepMemoryLifecycle()` is an explicit maintenance primitive. It is not scheduled from every chat turn and therefore does not create a hidden second lifecycle owner. Pass 5 may expose reviewed maintenance through Memory Bank.

## 8. Retrieval and recall

Normal recall and `memory.lookup` share one folder/global scope resolver and one ranking engine. Current folder ancestry is eligible; global memory is included only according to folder context policy.

Retrieval excludes archived records, expired records, superseded records, and dormant `MICRO_OBSERVATION` evidence. Dormant established memories remain eligible at reduced lifecycle weight because stale-but-unsuperseded context can still be relevant.

Default context budget is eight records / 6,000 prose characters; hard caps are 20 / 20,000. Ranking remains lexical `0.50`, importance `0.18`, confidence `0.12`, reinforcement `0.07`, recency `0.06`, relationship density `0.03`, plus kind/lifecycle weights.

Normal prompt projection contains prose and kind/lifecycle/conflict labels but not durable IDs or relationship IDs. It begins with an explicit instruction boundary that stored memory is contextual data, not instructions.

Retrieval telemetry (`recallCount`, `lastRecalledAt`) is updated only by normal recall. Management lookup uses the scorer without mutating recall telemetry.

Only memories carrying explicit `autonomyContext=true` consent may enter the separate autonomy projection.

## 9. Gemini memory tools

| Tool | Risk | Purpose |
| --- | --- | --- |
| `memory.lookup` | read | scoped management lookup; returns opaque refs |
| `memory.save` | write + confirmation | deliberate retention |
| `memory.reconcile` | write + confirmation | support/conflict/related/supersede a looked-up record |

All use capability `memory.durable.local` through the central registry/executor/tool loop. They are browser-only because IndexedDB/Dexie is the canonical store; Worker/autonomy never advertises these tools.

`memory.lookup` accepts only a query. Refs are in-memory grants bound to exact conversation + user message + generation, expire after ten minutes, and are revalidated against current scope before mutation.

`memory.save` accepts bounded title/body, optional `CONTEXTUAL`/`EPISODIC`, confidence/importance and tags. App-owned lineage derives logical idempotency from conversation + message + generation + provider call. Replaying one logical call with changed mutation arguments fails closed.

`memory.reconcile` accepts an opaque ref plus relation/title/body/tags. Compound reconciliation runs in one canonical transaction and rolls back if generation authority is lost before commit.

Model-visible hard delete, forget, raw update, promote, reinforce, observe and consolidate remain undeclared. User/system UI paths retain stronger management authority.

## 10. Turn lifecycle and visibility

Gemini Interactions treats `system_instruction` as interaction-scoped. Durable memory is composed once for the elected top-level turn, then that exact instruction is reused across all tool-result continuations; a mid-turn memory mutation cannot rewrite the model's context halfway through the same turn.

Terminal sequencing is:

```text
save completed conversation
-> save failure: reject; no observer
-> save success: bounded observer
-> optional organic memory transaction
-> optional "Saved to memory" activity metadata
-> resolve terminal barrier
-> refresh thread list
-> unlock composer
-> release generation
```

Generation Activity uses the dedicated open-book memory icon for memory-related rows. Normal recall is an application-context row; deliberate `memory.lookup` / `memory.save` / `memory.reconcile` remain tool rows; successful organic capture adds a persisted `Saved to memory` context row. Empty/skipped observation adds no trace noise.

## 11. Security and failure invariants

- `db.memories` is the sole durable-memory authority.
- Stored/retrieved prose is untrusted application data, never instruction or permission.
- Tool authority is enforced against the exact declaration set for the elected turn.
- Model arguments cannot choose durable IDs, provenance, scope, lifecycle, relationship arrays, expiry or autonomy consent.
- Model policy may save/observe/consolidate internally but Gemini exposure is narrower; model forget/delete remain denied.
- Live mutations commit only while originating generation authority remains valid.
- Logical retries converge; changed replay arguments fail closed.
- Organic evidence comes only from literal user-authored spans; assistant response text is never observation evidence.
- Organic automatic relation inference is literal support only; no autonomous semantic conflict/supersession judge exists.
- Contradiction and supersession preserve history rather than rewriting/deleting it.
- Automatic lifecycle never grants CORE.
- Retrieval/observer failure cannot corrupt the store or convert an already-durable assistant response into failed chat.
- Health/inspection is diagnostic; destructive repair is never automatic.

## 12. Certification history and completion plan

Pass 0 certified + merged: `c95b41100a54fd1cad13d1f6c425ea0f992e0bb5`.

Pass 1 certified + merged: `217a4d7e60157acbf1cba75321fb2019e2f4ddbe`.

Pass 2 + Pass 0-2 hardening certified + merged: `6d4c90677d00fdc4c4df9b717859e08e42dbfb24`.

Pass 3 bounded organic observer passed the full exact-head pipeline (documentation, verification, security, secrets, supply-chain, test quality/adversarial sentinels, registry signatures, dependency audit, zero-warning lint, TS6, TS7, unit/coverage, Worker/Durable Object, build, 122 Playwright cases and final reliability) and was squash-merged as `6e74ced1e6f85014801122bdc1a33c700dcbad2a`.

Pass 4 implements deterministic evidence reinforcement, maturity, dormancy, conflict consequences, supersession recall semantics and explicit maintenance sweep on PR #63. It must pass the same exact-head pipeline before merge.

| Pass | Deliverable | State |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | complete / merged |
| 1 | deliberate `memory.save` + provenance/idempotency | complete / merged |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` | complete / merged |
| 3 | bounded post-turn organic observer | complete / merged |
| 4 | reinforcement + contradiction + supersession + promotion/dormancy | implemented / certification gate |
| 5 | Memory Bank parity: reviewed maintenance, landmarks/pinning, import/export | pending |
| 6 | full adversarial certification + final documentation closeout | pending |

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a second WorldState database remain outside this completion program.

## 13. Current gap

After Pass 4 certification, the core memory cognition loop is present: deliberate remembering, organic evidence capture, literal repetition/reinforcement, staged maturity, explicit contradiction/supersession and bounded recall. The next gap is **Memory Bank parity and maintenance UX**: reviewed duplicate/staleness/contradiction/promotion/dormancy candidates, landmark/pinning semantics, and import/export without introducing another store or autonomous destructive cleanup.
