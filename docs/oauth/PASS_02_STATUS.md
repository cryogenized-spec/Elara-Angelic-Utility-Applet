# Pass 2 — Google Identity Services Authorization-Code Boundary

## Status

Client-side authorization-code *module* implemented. The protected server-side code exchange and durable refresh-token store remain the next infrastructure step.

## Implemented

- `src/google/oauth/code-flow.ts` uses `google.accounts.oauth2.initCodeClient()`.
- Popup UX is used for in-app authorization.
- `include_granted_scopes: true` preserves incremental authorization.
- Optional OAuth state, login hint, and hosted-domain hints are supported.
- OAuth and popup failures are normalized to safe application errors.
- Deterministic unit coverage was added for successful codes and authorization errors.

## Runtime reachability (corrected 2026-09-11)

"Implemented" above means the module exists and is unit-tested. It is **not** reachable from the application:

- `src/google/oauth/code-flow.ts` is imported only by its own test file. No component, hook, or authority module imports it.
- The deployed `GoogleOAuthAuthority` still uses the GIS **token** client (`gis.ts`), so no authorization code is ever requested in a real session.
- There is no exchange endpoint anywhere in the repository to receive a code, so the module has no counterpart to call.

This pass therefore established a tested primitive, not a seam. Wiring it into the authority is the next pass, and doing so without an exchange boundary would be worse than the current state: a browser-held code with nowhere to exchange it produces a dead record, which is exactly what the deliberate boundary below exists to prevent.

## Deliberate boundary

The browser receives a temporary authorization code only. It does not exchange the code using a client secret and never stores a refresh token.

The deployed `GoogleOAuthAuthority` remains on the existing GIS token-client path until the protected exchange authority exists. This avoids inventing a second persistent credential store or turning the Gemini Worker back into an OAuth authority.

## Next

Pass 3 owns the protected exchange service, durable refresh credentials, per-capability connection state, and refresh without user presence.

Before that work starts, two document-level conflicts must be resolved rather than negotiated in code:

- This file's pass numbers do not line up with `docs/ACTIVE_IMPLEMENTATION_ROADMAP.md`'s. Here Pass 3 is the scope audit; there Pass 3 is durable connection state. One numbering authority is needed.
- `docs/GOOGLE_OAUTH_ARCHITECTURE_FREEZE.md` — the self-described authoritative contract — treats the GIS token client as the *current accepted transport* and defers a durable authority to a later separate subsystem, while the roadmap requires building it now. Both cannot direct the work; see Pass 2 of the active roadmap.
