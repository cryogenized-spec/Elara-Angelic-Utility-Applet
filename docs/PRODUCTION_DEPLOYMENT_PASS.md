# Production deployment pass

## Scope

This pass moves the executable clean-room slice from a locally correct Worker integration toward a reproducible production deployment boundary.

## CI correction

The Android portrait reliability suite now emulates reduced motion explicitly and treats browser-generated transition durations at or below 1ms as effectively disabled. Chromium can report `1e-06s` for a transition whose CSS declaration is `transition: none`; the test therefore validates the semantic bound rather than assuming a literal serialized `0s`.

## Pages configuration

The GitHub Pages build now requires the repository configuration variable `GEMINI_WORKER_URL`. That public value is injected as `VITE_GEMINI_WORKER_URL` during the production build. The workflow rejects missing or non-HTTPS values before building the Pages artifact.

This prevents the production static app from silently falling back to `/api/gemini` when the Gemini Worker is deployed at a separate HTTPS endpoint.

The Pages workflow also follows the current documented major releases of the GitHub Pages actions used by the project: checkout, configure-pages, upload-pages-artifact, and deploy-pages.

## Worker verification

`worker/src/index.test.ts` now covers the protected Worker boundary without making live Gemini calls. It verifies missing-credential rejection, origin authorization, request validation, safe allow-listed SSE output, credential non-disclosure, canonical streaming/store settings, and CORS preflight handling.

The Worker remains the sole holder of `GEMINI_API_KEY` and the sole runtime importer of `@google/genai`. The client sends only the approved provider-neutral contract.

## Remaining environment step

The production deployment requires one public GitHub repository configuration variable:

`GEMINI_WORKER_URL=https://<deployed-worker-host>`

The Cloudflare Worker separately requires:

`GEMINI_API_KEY` as a secret binding

`ALLOWED_ORIGINS=https://cryogenized-spec.github.io` as its allowlist variable

No Gemini credential belongs in the Pages workflow, Vite configuration, or repository source.
