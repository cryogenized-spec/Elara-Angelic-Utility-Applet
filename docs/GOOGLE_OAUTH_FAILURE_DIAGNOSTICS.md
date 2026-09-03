# Google OAuth Failure Diagnostics

Prompt 48 makes Google authorization failures explicit, structured, and actionable.

## Failure classes

The OAuth boundary distinguishes user denial, invalid or revoked grants, interaction-required authorization, invalid client configuration, temporary provider unavailability, network failure, and unknown failures.

The UI receives a safe classification with retryability and whether user action is required. Raw authorization responses, tokens, authorization headers, and provider payloads never become user-facing diagnostic content.

## Recovery rules

- `access_denied`: respect the denial; do not loop or silently retry.
- `invalid_grant`: transition the affected capability to reauthorization-required/token-recovery failure as appropriate.
- `interaction_required`: request explicit user interaction before attempting the affected operation again.
- `temporarily_unavailable`: permit bounded retry through the request lifecycle.
- configuration errors: surface a configuration diagnostic rather than repeatedly prompting the user.

Google documents that refresh tokens can be invalidated and that denied scopes must disable related functionality until the user explicitly chooses to authorize again. Incremental authorization should be contextual rather than coercive. citeturn383674search6

## Privacy

Diagnostics contain categories, safe status information, correlation identifiers, and timing where available. They do not store OAuth tokens, codes, client secrets, message content, or complete provider responses.

## Ownership

OAuth owns classification of authorization failures. The request lifecycle owns retry behavior. UI renders the resulting state. No generic global error manager is introduced.
