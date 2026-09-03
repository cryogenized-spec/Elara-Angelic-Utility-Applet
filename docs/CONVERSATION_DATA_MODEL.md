# Prompt 10 — Conversation Data Model

## Status

Accepted.

The core model is intentionally small: a conversation contains ordered messages; a message contains typed parts; request/provider continuity is metadata, not message content.

## Core entities

```ts
Conversation {
  id
  createdAt
  updatedAt
  title?
  latestInteractionId?
}

Message {
  id
  conversationId
  sequence
  role: 'user' | 'assistant' | 'system'
  createdAt
  state: 'pending' | 'streaming' | 'completed' | 'cancelled' | 'failed'
  parts: MessagePart[]
  requestId?
  interactionId?
}

MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'image-ref'; attachmentId: string }
  | { kind: 'document-ref'; attachmentId: string }
  | { kind: 'thought-summary'; text: string }
  | { kind: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { kind: 'tool-result'; callId: string; result: unknown }
```

These are architectural shapes; exact runtime schemas and IDs are implemented with the persistence layer.

## Continuity metadata

Store the latest provider interaction ID and safe stream-cursor metadata needed for continuation/recovery. Do not persist entire raw SDK interaction payloads as an opaque blob. `previous_interaction_id` remains a provider field derived from local continuity metadata.

## Tool calling

Tool call/result parts are first-class records so future function calling can be rendered, audited, and persisted without changing the message model. Tool declarations themselves live in a separate curated tool registry.

Google Workspace tool calls use the same representation and are distinguishable by tool metadata, not by a separate conversation schema.

## Character and memory separation

The character master system prompt is request configuration, not a conversation message. Future retrieved memory notes are a separate context domain, not automatically persisted into every message. This prevents persona, memory, and chat history from becoming one monolithic record.

## Ordering and recovery

Message sequence is explicit and monotonically ordered within a conversation. A user message can exist before its assistant response is complete, allowing recovery after a crash or network failure. Failed/cancelled assistant messages remain representable rather than disappearing.

## Privacy

Credentials, tokens, authorization codes, raw headers, and diagnostic secrets are never message parts. Analytics identifiers are not stored as conversational content.
