# Testing Strategy

## Objective

Testing must prove Elara's contracts without turning the test suite into a single end-to-end monolith. The strategy follows the same module ownership boundaries as production code.

## Test layers

### 1. Pure unit tests

Use Vitest for deterministic domain and application logic that does not need a browser or network.

Examples:
- model capability filtering
- settings normalization
- request contract validation
- stream-event normalization
- request lifecycle transitions
- normalized provider-error mapping
- attachment validation and metadata rules
- appearance-state normalization
- conversation/part transformations
- diagnostics redaction

These tests should be fast, isolated, and deterministic.

### 2. Adapter/integration tests

Use focused tests around infrastructure adapters with controlled fakes or test doubles.

Examples:
- Dexie repositories against an isolated test database
- SpeechRecognition capability adapter with mocked browser APIs
- provider adapter against mocked Interactions responses/streams
- Worker request boundary with synthetic requests

Do not use live Gemini credentials, real OAuth grants, or production data in the default test suite.

### 3. Browser component tests

Use browser-capable testing only where browser behavior materially affects correctness: keyboard-safe composer behavior, focus management, responsive state, file selection, accessible controls, and stream rendering.

Keep components shallow enough that most logic remains covered by unit tests.

### 4. End-to-end tests

Use Playwright for a small number of high-value user journeys. Playwright supports Chromium/WebKit/Firefox and mobile emulation, making it suitable for the Android-first responsive contract.

Primary E2E journeys:

1. Launch app → create/use conversation → type message → send → observe streamed reply state → conversation remains visible.
2. Composer → attach supported image/PDF → preview → remove attachment.
3. Appearance → switch light/dark/system → apply background → preserve readable conversation surface.
4. Provider failure → explicit error state → recovery control is usable → no endless spinner.

The E2E suite must not attempt to reproduce every unit-level rule.

## Contract-testing principles

The canonical Gemini provider is tested at its application-facing boundary. Tests should assert that:

- only supported settings reach the adapter
- system instruction is passed through its dedicated field
- multimodal parts are translated predictably
- stream lifecycle events are normalized
- terminal completion/failure is explicit
- cancellation stops rendering/persistence work cleanly
- secrets and user content do not enter diagnostics metadata

## Persistence testing

Persistence tests must cover transaction behavior, migration behavior, partial stream checkpoints where implemented, deletion/removal semantics, and recovery from malformed or unavailable data.

Tests should use the authoritative repository interface rather than coupling the rest of the application to raw tables.

## Security and privacy tests

At minimum, tests must prove:

- protected Gemini/OAuth secrets are never serializable through UI state
- diagnostics redact authorization headers, tokens, API keys, cookies, and similar secrets
- analytics defaults exclude user message contents
- tool schemas cannot contain credential fields by construction or validation
- character system instruction remains separate from ordinary conversation message persistence

## Test naming and location

Prefer tests beside their owned module when that improves discoverability:

```text
src/
  feature/
    thing.ts
    thing.test.ts
```

Use dedicated integration/E2E directories for tests spanning multiple modules.

Test names should describe behavior and observable outcome, not implementation trivia.

## Mocking rules

Mocks are allowed to isolate an external boundary, not to make internal architecture invisible.

Do not mock every internal function. Prefer real pure functions and small in-memory fakes for owned interfaces.

Never mock away the very contract a test claims to prove.

## Network rules

Default CI tests must not depend on live Gemini, Google Workspace, or other external network services. Live smoke tests, when later added, must be opt-in and isolated from the required green CI path.

## Reliability gates

A completed runtime milestone is not complete until CI can demonstrate the relevant gates:

```text
install
→ lint
→ typecheck
→ unit/integration tests
→ production build
→ selected Playwright E2E
```

The exact command names may evolve with the scaffold, but the gates themselves are mandatory.

## Coverage philosophy

Coverage percentage is a signal, not the target. Prioritize branch and state coverage around failures, cancellation, validation, security boundaries, persistence recovery, and capability filtering.

A small utility with many edge cases deserves more tests than a trivial presentational component.

## Android-first quality bar

Every user-visible critical path must be exercised at a narrow portrait viewport in Playwright before release. Tests should account for mobile viewport dimensions, touch-oriented controls, keyboard overlap risks, safe-area spacing where representable, and readable loading/error states.

## Performance testing

Performance budgets defined in `docs/PERFORMANCE_BUDGET.md` are release constraints. Performance tests should measure actual user-visible behavior where practical and should not be replaced by arbitrary synthetic timing assertions.

## Failure handling

A failing test is a design signal. Do not weaken an assertion merely to recover CI. Determine whether the production contract or the test is wrong, fix the underlying issue, and document intentional contract changes.

## Current scaffold note

Before Prompt 25, the repo has no installed dependency graph or generated lockfile. Therefore this strategy is defined first rather than pretending that lint/typecheck/test/build has already run. Prompt 25 introduces the first executable slice; CI must then move from document-only gating to real runtime verification.