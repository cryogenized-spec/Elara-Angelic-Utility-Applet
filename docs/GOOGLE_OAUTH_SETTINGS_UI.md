# Google OAuth Settings UI

Prompt 41 defines the user-facing settings surface for the single Google OAuth authority.

## Responsibilities

The settings UI presents connection status, authorized account metadata, available Workspace capabilities, missing scopes, reauthorization state, and an explicit disconnect action.

It does not own OAuth redirects, token parsing, refresh logic, client secrets, or scope strings. It calls application-facing OAuth commands and renders their normalized state.

## Capability presentation

Each Workspace capability is presented independently. A user may see Calendar available while Tasks, Docs, or Chat remains unavailable. Missing capabilities offer contextual authorization rather than a blanket "connect everything" action.

## Stay connected control

The control describes the application's token-recovery preference. Enabling it permits the OAuth authority to attempt allowed non-interactive recovery. It does not expand scopes and does not guarantee perpetual access.

## Failure presentation

Expired credentials, revoked consent, denied scopes, provider outages, and configuration errors are distinct user-facing states. The UI provides a recovery action appropriate to the state and never hides authorization failures behind generic loading indicators.

## Privacy

Only non-secret account/connection metadata is rendered. Tokens, authorization codes, client secrets, raw HTTP authorization headers, and private Workspace payloads never enter React component state.
