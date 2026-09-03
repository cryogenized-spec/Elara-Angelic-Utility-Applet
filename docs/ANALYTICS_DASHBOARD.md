# Analytics Dashboard

Prompt 36 defines a small, developer-oriented analytics surface for aggregate product health. It is not a chat transcript viewer and not the HTTP diagnostic console.

## Dashboard purpose

Show bounded aggregate measures that help evaluate the app without exposing user content.

The initial dashboard model includes:

- sessions/launches over a selected period
- messages submitted and completed responses
- cancellation rate
- retry rate
- provider success/failure counts by safe class
- latency buckets
- attachment acceptance/rejection counts
- voice capability outcomes
- current analytics-consent state

## Privacy boundary

The dashboard consumes already-sanitized analytics aggregates. It must not query conversation records, raw diagnostic payloads, OAuth tokens, tool arguments, message bodies, or attachment contents.

## Presentation

The surface is secondary to chat and should not become part of the critical request path. It may be hidden entirely outside developer/debug mode. The dashboard should remain usable on Android portrait but may take advantage of wider desktop layouts.

## Failure behavior

If analytics storage is empty, disabled, or unavailable, show an explicit empty/unavailable state. Analytics failure must never block the main chat surface.

## Data contract

Dashboard cards consume typed aggregate snapshots. Event collection and dashboard presentation remain separate modules so the UI cannot directly mutate the event queue.

## Testing contract

Tests verify that the dashboard renders only approved aggregate fields, handles empty data, respects analytics preference, and cannot access message-content or diagnostic stores.