# Retry Policy

Prompt 33 defines how transient failures are retried without duplicating user actions, tool calls, or streamed assistant output.

## Principles

Retries are owned by the request lifecycle/application boundary, never by the UI and never by an arbitrary provider helper.

A retry is allowed only when the failure is classified as retryable. Expected non-retryable cases remain visible immediately.

A retry must be idempotent from the application's point of view. The application must not append a second user message merely because a provider attempt is repeated.

## Retry classes

Retryable candidates include transient network failures, gateway failures, selected 408/429/500/502/503/504 responses, and provider conditions explicitly documented as transient.

Do not automatically retry authorization failures, malformed requests, unsupported models/settings, validation failures, policy denials, user cancellations, or other deterministic 4xx conditions.

## Backoff

Use bounded exponential backoff with jitter. The retry budget is small and finite. A retry loop must terminate with an explicit failure state and diagnostic metadata.

The initial implementation should prefer a conservative maximum of two automatic re-attempts for a single request. User-initiated retry is a separate action and starts a new lifecycle with retained diagnostic linkage.

## Streaming

Once assistant output has been emitted, the application must not blindly replay a partial stream into the same persisted assistant message. Streaming checkpoints and provider continuation identifiers must determine whether continuation is possible; otherwise the lifecycle terminates safely and exposes a retry action.

Cancellation always wins over retry scheduling.

## Diagnostics

Every retry records attempt number, reason class, delay, elapsed time, and final outcome. Logs must never contain API keys, OAuth tokens, message contents, or raw authorization headers.

## Testing contract

Tests must cover retryable versus non-retryable classifications, bounded attempts, jitter/backoff calculation, cancellation during backoff, duplicate-message prevention, and final diagnostic state.