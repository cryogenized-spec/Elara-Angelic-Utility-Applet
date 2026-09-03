# Lockbox — Cloudflare Worker health

## Purpose

The API Lockbox is the Settings security surface for protected configuration state. The first concrete runtime check is the Cloudflare Gemini Worker that owns the application Gemini credential.

## Health endpoint

The Worker exposes `GET /health` as a lightweight, non-generative health check. It never returns the Gemini API key, OAuth material, prompt content, or conversation data.

The response reports only safe state:

- service identity
- `status`: `healthy` or `degraded`
- whether the protected Gemini credential is configured
- whether an origin policy is configured
- `api: true` to identify the expected API service

A healthy response means the Worker is reachable and both required protected configuration conditions are present. A degraded response means the Worker is reachable but configuration is incomplete. Browser transport errors, unexpected HTTP responses, and timeouts are presented as offline/failure by the UI.

## UI states

The Lockbox displays four user-facing states:

- neutral: not checked
- checking: test in progress
- green: **Healthy**
- yellow: **Alert**
- red: **Failure / offline**

The browser health check does not invoke Gemini and therefore does not consume a model request simply to establish Worker liveness.

## Security boundary

The health panel is presentational. It receives only the public Worker URL and safe health response fields. It does not access secrets directly and does not create a general-purpose secret API. The production Gemini credential remains solely in the Worker environment.

## Testing

Worker unit tests cover healthy and degraded response contracts, CORS behavior, credential non-disclosure, and the existing Gemini request boundary. The Android portrait Playwright suite verifies that Settings can reach the Lockbox surface and expose the Worker test control without breaking navigation or the surrounding mobile layout.
