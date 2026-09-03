# Prompt 4 — System Boundaries

Status: accepted.

## Future capability constraints

### Tool calling
Gemini tool definitions are application-owned allow-listed capabilities. A model request is only a request to invoke a declared capability; it never grants arbitrary execution authority. A future tool service validates the call, executes it, produces a normalized result, and returns that result through the canonical Gemini provider. Tool schemas do not contain OAuth tokens or secret-bearing configuration.

### Google Workspace
Calendar, Tasks, Docs, and Chat remain behind one Google authorization authority and centralized scope registry. Workspace services never create their own consent flow and never bypass validation, diagnostics, or write confirmation.

### Character system prompt
The character's durable identity, personality, roleplay behavior, tone, and behavioral rules belong in a dedicated system-instruction source. This is separate from user messages, conversation history, tools, and persistence. A controlled prompt-building boundary later composes it into each interaction request as required.

### Long-term notes
Notable past experiences are a separate future memory/notes domain. Ordinary messages remain conversation history; only explicitly promoted/selected information becomes durable notes. Retrieval is a bounded application capability, not an implicit second database or chat manager.

### Modularity
No single manager/service/runtime may simultaneously own Gemini calls, streaming, tool execution, Workspace access, system-prompt composition, memory retrieval, persistence, diagnostics, and UI state. Each concern requires a narrow owner and contract.