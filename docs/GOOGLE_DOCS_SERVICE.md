# Google Docs Service

Prompt 44 establishes a focused Docs service without making Docs a generic HTTP layer.

## Operation boundary

The service supports document retrieval, document creation, and atomic `batchUpdate` requests. Complex editing remains represented as explicit Google Docs request objects so the application can take advantage of the API's detailed mutation model without inventing a lossy abstraction.

Google's current Docs API documents `documents.get`, `documents.create`, and `documents.batchUpdate`; batch updates validate the request collection and apply the operations atomically. citeturn909083search1turn909083search3

## Orchestration rule

The eventual Kanban/orchestration layer may request document operations, but it must not know Google endpoint paths or OAuth tokens. A higher-level operation should be decomposable into auditable service calls rather than hidden inside a Docs manager.

## Future expansion

Document structural editing, tables, comments, suggestions, formatting, and other capabilities can be added as typed operation modules while preserving this service boundary. The current implementation deliberately avoids a monolithic document editor abstraction.
