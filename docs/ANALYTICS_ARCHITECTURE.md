# Analytics Architecture

Prompt 35 defines privacy-conscious product analytics separately from diagnostics.

## Purpose

Analytics measures product behavior and reliability trends at an aggregate level. Diagnostics explains individual request failures and is developer-facing. They must not share an unrestricted event store.

## Data minimization

No message text, attachment contents, tool arguments, OAuth tokens, API keys, authorization headers, raw model responses, or hidden reasoning are analytics data.

Events use stable anonymous installation/session identifiers only where necessary and should avoid collecting identifiers that can directly identify the user.

## Event taxonomy

The initial taxonomy covers:

- app lifecycle: launch, resume, install/update marker
- chat UX: composer opened, message submitted, response completed, response cancelled
- attachments: selected, accepted, rejected, removed, upload lifecycle outcome
- voice: started, completed, cancelled, denied, unsupported
- appearance: theme/background/portrait preference changed
- provider outcome: request success/failure class, latency bucket, retry count
- Workspace later: authorization state transition and capability usage class, never document/event content

## Storage and ownership

The analytics module owns event definitions, validation, aggregation policy, and export/flush behavior. Conversation persistence remains the authority for chat data. Diagnostics remains the authority for request-level technical records.

Analytics may use a dedicated local queue when offline, but it must not become a shadow conversation database or diagnostic log.

## Retention and flushing

Events should be bounded, batched, and discardable. Product analytics must never block chat operation. A failed analytics flush must not make a chat request fail.

## Consent/privacy controls

The application should support a clear analytics preference and a default that does not require message-content telemetry. Changes to the analytics preference affect future collection and flushing without deleting ordinary conversation data.

## Testing contract

Tests cover event schema validation, redaction, bounded queue behavior, preference changes, offline/online flush behavior, and strict separation from message and diagnostic payloads.