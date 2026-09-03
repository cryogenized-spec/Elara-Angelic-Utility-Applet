# Google OAuth Architecture

Prompt 37 establishes one OAuth authority for all planned Google Workspace capabilities.

## Scope

The authority is shared by Calendar, Tasks, Docs, and Chat. Individual feature modules do not create their own OAuth clients, consent stores, token refresh systems, or scope registries.

## Flow

For the eventual web application, use Google's authorization-code based server-side boundary so protected token material is not owned by the React application. The browser initiates a contextual authorization request; the protected boundary validates state, exchanges the code, stores protected credentials, and exposes only the minimum capability state needed by the client.

## Central responsibilities

The OAuth authority owns:

- client configuration references
- secure authorization initiation
- state/redirect validation
- authorization-code exchange
- protected token storage/refresh
- revocation and disconnect handling
- granted-scope inventory
- token-expiry versus revoked-consent classification
- safe authorization diagnostics

Workspace modules own API-specific requests only after the authority reports the required scope is granted.

## Incremental authorization

Start with no Workspace scope unless a feature actually needs Google data. Request additional scopes in context, preserving previously granted scopes. A declined scope disables only the affected capability; it does not invalidate unrelated Google capabilities.

The registry should prefer the narrowest scope that can satisfy a capability. Current Google documentation explicitly recommends narrowly focused scopes and contextual incremental authorization. citeturn287044search0turn287044search3turn287044search5

## Initial planned scope families

Calendar: begin with read-only/calendar-event-specific scopes where sufficient, escalating only for user-requested writes. Google documents separate read-only and event read/write scopes. citeturn287044search0

Tasks: prefer `tasks.readonly` for read-only use and `tasks` only when creating or modifying tasks is explicitly supported. citeturn287044search2

Docs: use the narrowest Docs capability needed for the eventual feature, with no blanket Drive permission unless a feature demonstrably requires it.

Chat: scope selection must be finalized against the exact Google Chat API operations when Prompt 45 is implemented.

## Browser and redirect security

OAuth redirects and JavaScript origins must use compliant secure HTTPS origins. The deployed GitHub Pages origin and protected callback origin must be treated as explicit configuration rather than dynamically inferred from arbitrary request input. Google requires compliant secure redirect/origin handling for web OAuth. citeturn287044search3

## Failure semantics

Expired or invalid refresh tokens are not equivalent to a user intentionally disconnecting. The client must receive a structured authorization state and remediation action. A revoked grant removes the affected capability until the user explicitly reconnects.

## Privacy

Tokens never enter conversation persistence, analytics, message payloads, diagnostics, or tool schemas. OAuth logs contain safe status classifications and correlation IDs only.

## Architectural prohibition

No Workspace service may bypass this authority. There is exactly one place that knows how Elara is authorized to access Google Workspace.