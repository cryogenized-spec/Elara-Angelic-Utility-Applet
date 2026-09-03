# Google Write Confirmation

Prompt 47 establishes the mutation gate used by the future Google orchestration layer.

## Policy

Read-only operations do not require a confirmation step. Write operations, destructive operations, and outbound sends are explicitly risk-classified and require confirmation before execution.

The confirmation request contains the tool name, risk class, a human-readable resource summary, and an issued timestamp. Confirmation freshness is bounded to five minutes by default so an old approval cannot silently authorize a later unrelated action.

## Important separation

The model may propose an action and explain why it wants to perform it. The character instruction may influence phrasing and roleplay. Neither the model nor the character can self-authorize an external mutation.

OAuth capability grants answer **whether the application is allowed to attempt the API call**. Write confirmation answers **whether this particular consequential action is approved**. These are separate controls.

## Orchestration/Kanban

The future Kanban layer should display pending confirmations and completed mutations as explicit operation records. It must not bypass this policy by calling feature services directly.

Bulk, destructive, or externally visible actions can later receive stricter policy without changing the underlying Google services.
