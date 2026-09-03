# Prompt 9 — Thinking Display

## Status

Accepted.

Thinking is separate from thinking-summary presentation. Gemini may perform reasoning without returning a visible summary. Elara displays only provider-supplied thought summaries and never reconstructs hidden chain-of-thought.

## Data flow

`Interactions thought step → normalized thought-summary event → chat state → optional UI presentation`

The thinking display consumes normalized events from Prompt 8. It does not import `@google/genai`, set `thinking_level`/budget, or perform network calls.

## Presentation rules

Thought summaries are optional, may be empty, and may arrive incrementally. The UI may collapse, expand, or hide them without changing the provider request. Summary text is not treated as a user message and is not allowed to masquerade as one.

## Persistence rule

A summary may be persisted only as an explicit typed message part if the later conversation schema requires it. There is no second reasoning store. Raw provider thought/signature payloads are never copied into analytics or diagnostics.

## Future compatibility

Tool-call steps and Workspace tool activity remain separate step types. The display layer can later render tool activity independently. The character master prompt and memory-note retrieval are request concerns, not thinking-display concerns.
