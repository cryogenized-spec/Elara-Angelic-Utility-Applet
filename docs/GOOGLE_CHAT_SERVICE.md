# Google Chat Service

Prompt 45 establishes a focused Google Chat service boundary alongside the higher-priority Gmail orchestration work.

The service keeps Chat message listing, retrieval, creation, partial update, and deletion as explicit operations. OAuth authorization remains outside the service, and Chat does not know about Kanban or UI state.

Google's current Chat scopes distinguish read-only message access from message creation/update/delete capabilities, so the application continues to keep read and write capabilities separate. citeturn757480search0

Future Chat operations should be added as isolated service methods when needed by orchestration; the application should not introduce a generic arbitrary-HTTP Chat tool.
