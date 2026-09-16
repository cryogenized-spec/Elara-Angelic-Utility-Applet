# Elara Angelic Utility Applet

Elara is a mobile-first React/Vite AI companion and utility application built around Google's Gemini Interactions API. Android portrait is the primary UI target. The application combines persistent conversations, configurable character/roleplay behavior, durable memory retrieval, attachments and local document tools, Google Workspace capabilities, YouTube search/handoff, voice-to-text, and an optional self-hosted cloud autonomy runtime.

Elara is free self-hosted shareware. A user may fork/deploy their own static PWA, bring their own provider credentials and optionally deploy their own Cloudflare Worker. There is no shared Elara account, central OAuth broker or centrally held user credential.

This README is intentionally an entry point, not a project diary. Current technical truth lives in the system documentation under [`/documents`](./documents/INDEX.md); implementation history lives in Git.

## Architecture at a glance

Normal interactive chat runs in the browser through `src/gemini/provider.ts` using `@google/genai`. The Gemini API credential is recovered from the application's local Lockbox.

Google Workspace authorization has two supported self-hosted modes. Without a paired Worker, authorization uses browser-side Google Identity Services and is interactive-only. With the user's own paired Worker, GIS popup authorization-code flow exchanges through that Worker into an encrypted `GoogleOAuthVault`; refresh tokens stay in the Worker and the browser receives only short-lived access tokens. The Worker remains a separate execution plane and is not the normal interactive-chat provider.

The React application is composed from `src/main.tsx` and `src/app/App.tsx`. Domain systems own their contracts, and persistence is authoritative per domain rather than duplicated across UI/provider layers.

For the code-verified map, read [`documents/architecture.md`](./documents/architecture.md).

## Documentation

Agents should start with [`documents/manifest.json`](./documents/manifest.json), which routes source paths and keywords to stable system IDs and canonical documents. [`documents/INDEX.md`](./documents/INDEX.md) is the human navigation/index and defines the documentation format and maintenance rules. [`AGENTS.md`](./AGENTS.md) is the short operational contract for coding agents.

Canonical technical documentation lives under `/documents`. Historical pass/status/roadmap material was retired after current facts were consolidated; use Git history when implementation chronology is genuinely needed. Do not create a second documentation root. `npm run docs:check` validates the manifest, canonical tree, routed source paths, local documentation links and legacy-documentation exclusions.

## Local development

Requires Node.js 24 or newer.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Create your own Google Web OAuth client if Google Workspace integration is required and set its public client ID as `VITE_GOOGLE_CLIENT_ID`. The authorized JavaScript origin must match the origin from which your PWA runs. Google OAuth client IDs are public browser configuration, not secrets.

Do not put the Gemini API key in a `VITE_*` environment variable. Configure it through the application's Lockbox UI. The normal browser provider reads it from the Lockbox at runtime.

Local PDF generation uses BusyTeX assets. Prepare them only when working on that feature:

```sh
npm run busytex:prepare
```

The runtime asset policy for that compiler is documented locally in [`public/core/README.md`](./public/core/README.md).

## Optional self-hosted Worker

The Worker is optional for ordinary browser chat and interactive-only Google authorization. It is required for durable Google refresh authorization, cloud autonomy and later unattended/orchestrated Workspace execution.

Each deployment owner configures their own Worker. At minimum, replace `ALLOWED_ORIGINS` in `worker/wrangler.toml` with the exact origin of your hosted PWA. For durable Google OAuth, configure the same Web OAuth client ID used by `VITE_GOOGLE_CLIENT_ID`, then provision the secret material on your own Worker:

```text
GOOGLE_OAUTH_CLIENT_ID     same public client id as VITE_GOOGLE_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET Google Web OAuth client secret
GOOGLE_OAUTH_VAULT_KEY     high-entropy private vault key, at least 32 characters
ELARA_INSTALLATION_TOKEN   private installation credential used for pairing/admission
```

Use Wrangler secret management for secret values; do not commit them to the repository. The browser pairing flow stores the installation credential in its protected device-local credential store rather than pairing JSON/localStorage.

The Pages origin and Worker configuration are per deployment. A fork must not reuse another person's OAuth client secret, installation token, vault key or Worker origin allowlist.

## Verification

Use focused checks while iterating. Before repository work is called complete, run the broad gate in this order:

```sh
npm run docs:check
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
npx playwright test --project=chromium --project=android-portrait --project=onboarding
npm run reliability:check
```

CI is the release authority. If the current environment cannot execute Playwright, report that limitation explicitly rather than treating discovery or static inspection as browser execution. Additional focused verification includes `npm run verify:artifact-assets`, `npm run verify:worker` and `npm run typecheck:e2e`.

## Core invariants

One canonical Gemini execution path: interactive chat uses the browser Interactions provider; do not add a legacy `generateContent` fallback or a competing chat provider. Model settings must remain capability-driven. UI components do not own raw provider requests, OAuth mechanics, credentials or database implementation. External data is validated at trust boundaries. Provider/network failures become explicit states rather than endless loading. Each domain has one authoritative state owner even when the application uses more than one physical IndexedDB/Dexie database.

Credentials stay behind their owning security boundary. Tool schemas never contain secrets. Google Workspace operations pass through the centralized capability/OAuth boundary and consequential mutations use the shared confirmation policy. A durable Google grant is credential availability, not autonomous permission. Cloud/autonomy execution must not silently redefine the normal browser-chat architecture.

Documentation follows [`AGENTS.md`](./AGENTS.md): durable current facts belong in the owning `/documents/<system>.md`; chronology belongs in Git. Direct `main` writes are allowed when no concurrent workstream depends on a stable base. During concurrent agent/PR work, use a short-lived branch and do not move, close or rewrite another workstream. Stale or superseded pull requests should not be left open.

## Deployment

The web application is static Vite output deployed to the host chosen by the user; this repository uses GitHub Pages through GitHub Actions:

```text
main -> CI/build -> dist/ -> GitHub Pages
```

The optional Cloudflare Worker is a separate self-hosted boundary with its own configuration, Durable Objects and secrets. Pairing the PWA to that Worker enables durable Google authorization and cloud features without turning the Worker into the normal browser Gemini provider.

## License and third-party assets

Review [`documents/third-party-notices.md`](./documents/third-party-notices.md), the exact lockfile and bundled upstream notices before redistributing generated bundles or runtime assets.
