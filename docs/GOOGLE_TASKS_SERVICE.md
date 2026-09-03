# Google Tasks Service

Prompt 43 establishes a dedicated Google Tasks service boundary for the future Elara orchestration/Kanban layer.

## Required operation surface

The service exposes retrieval and mutation as explicit application operations rather than a generic HTTP client. Retrieval includes task-list enumeration, filtered task listing, and individual task lookup. Mutation includes create, full update, delete, move/reorder, and clearing completed tasks.

The move operation is important for orchestration because Google Tasks supports changing a task's parent and its position among siblings. This preserves the distinction between changing task content and changing task structure/order.

## Authorization

Reads request `tasks.read`. Mutations request `tasks.write`. The application must never infer write permission from a read grant.

Google's current Tasks API documents `tasks.readonly` for viewing tasks and `tasks` for creating, editing, organizing, and deleting them. The API also exposes `tasks.move`, including parent and sibling-position changes. citeturn756805search0turn455180search6turn455180search12

## Boundary rules

- No OAuth tokens are accepted by service methods.
- Tool schemas will call typed application operations; they will not construct Google HTTP requests.
- Kanban/orchestration code consumes normalized task objects and operation results; the Tasks service does not know about Kanban UI state.
- Pagination tokens remain explicit so later orchestration can page deterministically instead of silently truncating results.
- Provider response parsing should be hardened with runtime validation before the service becomes production-critical.

## Future expansion

Additional operations may be added as isolated methods when they correspond to real Tasks API capabilities. New methods must retain explicit read/write capability checks and must not turn this file into a general-purpose Google client.
