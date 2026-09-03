# Request Lifecycle State Machine

Prompt 34 defines one explicit state machine for a user turn from submission through terminal outcome.

## States

```text
idle
  → validating
  → queued
  → requesting
  → streaming
  → completed

Any active state may transition to:
  cancelling → cancelled
  failed
```

A completed, cancelled, or failed request is terminal. A new user retry is a new lifecycle with an explicit link to the previous attempt.

## Ownership

The chat/application layer owns lifecycle transitions. The UI renders state and dispatches user intent. The Gemini provider emits normalized events but does not own application state. Persistence records durable checkpoints without becoming the runtime state machine.

## Required invariants

1. One user submission creates one logical request and one user message.
2. At most one active assistant stream exists for that request.
3. Cancellation is idempotent and cannot accidentally trigger retry.
4. Terminal states are persisted explicitly.
5. A provider failure cannot leave the request in `streaming` indefinitely.
6. Retry attempts retain diagnostic correlation and do not duplicate the logical turn.
7. Provider continuation identifiers are metadata, not conversation text.

## Event mapping

Normalized provider events drive `streaming`, output accumulation, thought summaries, tool-call observations, completion, and failure. Network/request infrastructure may produce timeout, cancellation, or transport-failure signals. Application validation may terminate before the provider is called.

## Persistence

Persist the durable message/request state at controlled checkpoints rather than after every token. The UI may render optimistic in-memory state, but recovery must come from the authoritative persistence store.

## Testing contract

State-transition tests must prove valid and invalid transitions, cancellation races, timeout termination, provider failure termination, retry linkage, duplicate-send prevention, and restart recovery from persisted terminal/in-progress states.