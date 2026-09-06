# Elara Memory Architecture

## Status

Canonical architecture contract for the eight-pass durable-memory implementation.

The archived `Elara-Companion-current` memory system is reference material only. This document defines the canonical design for Elara-Angelic and does not require migration of the archived architecture's modules or runtime contracts.

## Core invariant

The Memory Bank UI, Omnisearch, retrieval context, and future memory tools are projections over one authoritative durable memory store.

```text
                         ┌──────────────────────┐
                         │   Durable Memory     │
                         │      Store           │
                         │    AUTHORITATIVE     │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
      Memory Retrieval        Memory Bank UI        Omnisearch
              │                     │                     │
              ▼                     ▼                     ▼
     bounded Gemini context   human inspection       query interface
```

No second memory database, no UI-owned persistence, and no permanently duplicated prompt-context copy is permitted.

## Eight implementation passes

### Pass 0 — Clear the runway

Repair pre-existing CI failures, establish a green baseline, and record this architecture before changing the memory runtime.

### Pass 1 — Memory foundation

Establish the canonical rich memory document, identifiers, normalization, validation, provenance representation, and IndexedDB persistence boundary. This pass must not make memory retrieval or autonomous extraction a prerequisite for ordinary chat.

### Pass 2 — Deliberate memory capability

Expose an application-owned memory capability so Elara can explicitly request that a memory be stored. The model supplies meaningful prose; the application owns identity, timestamps, provenance, validation, permissions, and persistence.

### Pass 3 — Observation and consolidation

Introduce observations as lower-lifecycle evidence and explicit consolidation into established memories. Supporting observations reinforce a target; conflicting observations remain linked and visible rather than silently replacing the target; related observations add context without mutating target prose.

### Pass 4 — Permission architecture

Introduce granular memory permissions. Application policy is authoritative and is evaluated before every model-requested memory mutation. Forget/delete is a first-class operation.

### Pass 5 — Retrieval engine

Build one canonical ranked retrieval engine with explicit relevance signals and a hard context budget. Retrieval may consider lexical relevance, recency, importance, confidence, reinforcement, lifecycle, memory kind, folder/project scope, and explicit entity relationships. Semantic embeddings remain a later enhancement rather than a prerequisite for a correct bounded baseline.

### Pass 6 — Gemini integration

Compose the bounded retrieval projection into the existing single Gemini interaction path. Memory retrieval remains application context rather than model-defined instruction, and memory failures remain non-fatal to the chat turn.

### Pass 7 — Memory Bank UI

Turn the existing memory settings surface into a human inspection interface over the same store: search, filters, collapsed records, one-record expansion, Markdown reading view, and direct navigation from search results.

Implemented UI details:

- Memory Bank is a dedicated Settings section rather than being nested inside Character configuration.
- Inspection reads through canonical `listMemories()` and the pure `filterMemoryRecords()` projection; it does not invoke ranked model retrieval or increment recall bookkeeping merely because a human browses records.
- Search covers title, body, and tags case-insensitively.
- Lifecycle, kind, and global-scope filters are available.
- Records are collapsed by default and only one record is expanded at a time. Opening a result scrolls the selected record into view.
- Expanded records render stored Markdown through the existing safe Markdown presentation boundary.
- Human edits continue through canonical store operations; archive/restore, promotion, and permanent delete remain explicit actions. Permanent deletion requires confirmation.
- No UI-owned IndexedDB table, second memory cache, or durable UI persistence layer is introduced.

### Pass 8 — Long-horizon hardening

Harden the same canonical store for long-running use without introducing a second authority. The implementation adds a read-only integrity health scan, multi-thousand-record retrieval stress coverage, and focused protection around deletion/permission semantics and conflict handling. Recovery remains explicit: malformed durable records are reported rather than silently deleted or rewritten. Export/import remains a future extension point, not an alternate persistence mechanism.

## Canonical memory document

A durable memory is a structured document with prose as its primary payload.

Required fields:

- `id`
- `kind`
- `title`
- `body`
- `createdAt`
- `updatedAt`
- `observedAt`
- `confidence`
- `importance`
- `lifecycle`
- `source`
- `tags`
- `relatedMemoryIds`
- `supportingMemoryIds`
- `conflictingMemoryIds`
- `supersedes`
- `supersededBy`
- `reinforcementCount`

`body` is UTF-8 text and may contain Markdown. Presentation is a later concern and must not alter stored text.

Folder/project scope remains an application concern and may be represented alongside the document when the current conversation/folder architecture requires it.

## Observations and consolidation

An observation is persisted as a `MICRO_OBSERVATION` memory record. Recording an observation does not promote or merge it into an established memory.

Consolidation is explicit and directional. A caller names the observation, target memory, and relationship:

- `support` — link the observation as supporting evidence and reinforce the target;
- `conflict` — link the observation as conflicting evidence while leaving the target prose and reinforcement count unchanged;
- `related` — link the observation as contextual evidence without mutating target content.

Repeated consolidation of the same observation is idempotent for the relationship itself. Support may still count as a deliberate reinforcement event, so callers should only invoke it when new evidence is actually being accepted.

Contradiction is represented, not resolved implicitly. Supersession and promotion remain explicit operations for a later decision, and no pass may silently overwrite an established memory merely because new evidence disagrees with it.

## Permission architecture

Memory mutation is capability-gated. The application owns a single granular policy with independent permissions for `save`, `observe`, `consolidate`, `forget`, and `delete` across `model`, `user`, and `system` actors.

The default policy permits the model to save explicit memories, record observations, and request consolidation, while denying model-initiated forget/delete. User and system actors may perform all five operations by default. A policy change is explicit and centralized; UI code and future model prompts must not duplicate or override authorization rules.

