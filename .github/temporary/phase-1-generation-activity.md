# TEMPORARY — Phase 1 Generation Activity Ledger

> **Temporary working record. Not canonical documentation.**
> This file exists only while Phase 1 is being implemented, verified and human-tested. Once the phase is accepted, durable facts are to be distilled into the canonical documentation register and this temporary file removed.
>
> Status vocabulary is intentionally explicit: **ACCOMPLISHED** means the implementation step exists on this branch and satisfies its intended code-level contract to the confidence stated; **NOT YET ACCOMPLISHED** means a required part, proof, or acceptance gate remains outstanding. A green CI result is evidence, not a substitute for the functional criterion.

## Chronological Phase 1 record

### 1.1 Reuse the existing generation path

**Status: ACCOMPLISHED**  
**Confidence: 98%**

The existing `GenerationState` reducer, application generation arbiter, Gemini event stream, conversation persistence path and tool loop remain authoritative. No second generation store, event bus, database, or parallel provider path was introduced. The feature is being built as projections of the existing normalized event stream.

Remaining uncertainty is limited to integration behaviour under browser-level edge cases rather than architectural duplication.

### 1.2 Replace the split live/persisted trace model with one structured activity model

**Status: ACCOMPLISHED**  
**Confidence: 94%**

Generation activity is represented as structured activity data derived from the same reducer state used by the live turn. The old separately-shaped persisted execution-summary presentation has been retired in favour of one activity representation and one rendering path for live and completed states.

The remaining confidence gap is browser verification of transition behaviour at the exact live-to-persisted boundary.

### 1.3 Preserve provider reasoning summaries without exposing hidden reasoning payloads

**Status: ACCOMPLISHED**  
**Confidence: 99%**

Provider `thought_summary` text is accepted and displayed as the provider-supplied summary. Encrypted thought signatures remain ignored by application state and are neither displayed nor persisted. No attempt is made to reconstruct hidden chain-of-thought.

### 1.4 Model tool activity from canonical tool events and names

**Status: ACCOMPLISHED**  
**Confidence: 96%**

Tool activity is derived from the existing canonical tool-call events and names. Tool timing remains open across the execution/confirmation gap until the continuation interaction arrives, so elapsed time measures the actual round trip rather than only provider emission time. Categories are derived from canonical names instead of maintaining an unrelated UI registry.

### 1.5 Represent durable-memory retrieval as application activity, not a fake Gemini tool

**Status: ACCOMPLISHED**  
**Confidence: 94%**

Memory retrieval remains app-owned context composition. Activity metadata reports coarse retrieval outcome only; retrieved memory contents are not copied into diagnostic/activity metadata. Retrieval failure remains non-fatal to the Gemini request, preserving the existing fail-open context boundary.

Browser-level proof that every retrieval outcome presents correctly is still part of the adversarial verification step below.

### 1.6 Render one Generation Activity component for live and completed turns

**Status: ACCOMPLISHED**  
**Confidence: 91%**

The live trace and completed activity are rendered through the singular activity presentation rather than separate components with diverging logic. Multiple thinking phases remain distinct, tool steps remain distinct, and terminal records use the same underlying structured activity data.

The remaining confidence gap is visual and interaction testing under very long traces and rapid phase transitions.

### 1.7 Bound activity growth and anchor the beginning of a generated turn

**Status: ACCOMPLISHED at code level; browser proof outstanding**  
**Confidence: 78%**

The conversation scroll owner now anchors the beginning of Generation Activity when a new turn starts. The activity body is internally bounded so trace growth does not require the outer conversation to chase the bottom. Manual user scrolling cancels automatic following rather than being overridden.

This criterion is not considered fully proven until Playwright exercises long activity, manual scroll interruption, and response growth below the activity surface.

### 1.8 Timing presentation

**Status: ACCOMPLISHED**  
**Confidence: 97%**

Timing formatting uses millisecond display below one second and seconds thereafter, including decimal-second display where useful. Individual steps and the total turn retain their independent timing boundaries.

### 1.9 Persist a user-selectable Generation Activity accent colour

**Status: NOT YET ACCOMPLISHED**  
**Confidence in current partial implementation: 72%**

The preference field, validation, persistence path and Appearance control exist. The final application-level CSS-variable bridge is still outstanding, so the selected value is not yet guaranteed to drive the activity surface. This step remains open until the value is wired, reloaded, and verified end to end.

### 1.10 Remove superseded duplicate operations and presentation paths

**Status: ACCOMPLISHED at implementation level**  
**Confidence: 92%**

The obsolete separate completed-summary component/presentation path has been removed rather than kept as a compatibility facade. No second activity persistence authority has been added.

A final repository search is still required after all edits to prove no stale imports, selectors, or invocation paths survive.

### 1.11 Standardise project command invocation

**Status: NOT YET ACCOMPLISHED**  
**Confidence in intended change: 99%**

The repository already exposes `npm run e2e` and pins `@playwright/test`. CI still needs to be checked and, where it invokes Playwright through `npx`, changed to the existing npm script interface or another lockfile-bound npm invocation. This keeps `package.json` and the installed dependency graph as the project command authority and removes an unnecessary second invocation style.

### 1.12 Unit and integration edge-case coverage

**Status: PARTIALLY ACCOMPLISHED / NOT YET PROVEN**  
**Confidence: 84%**

Tests have been added or updated for lifecycle timing, distinct thinking/tool steps, tool continuation timing, terminal persistence, summary truncation, memory outcomes, failure/cancellation, stale-generation arbitration and the one-assistant-message invariant.

The complete unit suite has not yet been observed passing on the final Phase 1 head, so this gate remains open.

### 1.13 Adversarial browser pass — deliberately try to break the feature

**Status: NOT YET ACCOMPLISHED**  
**Confidence in planned coverage: 96%**

Required attacks include: no reasoning summary; huge reasoning summary; many reasoning phases; rapid think→tool→think→write transitions; simultaneous/multiple tool categories; memory used/empty/unavailable; tool failure; provider failure; cancellation at every phase; regeneration; thread switch during generation; stale late events; manual scrolling during activity growth; long activity overflow; completed/live transition; preference reload; malformed stored accent value; reduced-motion mode; narrow Android portrait viewport; and activity followed by a very long streamed answer.

Failures found here must be fixed in production code or tests that reproduce the real defect. The gate must not be weakened to manufacture green CI.

### 1.14 Full repository verification on the final implementation head

**Status: NOT YET ACCOMPLISHED**  
**Confidence: pending evidence**

Required final gates: documentation-integrity guard, lint, full TypeScript typecheck, unit tests, Worker/Durable Object tests, production build, Playwright E2E across the configured projects, and final reliability gate. Earlier partial green steps do not certify a later commit.

### 1.15 Human acceptance test

**Status: NOT YET ACCOMPLISHED**  
**Confidence: pending user evidence**

Automated verification cannot certify the final interaction feel, visual hierarchy, scroll behaviour, or whether the activity surface conveys the intended experience. Human testing by the user remains an explicit acceptance gate.

### 1.16 Canonical documentation update

**Status: NOT YET ACCOMPLISHED — intentionally deferred**  
**Confidence in deferral decision: 100%**

Canonical documentation is not to be updated until implementation, automated verification and the user's human test have succeeded. At acceptance, the durable facts from this ledger will be distilled into the existing canonical register; implementation chronology will remain in Git/PR history, and this temporary ledger will be deleted.
