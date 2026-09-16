---
id: SYS-MEM
status: active
verified_commit: c85c2b6aafc474b3d8a951f7b6b1fd38f841e89f
scope: durable memory lifecycle, retrieval, model capabilities, organic observation, evidence maturity, and Memory Bank maintenance
paths: [src/memory, src/gemini/memory-context.ts, src/gemini/memory-observer.ts, src/gemini/google-tool-loop.ts, src/chat/generation-sync.ts, src/google/tools]
keywords: [memory, recall, observation, retrieval, consolidation, reconciliation, organic-observer, lifecycle, reinforcement, supersession, memory-bank, landmark, audit, archive, import, export, provenance, capability]
---

# Durable memory

## 1. Purpose and boundary

`SYS-MEM` owns durable facts and observations that can outlive a conversation window. Conversation history is not automatically permanent memory. `db.memories` is the single durable authority; Memory Bank, recall, Gemini tools and the organic observer are projections over that store.

The target is Companion-style initiative on Angelic architecture: Elara may deliberately remember, reconcile evidence, form bounded observations and learn from repetition without restoring the old free-form notebook `UPDATE`/`DELETE` model or allowing assistant prose to bootstrap itself into fact.

The governing principle is: **observation is cheap; belief is earned**.

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
-> optional exact-evidence support reconciliation
-> lifecycle evaluation
-> db.memories
-> optional Generation Activity trace update
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
-> lifecycle evaluation
-> db.memories

