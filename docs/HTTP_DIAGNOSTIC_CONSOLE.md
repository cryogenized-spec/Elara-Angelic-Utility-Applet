# HTTP Diagnostic Console

## Purpose

Define a developer-facing diagnostic stream for network/provider requests without exposing private message content or credentials.

## Captured fields

Each request record may include:

- request identifier generated at the application/Worker boundary
- interaction identifier when provided by Gemini
- operation name
- provider and model
- start/end timestamps
- elapsed duration
- HTTP status
- normalized error category/code
- retryable flag
- attempt number
- cancellation flag
- transport outcome

## Excluded data

Never record by default:

- Gemini API keys
- OAuth access/refresh tokens
- Authorization headers
- full request or response bodies
- user messages
- attachment contents
- raw tool arguments/results containing user data
- system prompts or private memory contents

## Ownership

Diagnostics owns diagnostic records. The chat layer consumes safe status information but does not implement logging. Analytics is separate and receives only privacy-approved aggregate events.

## Console behavior

The console is chronological and request-centric. It must make failures obvious, distinguish retryable/transient conditions from permanent ones, and show timing for completed or failed requests. It must not become a second application state store.

## Retrieval

Diagnostics are bounded and may be retained only according to an explicit retention policy. A diagnostic record is not conversation history and must not become memory.

## Future UI

Prompt 31 adds the in-app developer diagnostics presentation. Prompt 30 establishes the data contract first so presentation does not invent its own diagnostic model.
