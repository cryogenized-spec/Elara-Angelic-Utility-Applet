# Response Variants

## Purpose

Regeneration creates an additional answer to the same user prompt. It does not create another visible user message and does not continue from the previously generated assistant answer.

## Data model

Each assistant response that belongs to a regeneratable prompt carries:

- `responseGroupId`: stable identifier shared by every generated response for that prompt. New turns use the originating user message ID.
- `responseVariant`: 1-based variant number within the response group.

The originating user message remains a single message. A normal first response is variant `1`; each regeneration appends another assistant message in the same response group.

Older assistant messages without variant metadata remain readable. The first regeneration promotes that existing assistant message to variant `1` and then creates variant `2`.

## Conversation continuity

A regeneration branches from the interaction immediately before the originating user prompt. It must not use the selected response's `interactionId` as `previousInteractionId`, because that would make the next response a continuation of the previous answer rather than a fresh answer to the same prompt.

When no earlier assistant interaction exists before the prompt, the regenerated request omits `previousInteractionId`.

The original user prompt text is sent again as the input for each generated variant.

## Presentation

The conversation surface renders a response group as one assistant message. Only one variant is visible at a time.

Above Elara's text, the group provides previous/next chevrons and a compact pagination indicator such as `1/3`, meaning the first of three generated responses is currently selected.

Below the response, `Regenerate` creates the next variant. Navigation between variants does not create new conversation messages.

After a new regeneration completes, the newest variant becomes the selected variant automatically.

## Persistence

All variants are stored as ordinary assistant messages in the existing local conversation store. The response-group metadata is part of the message object; no new IndexedDB index is required.

## Security and provider rules

Response variants use the same canonical Gemini provider path, system instruction, model settings, tool registry, OAuth authority, and security boundaries as ordinary responses. Regeneration is a UI/conversation feature, not a second provider implementation.

The canonical Elara system instruction is delivered through the provider's dedicated system-instruction field. The Worker supplies the canonical instruction when a request does not provide one, and the application translates legacy placeholder character profiles to the canonical instruction before sending a request.
