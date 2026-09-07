# Pass 2 — Direct Google Identity Services Authority

## Status

**Implemented in the static GitHub Pages architecture.**

Pass 2 replaces the retired Cloudflare Worker OAuth transport with a browser-native Google Identity Services token authority. The existing capability contracts, centralized scope registry, focused Workspace adapters, and confirmation boundary remain unchanged.

## What changed

- added `src/google/oauth/gis.ts` as the narrow Google Identity Services integration boundary;
- replaced `src/google/oauth/authority.ts` so Google authorization no longer depends on the retired Worker;
- kept Google access tokens in memory only;
- persisted only non-secret authorization metadata in `localStorage`;
- preserved incremental capability authorization through the existing scope registry;
- added silent token reacquisition with `prompt: "none"` after app reload or token expiry;
- added explicit `reauthorization-required` state when silent recovery fails;
- added a Google API host allow-list before credentialed requests leave the application;
- retry a 401 once after silent token reacquisition, including preserving request bodies;
- retained provider revocation through Google Identity Services when an active token is available;
- updated the Google Workspace Settings screen to describe the direct authorization flow and local secret-handling boundary;
- added `.env.example` for the public Google Web OAuth client ID;
- added deterministic authority tests covering capability scopes, token non-persistence, request authorization, 401 recovery, request-body preservation, target validation, and disconnect.

## Authorization lifecycle

The user starts authorization from Settings or from a tool capability that requires access.

For a capability that has never been granted locally, Elara opens the Google authorization UI through the GIS token client with the capability's exact provider scope and `include_granted_scopes: true`.

The resulting short-lived access token exists only in browser memory. It is never written to IndexedDB, ordinary application persistence, model context, tool arguments, or diagnostics.

The application stores only the fact that a capability was previously granted, plus optional non-secret account metadata. On a later app load, the stored capability metadata allows Elara to attempt a silent `prompt: "none"` token request instead of forcing a consent screen. Google decides whether that silent request can succeed; if it cannot, Elara surfaces `reauthorization-required` rather than pretending the connection is still usable.

## Deliberate deployment trade-off

The repository is deployed as a static Vite application on GitHub Pages. This pass therefore uses the browser token model rather than introducing another server just to hold refresh tokens.

Google also documents a modern authorization-code model for web applications where a backend exchanges the code and stores refresh credentials. That architecture is appropriate when Elara needs durable server-side/offline execution while the user is absent. It is intentionally **not** introduced here because this pass is removing the Worker OAuth authority and keeping the current deployment static.

This means Pass 2 provides:

- direct in-app Google authorization;
- incremental permissions;
- authorization persistence at the provider level;
- silent re-acquisition while Google still permits it;
- no browser-held refresh token;
- no OAuth Worker dependency.

It does **not** yet provide browser-independent background Google execution while the app is closed. That requires a secure server-side authorization authority and belongs to a later infrastructure pass.

## Security boundary

Google Web OAuth client IDs are identifiers, not client secrets, and are appropriate for browser applications. The application still treats the access token itself as secret runtime material and keeps it transient.

The service adapters continue to request a capability-bound fetcher from the single application OAuth authority. They do not construct their own OAuth clients or manage provider scopes.

The authority only permits credentialed traffic to approved Google API hosts over HTTPS. Provider-specific request shaping remains inside the existing Calendar, Tasks, Gmail, Drive, Docs, and Sheets adapters.

## Testing

`src/google/oauth/authority.test.ts` covers the principal lifecycle without contacting Google.

The repository CI gate remains the final authority for lint, typecheck, unit tests, build, E2E, and reliability checks.

## Production configuration

Set the public Vite variable:

`VITE_GOOGLE_CLIENT_ID=<Google Web application OAuth client ID>`

In Google Cloud, configure the OAuth client as a **Web application** and add the deployed GitHub Pages origin under **Authorized JavaScript origins**. A client secret is not used by this browser-side Web application flow.

The production Google consent/brand configuration must still comply with Google's current OAuth policy and any verification requirements triggered by the final scopes. Gmail and other restricted/sensitive scopes must not be treated as production-ready merely because the browser flow itself works.

## Next pass

Pass 3 should audit the exact provider methods used by each Google capability, remove any provisional scope mappings, and verify that every requested permission is both necessary and the narrowest practical scope.
