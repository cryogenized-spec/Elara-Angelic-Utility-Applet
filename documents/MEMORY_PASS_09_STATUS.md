# Memory Pass 9 — Operational Model-Facing Capability (Interim Memory Module)

## Status

Implemented on 2026-09-10 as the first operational vertical slice that lets
Gemini participate in the durable-memory loop.

Passes 1–8 built the authoritative store, the deliberate capability, the
permission policy, retrieval, provider context composition, the Memory Bank,
and hardening — but no Gemini-visible memory tool existed and the runtime
instruction said nothing about memory (previously pinned by
`src/memory/gemini-memory-capability.audit.test.ts`). This pass implements the
missing operational bridge while preserving the Angelic architecture and all
existing safety boundaries.

## What shipped

- Added `src/memory/gemini-tool.ts`: the central memory-tool registry mapping
  `memory.save` → `save` (`exposure: 'gemini'`) and reserving `memory.observe`,
  `memory.consolidate`, `memory.forget`, `memory.delete` as `internal`
  placeholders with their permission mapping. The strict Zod args schema
  accepts only semantic fields the model should control
  (`title`, `body`, `kind?`, `tags?`), restricts kind to
  `CORE | CONTEXTUAL | EPISODIC`, and rejects every application-owned field.
- Added `src/memory/tool-executor.ts`: the capability adapter
  (`executeMemoryTool`) implementing MODEL PROPOSES → APPLICATION ADMITS →
  DURABLE STORE: exposure check → strict validation → centralized permission
  check → shared scope resolution → duplicate resilience through the existing
  pure retrieval boundary → `memory.save()` with app-injected `source:
  'elara'` provenance. Structured results, never throws to the loop.
- Added `src/memory/scope.ts`: the ONE active-folder-scope resolver, shared by
  the retrieval read path and the new save write path. `loadMemoryContext()`
  was refactored onto it with no behavior change.
- Added `src/memory/reflection.ts`: the pure future-reflection extension
  contract (`ReflectionInput` + bounded assembler). No scheduler, no engine,
  no IndexedDB coupling.
- Wired `memory.save` into the single Gemini interaction path: declarations
  merge in `buildInteractionPayload()` (`src/gemini/provider.ts`), execution
  branches in `streamGoogleToolLoop()` (`src/gemini/google-tool-loop.ts`),
  default chat tools include it and provenance (`conversationId`/`messageId`)
  flows from `src/app/App.tsx`.
- Added the concise `DURABLE MEMORY` runtime instruction
  (`src/gemini/runtime-context.ts`): deliberate judgment guidance, explicit
  remember / do-not-remember handling, no database-ritual narration.
- Memory Bank UI unchanged: it already inspects content, kind, confidence,
  importance, provenance (`Source: Elara`), scope, and lifecycle over the
  canonical store. Model-created entries are recognizably distinct through
  provenance, not a parallel database.

## Deliberate non-goals

No model-driven forget/delete (structurally unavailable, policy still denies);
no `memory.observe` / `memory.consolidate` Gemini tools yet; no autonomous
extraction, reflection engine, scheduler, embeddings, second database, or
Memory Bank redesign.

## Capability contract

```text
Gemini
  │
  │ memory.save({ title, body, kind?, tags? })
  ▼
Capability adapter (src/memory/tool-executor.ts)
  │
  ├── exposure check (gemini-visible?)
  ├── strict schema validation (semantic fields only)
  ├── permission check (model + save)
  ├── scope injection (application-resolved folder scope)
  ├── provenance injection (source: elara + conversation/message refs)
  ├── duplicate resilience (existing pure retrieval over visible scope)
  └── normalization (canonical store)
  │
  ▼
Canonical memory store (IndexedDB/Dexie)
```

Model-owned: `title`, `body`, `kind` (no `MICRO_OBSERVATION`), `tags`.
Application-owned: everything else — `id`, timestamps, `source`, `folderId`,
`lifecycle`, `confidence`, `importance`, expiry, autonomy consent,
relationships, reinforcement, supersession.

## Authorization semantics

