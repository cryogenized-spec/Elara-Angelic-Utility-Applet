# Pass 2 — Google Identity Services Authorization-Code Boundary

## Status

Client-side authorization-code boundary implemented. The protected server-side code exchange and durable refresh-token store remain the next infrastructure step.

## Implemented

- `src/google/oauth/code-flow.ts` uses `google.accounts.oauth2.initCodeClient()`.
- Popup UX is used for in-app authorization.
- `include_granted_scopes: true` preserves incremental authorization.
- Optional OAuth state, login hint, and hosted-domain hints are supported.
- OAuth and popup failures are normalized to safe application errors.
- Deterministic unit coverage was added for successful codes and authorization errors.

## Deliberate boundary

The browser receives a temporary authorization code only. It does not exchange the code using a client secret and never stores a refresh token.

The deployed `GoogleOAuthAuthority` remains on the existing GIS token-client path until the protected exchange authority exists. This avoids inventing a second persistent credential store or turning the Gemini Worker back into an OAuth authority.

## Next

Pass 3 owns the protected exchange service, durable refresh credentials, per-capability connection state, and refresh without user presence.