Memory Bank
-> list/search/filter canonical records
-> optional landmark salience
-> deterministic read-only audit
-> explicit lifecycle sweep only after user confirmation
-> portable local export / guarded transactional import
-> db.memories
```

Normal recall and `memory.lookup` share the same folder/global scope resolver and ranking engine. Automatic recall is bound to the conversation captured when the turn was elected; current UI navigation is only a compatibility fallback for legacy callers without turn provenance. Lookup does not use `retrieveMemories`, so management lookup does not alter recall telemetry.

Gemini Interactions treats `system_instruction` as interaction-scoped rather than conversation-history state. Interactive tool turns therefore compose durable memory once at the elected top-level turn, pass the provider `memoryContext: none`, and reuse that exact composed instruction for every tool-result continuation. Memory is neither dropped after a tool call nor re-retrieved mid-turn after a mutation.

Organic formation is downstream of conversation durability. `generation-sync.ts` extends the existing terminal persistence promise rather than creating another queue or lifecycle owner: the assistant response must save first; observer failure cannot roll that response back; the composer remains in `saving` until the bounded observer stage completes or safely degrades.

Memory Bank maintenance is explicitly invoked from the existing settings surface. There is no scheduled second lifecycle controller and no separate maintenance database.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Types | `src/memory/types.ts` |
| Schema/normalization | `src/memory/schema.ts`, `normalize.ts` |
| Store/transactions | `src/memory/store.ts` |
| Lifecycle/reinforcement policy | `src/memory/lifecycle.ts` |
| Scope/ranking/budget | `src/memory/retrieval.ts` |
| Observation/consolidation/supersession | `src/memory/observation.ts` |
| Organic observation policy/write path | `src/memory/organic-observer.ts` |
| Organic Gemini classifier | `src/gemini/memory-observer.ts` |
| Permission/capability | `src/memory/permissions.ts`, `capability.ts` |
| Gemini memory schemas/handlers | `src/memory/tool-schema.ts`, `tool-handler.ts` |
| Inspection/audit | `src/memory/inspection.ts`, `health.ts` |
| Provenance presentation | `src/memory/provenance.ts` |
| Portable archive boundary | `src/memory/archive.ts` |
| Gemini recall projection | `src/gemini/memory-context.ts`, `provider.ts` |
| Tool loop | `src/gemini/google-tool-loop.ts` |
| Terminal persistence barrier | `src/chat/generation-sync.ts` |
| Central tool authority | `src/google/tools/registry.ts`, `contracts.ts`, `gemini-declarations.ts`, `executor.ts` |
| User Memory Bank | `src/app/components/DurableMemorySettings.tsx`, `durable-memory-settings.css` |
| Memory Bank acceptance | `e2e/memory-bank.spec.ts` |

## 4. Data and retrieval contracts

Kinds: `CORE`, `CONTEXTUAL`, `EPISODIC`, `MICRO_OBSERVATION`. Lifecycles: `active`, `dormant`, `archived`. Provenance sources: `user`, `elara`, `import`, `migration`.

A durable record carries title/body, confidence, importance, timestamps, tags, relationship evidence, supersession links, reinforcement count, folder scope, expiry, recall telemetry, optional landmark state (`pinned`) and explicit `autonomyContext` consent.

Promotion order is `MICRO_OBSERVATION -> EPISODIC -> CONTEXTUAL -> CORE`, but automatic organic lifecycle stops at `CONTEXTUAL`; `CORE` remains deliberate authority.

Retrieval excludes archived, expired, superseded records and dormant `MICRO_OBSERVATION` evidence. Dormant established memories remain eligible at reduced lifecycle weight. Retrieval obeys current folder ancestry plus the folder's explicit global-context policy. Default budget is eight records / 6,000 prose characters; hard caps remain 20 / 20,000.

Ranking remains one scorer: lexical 0.50, importance 0.18, confidence 0.12, reinforcement 0.07, recency 0.06, relationship density 0.03, plus kind/lifecycle weights. A pinned landmark adds a bounded `0.08` salience signal; pinning never bypasses scope, archive, expiry, supersession or budget eligibility.

Organic observations deliberately start below explicit durable saves: `kind=MICRO_OBSERVATION`, confidence `0.60`, importance `0.35`, tags `organic` + `domain:<domain>`. The classifier cannot override those values.

Relationship arrays are bounded to 64 IDs. New support/conflict/related/supersession links fail closed before any epistemic or lifecycle mutation when their required relationship array is saturated. Existing linked replays remain idempotent. Normalization must never silently discard a new evidence link after reinforcement has already changed the target.

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
- Automatic literal reinforcement never crosses folder scope or memory domain, never targets archived/superseded/expired records, and never infers semantic equivalence from paraphrase.
- Relationship saturation must fail closed before weights, lifecycle state or evidence links can diverge.
- Memory Bank audit is deterministic and read-only. Duplicate or contradiction findings never auto-merge, auto-delete or semantically adjudicate history.
- Landmark/pinned state is bounded ranking metadata, not permission, truth authority or scope override.
- Memory archives are data transfer artifacts, not authority transfer. Canonical IDs, folder authority, conversation/message lineage, recall telemetry and autonomy consent are not exported.
- Import creates fresh durable identities, applies only a user-selected target scope, resets provenance to `import`, forces `autonomyContext=false`, and cannot inherit `CORE` authority.

## 6. Model-facing contract

| Tool | Risk | Plane | State | Purpose |
| --- | --- | --- | --- | --- |
| `memory.lookup` | read | browser | Pass 2 certified + merged | bounded lookup for memory-management work |
| `memory.save` | write | browser | Pass 1 certified + merged | deliberate durable retention |
| `memory.reconcile` | write | browser | Pass 2 certified + merged | attach evidence or supersede a lookup-selected memory |

All three use `memory.durable.local` through the central registry/executor/tool loop. Normal interactive chat derives its offered tool list from the Gemini-visible registry; Worker/autonomy derives a separate execution-plane surface. No parallel memory dispatcher exists. Passes 3-5 add no model-visible memory tool.

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

Before mutation, the handler verifies that the ref belongs to the same conversation/message/generation and then re-resolves current folder/global scope. If the target became archived/expired/superseded or otherwise left scope, reconciliation fails closed.

`support` / `conflict` / `related` create one replay-safe `MICRO_OBSERVATION` and use canonical consolidation. Support reinforces once; same-relation replay is a no-op; relation reclassification fails closed. Conflict/related evidence never overwrite target prose.

`supersede` creates a conservative replacement and links both sides through `supersedes` / `supersededBy`. An EPISODIC target yields an EPISODIC replacement; other established kinds restart as CONTEXTUAL, so CORE authority is never inherited automatically. Pass 4 then dormants the replaced record while preserving it in the canonical store.

The full reconciliation runs inside `runMemoryMutationTransaction`. Losing generation authority before commit or encountering relationship saturation rolls back the compound operation.

## 7. Organic observer and Memory Bank contracts

### 7.1 Evidence boundary and capture criteria

The classifier receives at most 6,000 characters from the current persisted user message. It receives no assistant response, no retrieved durable memory, no Character Master and no tools. Its only useful output is strict JSON containing at most three `{domain,evidence}` candidates.

Automatic capture is not an unconstrained "the model feels like remembering this" decision. A candidate must fit one of six durable domains: `preference`, `persistent_fact`, `project_decision`, `commitment`, `recurring_context`, or `shared_event`, and it must be likely to remain useful beyond the immediate exchange. Ordinary questions, temporary task wording, acknowledgements, jokes, speculative hypotheticals, quoted third-party claims and incidental chatter are explicitly excluded.

`evidence` is capped at 500 characters and must be an exact substring of the full user message. Paraphrases/inferences are discarded. Malformed or extra-property output fails closed. Obvious credential-shaped evidence is deterministically rejected in application code; the classifier is additionally instructed not to select highly sensitive personal facts for automatic persistence.

The Gemini classifier uses the one canonical browser provider with `memoryContext: none` and an empty tool list. It has an eight-second internal timeout and a 4,000-character output ceiling. Provider failure, invalid JSON, timeout or cancellation becomes a non-fatal unavailable observer result.

### 7.2 Write boundary

Accepted candidates are converted by application code into app-titled, app-tagged low-weight `MICRO_OBSERVATION` records. The classifier never chooses the memory title, kind, confidence, importance, provenance, folder scope or durable identity.

Each write uses the existing `recordObservation -> memory.save -> saveMemoryOnce -> db.memories` path and the existing permission policy. A stable idempotency identity derives from conversation + user message + domain + exact evidence, so a retry of the same persisted user evidence converges on one record even if the assistant generation changes. Provenance metadata stores a SHA-256 fingerprint of the evidence for replay identity rather than duplicating the user-authored prose outside the memory body.

At most three accepted candidates are written inside one canonical memory transaction. A deliberate `memory.*` tool turn skips organic formation. Regeneration variants (`responseVariant > 1`) skip organic formation; a failed first response cannot form memory because its conversation save never crossed the durability boundary.

After a new observation is written, automatic support lookup may only select a same-folder, same-domain memory whose body is equal under Unicode NFKC + case + whitespace normalization. Punctuation and semantic paraphrases do not collapse. Archived, superseded and expired memories are ineligible support targets.

If a literal support target exists, reinforcement adds `+0.08` confidence (ceiling `0.92`) and `+0.04` importance (ceiling `0.75`) and increments reinforcement count once. Policy weights are quantized to hundredths so IEEE-754 drift cannot alter threshold decisions. Supporting evidence is retained but dormanted after consolidation. If the required evidence link cannot be stored because the relationship array is saturated, the observer transaction fails closed and rolls the newly created observation back.

### 7.3 Maturity and dormancy

Automatic maturity is staged and conservative:

```text
MICRO_OBSERVATION
-> EPISODIC after >=1 support, >=1 linked supporting observation, confidence >=0.68
-> CONTEXTUAL after >=3 supports, >=3 linked supporting observations, confidence >=0.80
-> CORE never automatic
```

One lifecycle evaluation performs at most one promotion stage. Unresolved `conflictingMemoryIds` block automatic promotion.

Weak organic evidence recedes rather than disappearing: an unsupported MICRO_OBSERVATION becomes dormant after 90 days; an EPISODIC memory with fewer than three reinforcements after 180 days; a CONTEXTUAL organic memory below confidence `0.80` after 365 days. Deliberate memories are not aged by these organic rules.

Superseded or expired records become dormant when lifecycle policy evaluates them. A superseded record is excluded from normal recall immediately by retrieval eligibility even before a maintenance sweep runs. Expired records are excluded from recall and from automatic reinforcement.

Dormant supporting MICRO_OBSERVATION evidence remains inspectable in the Memory Bank/evidence graph but is excluded from normal conversational recall so repeated wording cannot consume bounded recall slots. Dormant established memory remains recallable at reduced weight when still otherwise eligible.

### 7.4 Conflict, relation and supersession

Automatic organic observation performs only deterministic literal `support`. It does not ask a second semantic model to infer `conflict`, `related` or `supersede` relationships.

Explicit `memory.reconcile` may attach:

- `support`: reinforce once and preserve linked evidence;
- `conflict`: preserve both target prose and contradictory evidence, keep contradiction visible and block automatic promotion;
- `related`: preserve a relationship without changing confidence/prose;
- `supersede`: create a conservative replacement, link both sides, retain historical prose and make the replaced record dormant.

A superseding replacement inherits EPISODIC only from an EPISODIC target; all other established targets restart at CONTEXTUAL. CORE authority therefore cannot silently propagate through replacement.

### 7.5 Turn lifecycle and Generation Activity visibility

`generation-sync.ts` hands the App one terminal promise covering the full post-response barrier:

```text
save completed conversation
-> if save fails: reject; no observer
-> if save succeeds: run bounded observer
-> observer records / returns empty / safely degrades
-> if records were created: persist optional "Saved to memory" activity row
-> resolve terminal barrier
-> App refreshes thread list, unlocks composer, releases generation
```

After the conversation save succeeds, the durable turn—not the currently visible UI thread—is sufficient authority for this best-effort post-turn observation. Navigating during `saving` therefore does not create a second lifecycle or silently roll back the already-saved reply.

Memory activity has a dedicated Lucide open-book icon in Generation Activity. Recall remains an application context row, deliberate `memory.lookup` / `memory.save` / `memory.reconcile` remain truthful tool rows, and a successful organic capture adds a persisted `Saved to memory` context row with the number of durable observations recorded. Empty/skipped organic classification does not add noise to the trace. Failure of the optional trace-metadata save is non-fatal because the response and memory have already crossed their durability boundaries.

<a id="memory-bank"></a>
### 7.6 Memory Bank

Memory Bank is the human maintenance and inspection surface over `db.memories`. It supports search, kind/lifecycle/scope/provenance filters, create/edit/archive/restore/promote/delete controls, landmark pinning, deterministic maintenance audit and guarded backup/transfer without introducing another memory authority.

Provenance display is a derived human view over canonical source metadata: explicit user memory, observed user evidence, Elara-managed memory, imported archive or migrated memory. The `elara` source identifies the application writer; an `organic` tag on that source is presented as observed user evidence because the persisted evidence is constrained to an exact user-message span.

Landmarks use the existing `pinned` field. Pinning adds bounded retrieval salience only; it does not reactivate archived memory, bypass scope or expiry, alter provenance, create `CORE` authority or guarantee selection under the retrieval budget.

The maintenance audit is pure and deterministic. Duplicate groups require exact normalized title/body equality in the same scope. Contradiction clusters are connected components of explicit `conflictingMemoryIds`. Lifecycle recommendations are produced by the same `previewMemoryLifecycleTransition()` consumed by the mutating lifecycle sweep, so preview and execution share one policy. Audit never mutates; applying recommendations requires an explicit user action and never hard-deletes records.

Archive format is strict, versioned (`elara-memory-bank`, version 1), capped at 5,000 records and 5 MB. Export produces a portable projection containing memory content, epistemic weights, lifecycle, source category, tags, archive-local relationship references, expiry and landmark state. Canonical durable IDs, folder IDs, conversation/message lineage, provenance notes, recall telemetry, reinforcement counters and autonomy consent are deliberately absent. Links to records outside the exported set are omitted.

Archive-local IDs exist only to rebuild the graph inside that file. Import rejects duplicate archive IDs, self-links, dangling relationship targets, duplicate relationship entries, malformed/unknown versions and oversized serialized or already-parsed values before mutation. Import runs as one canonical memory transaction: every record receives a fresh durable ID; all records receive application-owned `import` provenance and the user-selected target folder; `autonomyContext` is forced false; imported `CORE` restarts as `CONTEXTUAL`; archive relationships are remapped only among records in that transaction. Any failure rolls back the import rather than leaving a partial bank.

The Playwright acceptance path covers landmark pin/filter behavior, duplicate audit visibility, provenance filtering, local JSON export, guarded re-import, fresh imported provenance and continued use of the canonical store.

## 8. Security and failure semantics

Memory context remains bounded and separated from Character Master. Retrieval failure cannot corrupt the canonical store or fail an otherwise valid turn. Health/inspection is diagnostic only; destructive repair is never automatic.

Lookup results explicitly state that stored memory is untrusted contextual data. Prompt-injection-shaped memory is returned only as data and cannot grant tools, elevate permissions or override application/system instructions. Tool invocation authority is independently enforced against the exact declaration set at call time.

Interactive writes inherit existing confirmation freshness and cancellation handling. Memory handlers additionally enforce app-owned conversation/message/generation/call provenance and canonical transaction-level election checks.

Organic classifier prose has zero direct authority. A malicious user message can influence classifier output only to the extent that the classifier points at a literal span; application validation still enforces schema, exact-span membership, candidate count, secret rejection, app-owned metadata and canonical transactional storage. Observer failure never converts a saved assistant turn into a failed chat turn.

Automatic lifecycle is application-owned deterministic policy, not another autonomous model loop. It cannot semantically merge paraphrases, infer contradiction, delete history, promote to CORE, cross scope/domain, reinforce expired/superseded records, or silently truncate saturated evidence links.

Memory Bank does not grant model authority. Its destructive delete action remains a direct user UI action with confirmation. Maintenance findings are review information, not autonomous decisions. Imported source labels and archive-local relationship IDs are data only and cannot restore original application authority.

The archive parser applies strict schema, record-count and byte ceilings before writes. Import resets canonical identity, scope/provenance ownership and autonomy consent, demotes imported `CORE`, and restores only relationships internal to the reviewed archive. The complete import uses one canonical transaction, so malformed relationship graphs or write failures cannot leave a partially trusted import.

The E2E shared storage fixture must also prove versioned YouTube policy consent survives a reload before it is reused. This prevents unrelated Settings load timing from silently poisoning media acceptance tests; the race was exposed during Pass 5 and hardened in `e2e/global-setup.ts`.

## 9. Certification history

Pass 0 was certified and squash-merged as `c95b41100a54fd1cad13d1f6c425ea0f992e0bb5`.

Pass 1 was fully certified and squash-merged as `217a4d7e60157acbf1cba75321fb2019e2f4ddbe`.

Pass 2 plus the Pass 0-2 hardening review passed documentation, verification, security, secret, supply-chain, test-quality/adversarial, registry-signature, dependency-audit, zero-warning lint, TS6, TS7, unit + per-file coverage, Worker/Durable Object, build, E2E and final-reliability gates. It was squash-merged as `6d4c90677d00fdc4c4df9b717859e08e42dbfb24`.

Pass 3 passed the same exact-head certification pipeline and was squash-merged as `6e74ced1e6f85014801122bdc1a33c700dcbad2a`.

Pass 3 tests pin: trivial-turn skip; exact-user-span evidence; app-owned kind/title/tags/confidence/importance/scope; paraphrase rejection; credential rejection; strict schema; duplicate-candidate collapse; retry idempotency and evidence-fingerprint privacy; deliberate-memory and regeneration exclusion; classifier failure isolation; tool-less/memory-less Gemini classifier calls; bounded output; explicit provider completion; response-save-before-observer ordering; no observer after failed persistence; observer degradation without chat failure; non-fatal activity-trace persistence; and dedicated memory activity presentation for recall, deliberate memory tools and organic capture.

Pass 4 passed the exact-head certification pipeline and was squash-merged as `14ae86d8b0a4713b3671183c0073db1bc53ac1dc` (`#63`). Its deterministic coverage pins same-scope/same-domain literal support, reinforcement thresholds and ceilings, IEEE-754-safe policy weights, staged promotion, no automatic CORE, conflict promotion blocking, supersession dormancy/history preservation, expiry, stale organic dormancy, explicit maintenance sweep, dormant micro recall exclusion, relationship-capacity fail-closed semantics, saturated replay idempotency, organic transaction rollback at saturation and deterministic legacy-key migration behavior.

