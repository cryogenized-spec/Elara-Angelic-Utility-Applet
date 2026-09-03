# Prompt 5 — Gemini Integration Strategy

Status: accepted as the canonical Gemini provider strategy.

Elara has exactly one production Gemini execution path: Interactions API through `@google/genai`. The archived application's legacy GenerateContent path, duplicate provider abstractions, and fallback execution are prohibited.

The application-facing seam is provider-neutral. UI and chat never import the Gemini SDK. The provider translates normalized application requests into current Interactions API structures and translates provider events/results back into normalized application contracts.

Future capabilities are layered around this same provider rather than creating alternate Gemini paths:

- curated function/tool declarations are attached as explicit request capabilities;
- Google Workspace tools execute through the Google authorization/service boundary;
- the character master system instruction is composed independently from user content and tool schemas;
- long-term notes are retrieved as bounded application context rather than embedded as an implicit memory manager.

The provider owns SDK construction, request translation, stream parsing, provider response translation, and provider-specific error classification. Chat owns conversation lifecycle and retry decisions. Persistence owns local state. Diagnostics owns safe diagnostic records. The Worker/security boundary owns protected application credentials.

Stateful Interactions use `previous_interaction_id` for normal continuation. Interaction-scoped settings such as system instructions, tools, and generation configuration must be supplied per request when they are intended to apply.

Background execution remains a later concern (Prompt 49).

The canonical provider must never contain UI code, Dexie access, OAuth logic, analytics, memory retrieval, tool execution logic, or implicit retry loops.
