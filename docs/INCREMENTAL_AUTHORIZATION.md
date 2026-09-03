# Incremental Authorization

Prompt 39 defines how Elara requests Google access only when a feature actually needs it.

## Flow

1. A feature identifies the required capability key from the central scope registry.
2. The OAuth authority checks current grant state.
3. If the scope is already granted and the token is usable, the feature proceeds.
4. If the scope is absent, the application presents contextual consent explaining the feature and requested access before redirecting to Google.
5. The callback is validated by the OAuth authority, which records the resulting grant state.
6. Only the affected capability becomes available; unrelated Workspace features remain untouched.

## Never request everything at startup

Elara must not request Calendar, Tasks, Docs, and Chat scopes merely because the integrations exist. Authorization is demand-driven and incremental.

## Denial behavior

A declined scope is an explicit user choice. The application returns the affected feature to an unavailable/not-authorized state without retry loops, coercive prompts, or broadening the requested scope.

## Scope upgrades

If a read operation later requires a write permission, Elara requests the additional write scope in context. Existing read access is retained; the application never silently substitutes a broad scope.

## Separation from character behavior

Elara may explain why a capability is useful or ask the user for permission, but the character instruction never grants itself authorization. OAuth authority remains authoritative.

Google currently recommends requesting scopes incrementally when access is required and using narrow scopes where practical. Public applications using sensitive or restricted scopes may also face verification requirements. citeturn616269search5turn616269search1turn616269search8
