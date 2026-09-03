# Prompt 13 — Gemini Credential Architecture

## Status

Accepted as the credential-ownership contract. Runtime secret wiring is intentionally implemented only when the package/Worker scaffold exists.

## Decision

Elara must not ship an application-owned Gemini API key in browser JavaScript. The browser sends a validated provider-neutral request to the thin Worker/security boundary; the Worker obtains the protected Gemini credential from its secret binding and performs the canonical Interactions call.

Cloudflare Workers secrets are encrypted secret bindings exposed to Worker code through `env`; sensitive values must not be stored as plaintext `vars`. Local development secrets use `.dev.vars` or `.env`, excluded from source control. citeturn957008search0turn957008search2

## Trust flow

```text
Android/PWA browser
    ↓ validated public request
thin Worker boundary
    ↓ protected secret binding
@google/genai
    ↓
Gemini Interactions API
```

The browser never receives the application-owned Gemini credential as configuration, response data, diagnostic data, analytics, persisted conversation state, or source code.

## Ownership

`security/` owns secret classification and the minimum capability needed to access protected configuration.

`worker/` owns server-side request mediation and credential attachment.

`gemini/` owns Gemini SDK translation and Interactions execution but does not decide where secrets are stored.

`chat/` never sees the raw API key.

## Request rules

The browser request contains only product-approved request data: model identity, validated input parts, capability-gated generation settings, continuity metadata where applicable, approved tool declarations, and safe request metadata.

The Worker validates the incoming envelope again. Client-side validation is not a trust boundary.

The Worker attaches the credential internally and forwards only the provider request required for the current operation.

The Worker must not echo authorization headers or secret values back to the browser.

## Local development

Use `.dev.vars` or an equivalent local secret file according to the current Wrangler guidance. Never add Gemini keys to `wrangler.toml`, committed `.env` files, React environment variables, or Vite-exposed `import.meta.env` values.

The repository must include ignore rules for `.dev.vars*` and local secret files once the Worker scaffold is introduced.

## Rotation and environments

Development, staging, and production secret bindings are separate configuration concerns. Rotating the secret must not require rebuilding the browser application or changing conversation data.

No credential value belongs in git history. A leaked credential is treated as a security incident, not a configuration bug.

## Future Google OAuth

Google OAuth credentials and access tokens follow the same ownership principle but remain a separate authorization authority from Gemini. Workspace services receive minimum authenticated capabilities; they do not gain access to the Gemini secret or generic secret access.

## Future tool calling

Gemini-visible tool schemas describe allowed capabilities but never include credentials. A tool execution request is validated against the curated tool registry and routed to its owning service. Tool services must obtain authentication through their own approved boundary.

Google Workspace tools therefore cannot call arbitrary endpoints, inspect Worker secrets, or bypass scope and confirmation rules.

## Testing requirements

When implemented, tests must prove that:

- application-owned Gemini credentials are not present in built browser assets;
- public client configuration contains no secret value;
- Worker request validation rejects malformed provider requests;
- secret bindings are read only inside the protected Worker path;
- diagnostic payloads exclude secret-bearing headers and values;
- tool schemas contain no credentials.

## Explicit non-goals

This prompt does not introduce a generic vault abstraction, a client-side secret store, a second Gemini client, or a second server runtime. It also does not implement OAuth token storage.

## Prompt 13 completion criterion

Credential ownership is unambiguous: browser code never owns the application Gemini secret; the Worker/security boundary does. The eventual runtime implementation can therefore be built without revisiting the trust model.