Pass 5 implementation head `c85c2b6aafc474b3d8a951f7b6b1fd38f841e89f` passed documentation, verification, security, secret, supply-chain, test-quality, registry-signature, dependency-audit, zero-warning lint, TS6, TS7, unit + coverage, Worker/Durable Object, build, E2E and final-reliability gates before this documentation finalization. Pass 5 also exposed and fixed a pre-existing Playwright race in the shared YouTube consent fixture; the deterministic fixture head restored the full media E2E suite before archive hardening was attached.

Pass 5 tests pin landmark salience without eligibility bypass, provenance views, exact duplicate and explicit contradiction inspection, shared preview/mutation lifecycle policy, strict/versioned/bounded archive format, fresh-ID transactional import, CORE demotion, scope/provenance/autonomy reset, internal relationship remapping, rejection of duplicate/dangling/self relationship authority, and browser acceptance for landmark/audit/export/import behavior.

## 10. Completion passes

| Pass | Deliverable | Status |
| --- | --- | --- |
| 0 | baseline + invariants + exact capability contract | complete / merged (`c95b411`) |
| 1 | deliberate `memory.save` + authoritative provenance/idempotency | complete / merged (`217a4d7`) |
| 2 | scoped `memory.lookup` + safe `memory.reconcile` | complete / merged (`6d4c906`) |
| 3 | bounded post-turn organic observer | complete / merged (`6e74ced`) |
| 4 | reinforcement, contradiction, supersession and promotion/dormancy policy | complete / merged (`14ae86d`) |
| 5 | Memory Bank parity: maintenance, landmarks/pinning, provenance views, guarded import/export | complete / PR #64 |
| 6 | adversarial certification + final documentation / agent handoff | pending |

Semantic/vector retrieval, cloud memory sync, autonomous forgetting and a separate WorldState database remain outside this completion program.

## 11. Current gap

The functional memory program is now complete through the Memory Bank product/maintenance layer: deliberate save/reconciliation, bounded organic observation, deterministic reinforcement and lifecycle, contradiction/supersession preservation, landmarks, provenance views, maintenance audit and guarded portable backup/transfer all remain projections or operations over the one canonical `db.memories` store.

Pass 6 is the remaining work. It performs the final hostile/adversarial certification across prompt-injection memory, malicious tool arguments, spoofed provenance/scope, replay/idempotency abuse, generation cancellation, persistence failure, relationship saturation, malformed/oversized archives, cross-folder leakage, large-bank behavior, stale/contradictory evidence, import corruption and authority-boundary attempts. It then leaves this document and the repository's future agent-operability layer in a zero-context handoff state.