One centralized boundary: `authorizeMemoryMutation()` in
`src/memory/permissions.ts`, evaluated inside the adapter before persistence.
Default policy unchanged: model may save/observe/consolidate; model
forget/delete denied. `memory.forget` / `memory.delete` are additionally
refused structurally (`NOT_PERMITTED`, exposure `internal`) even if policy
were relaxed, and the loop refuses memory tools in read-only turns and when
undeclared (`TOOL_NOT_PERMITTED`).

## Confirmation policy — evidence-based recommendation

**Model saves execute directly under model policy; no per-save confirmation
dialog.** Evidence:

1. The memory permission policy is already the centralized authorization
   boundary (Pass 4), evaluated before every mutation.
2. The Google write-confirmation policy governs *external* side effects
   (email sent, docs changed). A memory save is application-local,
   inspectable in the Memory Bank, and reversible (archive/restore/delete).
3. The old Elara system ran extraction and notebook maintenance without
   per-memory confirmation dialogs.
4. A confirmation per save would destroy the autonomy this slice exists to
   establish, and would train click-through for genuinely destructive
   operations that remain confirmation-gated.

Destructive power stays denied: model forget/delete are refused both by
policy and structurally, so the model can propose knowledge but can never
destroy the store on impulse.

## Provenance semantics

Every model-created memory carries `source: 'elara'` plus the application
`createdAt` and the turn's `conversationId`/`messageId` where available. The
strict tool schema has no `source` field, so the model can never claim
`source: 'user'`.

## Scope semantics

The model supplies no scope. The adapter resolves the active thread's folder
assignment (with ancestry and global-context policy) through the same
resolver the retrieval path uses, and injects `folderId`. A memory created in
Project A cannot drift global because the model omitted scope.

## Cognitive loop (now operational)

```text
experience → conversation → interpretation → memory decision
                                                  │
                                            memory.save
                                                  ▼
                                     durable memory → retrieval
                                                          │
                                               future interpretation
                                                          │
                                                      reflection (extension point)
                                                          │
                                                    refined memory
```

## Future reflection

```text
Recent conversations + Durable memories + Observations
                        │
                        ▼
                 Reflection job (future)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
         patterns   conflicts   recurrence
            │           │           │
            └───────────┼───────────┘
                        ▼
         observations / consolidation /
              future memory decisions
```

Reflection will consume `ReflectionInput` and propose changes through the
same canonical capability boundary — another caller of the adapter, not
another authority.

## Tests

- `src/memory/gemini-tool.test.ts` — declaration shape, registry/permission
  mapping, schema accept/reject matrix (33 tests).
- `src/memory/tool-executor.test.ts` — provenance, app-owned scope, Dexie
  persistence, policy denial, structural refusal of internal tools, dedup,
  retrieval-after-save, read-path-never-writes (9 tests).
- `src/gemini/memory-tool-loop.test.ts` — autonomy without keyword trigger,
  explicit “remember X”, no-decision creates nothing, invalid-args feedback,
  read-only refusal, undeclared refusal, structural forget refusal (7 tests).
- `src/memory/reflection.test.ts` — pure bounded reflection-input contract
  (3 tests).
- `src/memory/gemini-memory-capability.audit.test.ts` — deliberately updated
  to pin the new state; `src/gemini/runtime-context.test.ts` extended.
- Full suite: 700/700 passing; `typecheck`, `lint`, `build`, and worker
  tests verified (see PR report).

## Known limitations

- Dedup is normalized exact-match over the visible scope, not semantic
  similarity; near-duplicate paraphrases can still accumulate until
  reflection/consolidation matures.
- The model cannot yet record observations or request consolidation through
  tools; those remain capability-level operations for a later slice.
- No user-facing permission-settings panel yet (unchanged from Pass 4).

## Recommended next step

The `memory.observe` Gemini tool as the evidence-layer slice: same registry
(exposure flip), same adapter pattern, `MICRO_OBSERVATION`-only schema — then
a scheduled reflection prototype consuming `ReflectionInput` to propose
support/conflict/related consolidations.
