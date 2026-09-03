# Gemini Native Background Execution

Prompt 49 defines the application's boundary for Gemini Interactions background execution.

## Upstream capability

The current Interactions API supports `background: true` for long-running interactions. The create request returns an interaction identifier immediately; clients can retrieve status, stream/reconnect to progress, and cancel an execution. Supported lifecycle states include `in_progress`, `requires_action`, `completed`, `failed`, and `cancelled`. citeturn383674search0turn383674search3

## Application boundary

Background execution is represented by a small interaction reference rather than a second provider runtime. The reference contains only the provider interaction identifier, normalized status, and creation time.

The background contract does not own:

- OAuth credentials or Gemini API keys
- UI state
- persistence implementation
- retry policy
- tool authorization
- conversation semantics

Those remain owned by their existing application boundaries.

## Long-running orchestration

A future orchestration/Kanban layer may treat a background interaction as an auditable work unit. The interaction can move through visible states while the underlying Gemini execution continues independently of the current chat screen.

`requires_action` is especially important: a long-running execution can pause awaiting client-provided action. That action must re-enter the normal tool/authorization/write-confirmation pipeline rather than bypassing it.

## Reconnection and chaining

A disconnected client must be able to retrieve the interaction by ID and resume observing its state. A subsequent interaction may use `previous_interaction_id` after the previous interaction reaches a permitted terminal state; an active `in_progress` interaction cannot be chained. citeturn383674search1

## Cancellation and retention

Cancellation is an explicit application action and maps to the provider's cancellation operation. Deleting a remote interaction record is distinct from cancelling execution and must not be confused with local conversation deletion. citeturn383674search0

## Security and modularity

Only the canonical Gemini provider boundary may know the concrete SDK calls. Background execution reuses that provider boundary; it does not introduce a background-specific Gemini client.

No polling loop belongs in React components. A future coordinator may schedule bounded polling/reconnection, while UI components subscribe to normalized state.