Authorization is evaluated before mutation. Storage primitives remain internal persistence operations rather than model-facing capabilities.

`forget` is a reversible lifecycle operation: it archives the record so it is retained but excluded from retrieval. `delete` is a hard removal from the durable store. Both are first-class capabilities, and model access to both is denied by default.

## Retrieval engine

Retrieval is a pure selection boundary over durable memory records. It does not own IndexedDB and does not mutate durable records.

The baseline score is intentionally bounded and explainable. It combines lexical query relevance from title/body/tags, importance, confidence, capped reinforcement, recency decay, lifecycle and memory-kind priors, and explicit relationship density.

Retrieval first applies lifecycle/expiry and folder/global scope filters, then ranks candidates, then enforces hard record and character limits. The current defaults are 8 records and 6,000 title+body characters, with absolute caps of 20 records and 20,000 characters.

The selector is pure and independently testable. IndexedDB recall bookkeeping remains in the canonical store after selection, so reading memories does not create a second persistence authority.

A multi-thousand-record stress test exercises ranking, scope filtering, uniqueness, ordering, and hard-budget enforcement over 5,000 candidates. The test asserts deterministic invariants rather than a fragile wall-clock threshold.

This baseline does not require embeddings or provider-specific semantic search. Those can be added later without changing the durable-memory contract.

## Long-horizon integrity

Durable storage remains strict: records written through the canonical store are normalized and schema-validated, and retrieval never persists its ephemeral `score` field.

`inspectMemoryStore()` provides a read-only integrity scan over the same IndexedDB table. It reports total, valid, and invalid records plus identifiers when available. It never repairs, deletes, or rewrites a malformed record because automatic destructive recovery would violate durability guarantees. A future migration/import surface can use the same schema boundary to perform an explicit, reviewable transformation.

The health scan is intentionally separate from normal browsing and retrieval. A healthy store therefore has no special runtime cost during ordinary chat, while operators and future maintenance UI can detect corruption without creating a second memory store.

## Gemini integration

The canonical Gemini provider requests a bounded memory projection for each normal interaction and appends it to the application-owned system instruction under an explicit `[APPLICATION CONTEXT — DURABLE MEMORY]` marker. The retrieved text is contextual data, not an instruction layer, and it does not replace or rewrite Elara's master character instruction.

The projection is derived from the current active thread's folder scope and the user's input, using the Pass 5 retrieval engine's limits. It is composed immediately before the existing Gemini interaction request so there is still one provider execution path.

Memory retrieval is deliberately best-effort. If IndexedDB, folder lookup, normalization, or retrieval fails, the provider sends the original system instruction without durable-memory context and continues the Gemini turn rather than failing the conversation.

Tool-result continuations use the same provider path and therefore receive the same bounded application context behavior; no separate memory provider or persistence path exists.

## Provenance

Provenance is structured metadata, not a free-form note. It must be able to distinguish at least:

- `user` — explicitly created or edited by the user;
- `elara` — explicitly proposed by Elara through a future memory capability;
- `import` — introduced through a future import operation;
- `migration` — transformed from an older Elara memory representation.

Future passes may add conversation, message, or source references without changing the fundamental contract.

## Boundary rules

The memory store owns durable records and record invariants. The retrieval engine owns ranking and context budgeting. The Memory Bank owns presentation. Omnisearch owns query UX. Gemini integration owns temporary context composition. Memory tools are capability adapters. None of these surfaces may become an alternate persistence authority.

Ordinary conversation history is not automatically converted into permanent memory. Observation creation and consolidation are explicit operations; autonomous extraction remains explicitly deferred until a dedicated future pass.

Memory persistence is best-effort from the chat path: a storage failure must never prevent an otherwise valid conversational response from being presented.

## Pass 1 completion criterion

Pass 1 is complete when the canonical rich memory schema, validation/normalization, deterministic identifiers, structured provenance, and Dexie-backed store are independently testable and existing application callers remain operational without introducing a second memory database.

## Pass 3 completion criterion

Pass 3 is complete when observations can be recorded as first-class evidence and explicitly consolidated into an established memory as support, conflict, or related context without silent replacement, autonomous extraction, or a second persistence path.

## Pass 4 completion criterion

Pass 4 is complete when every model-facing memory mutation crosses one centralized granular authorization boundary, default model policy cannot forget or delete durable memories, human/system forget and delete are explicit capabilities, and permission/forget/delete behavior is covered by focused tests.

## Pass 5 completion criterion

Pass 5 is complete when ranking and hard budgeting live in a pure canonical retrieval boundary, durable-store code delegates selection to that boundary, scope/lifecycle/expiry are enforced before ranking, context limits are bounded, and retrieval behavior is independently covered by focused tests.

## Pass 6 completion criterion

Pass 6 is complete when the existing single Gemini provider path composes the bounded durable-memory projection without changing the master instruction's role, retrieval failure cannot fail an otherwise valid Gemini turn, normal and tool-continuation requests share the same context boundary, and the integration behavior is independently covered by focused tests.

## Pass 7 completion criterion

Pass 7 is complete when Memory Bank provides search, metadata filters, collapsed record inspection, one-record expansion, safe Markdown reading, direct result navigation, and human-owned durable mutations while remaining a presentation projection over the canonical store with no alternate persistence authority.

## Pass 8 completion criterion

Pass 8 is complete when the canonical durable-memory store has explicit read-only integrity diagnostics, malformed records are surfaced without destructive implicit repair, large candidate sets are covered by stress tests with hard retrieval budgets, and deletion/permission/conflict semantics remain explicitly tested without introducing a second persistence authority.
