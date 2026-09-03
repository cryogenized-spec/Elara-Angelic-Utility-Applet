# Google Tool Boundary

Prompt 46 defines the model-visible Google tool surface as an explicit allow-list. The model can request named operations, but it cannot invent endpoints, OAuth scopes, tokens, or arbitrary HTTP requests.

## Granularity

Calendar, Tasks, and Gmail are intentionally exposed as separate operations. Examples include Calendar event patch versus move, Tasks update versus move, and Gmail message label modification versus thread modification. This preserves enough resolution for the future orchestration/Kanban layer to represent exactly what Elara intends to do.

The current registry contains 31 named operations across Calendar, Tasks, and Gmail. New operations should be added as small descriptors and matching validated service calls, not by creating a universal `google.request` tool.

## Execution boundary

1. Model emits a validated tool call by registered name.
2. Application validates arguments at the trust boundary.
3. The registry supplies the required application capability and mutation risk.
4. OAuth authority authorizes the capability.
5. The feature service executes the concrete Google API operation.
6. The operation result becomes auditable application state for future orchestration/Kanban presentation.

Tool schemas contain no OAuth scope strings, access tokens, secrets, or endpoint URLs exposed to the model.

## Mutation policy

Read operations can proceed when authorized. Write, destructive, and send operations are classified by risk and must pass the separate write-confirmation layer before execution when policy requires it.

## Modularity

Tool contracts, tool registry, OAuth authority, Calendar/Tasks/Gmail services, orchestration state, and UI remain separate modules. The tool registry is an adapter catalog, not a service manager and not a Kanban controller.
