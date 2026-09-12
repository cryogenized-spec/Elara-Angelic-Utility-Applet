# Elara Angelic Utility Applet

Elara is a mobile-first React/Vite AI companion and utility application built around Google's Gemini Interactions API. Android portrait is the primary UI target. The application combines persistent conversations, configurable character/roleplay behavior, durable memory retrieval, attachments and local document tools, Google Workspace capabilities, YouTube search/handoff, voice-to-text, and an optional cloud autonomy runtime.

This README is intentionally an entry point, not a project diary. Current technical truth lives in the system documentation under [`/documents`](./documents/INDEX.md); implementation history lives in Git.

## Architecture at a glance

Normal interactive chat runs in the browser through `src/gemini/provider.ts` using `@google/genai`. The Gemini API credential is recovered from the application's local Lockbox. Google Workspace authorization is a separate browser-side GIS authority under `src/google/oauth/`. The Cloudflare Worker is a separate execution plane used for cloud/autonomy capabilities rather than the normal interactive-chat provider.

The React application is composed from `src/main.tsx` and `src/app/App.tsx`. Domain systems own their contracts, and persistence is authoritative per domain rather than being duplicated across UI/provider layers.

For the code-verified map, read [`documents/architecture.md`](./documents/architecture.md).

## Documentation

Agents should start with [`documents/manifest.json`](./documents/manifest.json), which routes source paths and keywords to stable system IDs and canonical documents. [`documents/INDEX.md`](./documents/INDEX.md) is the human navigation/index and defines the documentation format and maintenance rules. [`AGENTS.md`](./AGENTS.md) is the short operational contract for coding agents.

Canonical technical documentation lives under `/documents`. Historical pass/status/roadmap material was retired after current facts were consolidated; use Git history when implementation chronology is genuinely needed. Do not create a second documentation root.

## Local development

Requires Node.js 24 or newer.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set `VITE_GOOGLE_CLIENT_ID` in `.env.local` if Google Workspace integration is required. Google OAuth client IDs are public browser configuration, not secrets.

Do not put the Gemini API key in a `VITE_*` environment variable. Configure it through the application's Lockbox UI. The normal browser provider reads it from the Lockbox at runtime.

Local PDF generation uses BusyTeX assets. Prepare them only when working on that feature:

```sh
npm run busytex:prepare
```

The runtime asset policy for that compiler is documented locally in [`public/core/README.md`](./public/core/README.md).

## Verification

Use focused checks while iterating. Before repository work is called complete, run the broad gate in this order:

```sh
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
npx playwright test --project=chromium --project=android-portrait --project=onboarding
npm run reliability:check
```

CI is the release authority. If the current environment cannot execute Playwright, report that limitation explicitly rather than treating discovery or static inspection as browser execution. Additional focused verification includes `npm run verify:artifact-assets` and `npm run verify:worker`.

## Core invariants

One canonical Gemini execution path: interactive chat uses the browser Interactions provider; do not add a legacy `generateContent` fallback or a competing chat provider. Model settings must remain capability-driven. UI components do not own raw provider requests, OAuth mechanics, credentials or database implementation. External data is validated at trust boundaries. Provider/network failures become explicit states rather than endless loading. Each domain has one authoritative state owner even when the application uses more than one physical IndexedDB/Dexie database.

Credentials stay behind their owning security boundary. Tool schemas never contain secrets. Google Workspace operations pass through the centralized capability/OAuth boundary and consequential mutations use the shared confirmation policy. Cloud/autonomy execution must not silently redefine the normal browser-chat architecture.

Documentation follows [`AGENTS.md`](./AGENTS.md): durable current facts belong in the owning `/documents/<system>.md`; chronology belongs in Git. Direct `main` writes are allowed when no concurrent workstream depends on a stable base. During concurrent agent/PR work, use a short-lived branch and do not move, close or rewrite another workstream. Stale or superseded pull requests should not be left open.

## Deployment

The web application is built as static Vite output and deployed to GitHub Pages through GitHub Actions:

```text
main -> CI/build -> dist/ -> GitHub Pages
```

Worker/autonomy deployment is a separate Cloudflare boundary with its own configuration and secrets. Do not treat the Worker as a substitute for the browser application's Gemini or Google OAuth authorities.

## License and third-party assets

Review [`documents/third-party-notices.md`](./documents/third-party-notices.md), the exact lockfile and bundled upstream notices before redistributing generated bundles or runtime assets.
