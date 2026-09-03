# Production Gemini Worker Boundary Verification

This pass makes the production frontend-to-Worker wiring a CI-enforced deployment invariant.

## Checks

`npm run verify:worker` performs a non-generative verification against the configured public Worker endpoint:

1. `GET /health` must return HTTP 200 with `api: true` and `status: healthy`.
2. The health response must authorize the GitHub Pages production origin through `Access-Control-Allow-Origin`.
3. A browser-style `OPTIONS` preflight for `POST` with `Content-Type` must succeed and advertise `POST` as an allowed method.

No Gemini model request is made by these checks, so deployment verification does not consume model quota merely to prove that the boundary is reachable and CORS-compatible.

## Deployment contract

The Pages workflow uses the same `GEMINI_WORKER_URL` value for the Vite production build and the verification script. The configured repository variable remains preferred; the deployed Worker URL is the controlled fallback so a missing repository variable cannot silently send production chat traffic back to `/api/gemini`.

The Worker health endpoint remains a safe diagnostic surface. It never returns the Gemini API key, request bodies, system instructions, conversation content, OAuth tokens, or raw provider credentials.

## Failure behavior

A mismatch is a hard deployment-build failure. Pages is not published when the Worker is unreachable, reports a degraded health state, or rejects the production CORS contract.
