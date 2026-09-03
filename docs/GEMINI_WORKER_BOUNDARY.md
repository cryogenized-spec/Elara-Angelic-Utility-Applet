# Gemini Worker Boundary

Status: implemented as the protected execution boundary; deployment configuration remains environment-specific.

## Runtime topology

```text
Android/PWA browser
      ↓
provider-neutral JSON request
      ↓
Cloudflare Worker /api/gemini
      ↓
@google/genai
      ↓
Gemini Interactions API
      ↓
allow-listed normalized SSE events
      ↓
browser chat orchestration
```

The browser no longer owns or sends an application Gemini API key. The browser transport in `src/gemini/provider.ts` sends only the provider-neutral turn contract to the Worker. The Worker is the sole runtime holder of the Gemini credential and the sole place that imports and executes `@google/genai`.

Google recommends keeping Gemini API keys out of production client-side code and using a backend proxy. The Interactions API is the canonical Gemini interface for this application and supports streaming via SSE. citeturn277597search7turn277597search1

## Worker security boundary

`worker/src/index.ts` validates:

- HTTP method and route;
- request content type;
- model/input/request-shape constraints;
- optional previous interaction identifier;
- capability-filtered generation settings;
- configured request origin.

The Worker reads `GEMINI_API_KEY` from a Cloudflare secret binding. It does not return the secret and does not forward arbitrary request fields to Gemini. Its SSE output is an explicit allow-list of interaction lifecycle, text/thought-summary/signature, step lifecycle, completion, and safe error information.

Cloudflare documents Worker secrets as encrypted bindings, recommends secrets rather than plaintext `vars` for sensitive values, and supports declaring required secrets in Wrangler configuration. citeturn277597search2turn277597search0

## Local development

Copy `worker/.dev.vars.example` to `worker/.dev.vars` and set the Gemini credential locally. Start the Worker with `npm run worker:dev`. Start the Vite application separately and configure `VITE_GEMINI_WORKER_URL` to the local Worker URL when it is not available at `/api/gemini`.

Do not commit `worker/.dev.vars` or any other secret-bearing environment file.

## Deployment

The Worker is configured by `worker/wrangler.toml` with a required `GEMINI_API_KEY` secret. Before the first deployment, set the secret through Wrangler or the Cloudflare dashboard and configure `ALLOWED_ORIGINS` to the exact production web origin. Cloudflare documents `wrangler secret put` for creating/updating deployed Worker secrets. citeturn277597search2turn277597search12

The GitHub Pages frontend is built with the non-secret `VITE_GEMINI_WORKER_URL` value supplied from the GitHub Actions repository configuration variable `GEMINI_WORKER_URL`. The Pages workflow refuses to publish a production build when that variable is missing or is not HTTPS. GitHub configuration variables are intended for non-sensitive reusable build configuration; secrets are reserved for sensitive values. citeturn389144search0turn389144search1

The production browser origin is the GitHub Pages site origin, while the Worker URL is the separately deployed `https://*.workers.dev` endpoint (or a future HTTPS custom domain). The Worker allowlist and the Pages build variable are intentionally separate: `ALLOWED_ORIGINS` protects inbound browser requests, while `GEMINI_WORKER_URL` tells the static frontend where to send them.

## Explicit non-goals

The Worker must not become a generic passthrough or proxy for arbitrary Google APIs. Google Workspace services remain behind their own typed capability/OAuth/confirmation boundaries.

The old browser Gemini Lockbox path has been removed from runtime code. Historical Lockbox documentation remains in the repository as an architectural record and must be treated as superseded by this boundary.
