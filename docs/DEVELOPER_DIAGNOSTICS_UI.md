# Developer Diagnostics UI

## Purpose

Provide an in-app developer-only surface for viewing safe request diagnostics without exposing private application data.

## Information architecture

The diagnostics view groups records by request and shows:

- state: pending, streaming, completed, failed, cancelled
- elapsed time
- provider/model
- request and interaction identifiers
- status/code/category
- retryable state
- attempt count
- transport/provider timing when available

## Security boundary

The diagnostics UI receives already-redacted diagnostic records. It does not inspect raw SDK exceptions, credentials, request bodies, system instructions, conversation content, attachment bytes, or OAuth tokens.

## Availability

Diagnostics are a developer capability, not a primary navigation destination for ordinary users. The app may gate the view behind an explicit developer/debug setting. The gate itself must not alter production request behavior.

## UX requirements

Failures must be visually unmistakable, streaming must show that progress is occurring, and cancelled requests must not remain indefinitely in a loading state. Long-running lists must be bounded or virtualized so diagnostics cannot consume the chat surface's performance budget.

## Ownership

`diagnostics/` owns diagnostic data and redaction. `ui/` owns rendering. Chat state only exposes the safe status it needs for the conversation UI.
