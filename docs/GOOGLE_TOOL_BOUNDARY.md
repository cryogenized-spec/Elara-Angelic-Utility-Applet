# Google Tool Boundary

Prompt 46 defines the model-visible Google tool surface as an explicit allow-list. The model can request named operations, but it cannot invent endpoints, OAuth scopes, tokens, or arbitrary HTTP requests.

## Granularity

Calendar, Tasks, Docs, Chat, Gmail, Drive, and Sheets are intentionally exposed as separate operations. Examples include Calendar event patch versus move, Tasks update versus move, Docs batch updates, Gmail message label modification versus thread modification, Drive metadata/file movement, and Sheets range updates versus batch updates. This preserves enough resolution for the future orchestration/Kanban layer to represent exactly what Elara intends to do.

The current registry contains named operations across Calendar, Tasks, Docs, Chat, Gmail, Drive, and Sheets. New operations should be added as small descriptors and matching validated service calls, not by creating a universal `google.request` tool.

Drive and Sheets operations added during Pass 5 have dedicated bounded argument schemas in `src/google/tools/drive-sheets-schemas.ts`. These schemas are application-owned validation contracts; they do not expose provider OAuth scopes or credentials.

## Execution boundary

Pass 6 now centralizes the application-side gate in `src/google/tools/executor.ts`:

1. Model emits a registered tool call.
2. Application validates the tool and arguments.
3. The registry supplies the required application capability and mutation risk.
4. Current OAuth capability state is checked.
5. Write/destructive/send risk is passed through the confirmation policy.
6. A registered service handler performs the concrete Google operation.
7. The executor returns a normalized result with a correlation ID or a structured failure state.

Tool schemas contain no OAuth scope strings, access tokens, secrets, or endpoint URLs exposed to the model.

## Mutation policy

Read operations can proceed when authorized. Write, destructive, and send operations require explicit confirmation through the shared confirmation policy. Confirmation requests are time-bounded and contain only non-secret operation metadata.

## Diagnostics

Tool execution failures are normalized through `src/google/tools/diagnostics.ts`. Raw provider/handler exception details are not returned to the model or surfaced as diagnostic payloads. Correlation IDs allow higher layers to associate events without copying sensitive request data.

## Modularity

Tool contracts, tool argument validation, tool registry, execution gate, OAuth authority, Calendar/Tasks/Docs/Chat/Gmail/Drive/Sheets services, orchestration state, and UI remain separate modules. The tool registry is an adapter catalog, not a service manager and not a Kanban controller.
