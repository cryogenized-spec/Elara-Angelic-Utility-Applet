# Elara Angelic Utility Applet — Architecture Decision Record

Status: Accepted for the clean-room rebuild
Prompt: 3 — Technical architecture
Date: 2026-09-03

## Decision

Elara will use a deliberately small browser-first architecture with a thin server boundary:

- Frontend: React 19 + TypeScript 7 + Vite 8.
- Styling: Tailwind CSS 4.
- Client persistence: Dexie over IndexedDB.
- External-boundary validation: Zod.
- Unit/integration tests: Vitest.
- Browser/end-to-end tests: Playwright.
- Gemini SDK: `@google/genai`, using the Gemini Interactions API as the only Gemini execution path.
- Runtime/API boundary: Cloudflare Workers for server-side secrets, request mediation, diagnostics, and later integrations.
- PWA: standards-based browser APIs with Vite PWA tooling when the app shell is implemented.

The production Node baseline is Node.js 24 LTS, with CI configured to obtain the latest patch release for that major line. Node 26 is currently the newest major release, but it is still in Current status; Node 24 is the newest LTS line. Production workloads should use LTS releases rather than an unproven Current line.

## Why this architecture

### React + Vite

The product is a mobile-first client application rather than a server-rendered website. Vite keeps the application build model straightforward and fast, while React provides the component model needed for the chat shell, composer, settings, portrait, diagnostics, and integrations.

No Next.js application layer is introduced. Server functionality belongs behind explicit API boundaries and does not become coupled to the UI framework.

### Tailwind CSS

Tailwind remains the styling system, but it is treated as a styling tool rather than an application architecture. Layout, responsive behavior, portrait scaling, themes, safe-area handling, and Android keyboard adaptation remain in UI modules.

### Dexie / IndexedDB

Conversation and client-owned state remain local-first. Dexie is the single persistence authority over IndexedDB; individual UI components may not open independent IndexedDB databases or create parallel persistence mechanisms.

### Zod

Anything crossing a trust boundary is validated before use. This includes persisted records, provider configuration, server responses, OAuth-related data, attachment metadata, and diagnostic payloads.

### Gemini Interactions API

Gemini integration is intentionally singular. The application will expose one internal provider contract and one Gemini implementation behind it. That implementation uses `@google/genai` and the Interactions API only.

The old `generateContent` execution path is explicitly excluded. No compatibility adapter, fallback provider, or duplicate Gemini client may be added merely to support older code patterns.

Google's current documentation states that the Interactions API is the recommended/default interface for new Gemini projects and that new model, multimodal, tool, and agentic capabilities are being launched there. The current SDK supports the Interactions API, including JavaScript/TypeScript usage.

### Cloudflare Workers

A Worker is the smallest appropriate server boundary for secrets and API mediation. It avoids introducing Express or another full server framework before the product needs one.

The Worker is responsible for server-side concerns such as protected Gemini credentials, request policy, normalized provider diagnostics, and later OAuth/integration boundaries. It must not become a monolithic application server.

Durable/background execution is deliberately postponed until the chat path is stable. Gemini's native Interactions background execution will be evaluated first. Cloudflare Workflows is not added until a concrete requirement remains that Gemini-native background execution cannot satisfy.

## Module ownership

Each major responsibility gets one owner:

`ui/` owns rendering and interaction behavior.

`chat/` owns conversation orchestration and chat state transitions.

`gemini/` owns the canonical Gemini provider contract and translation to/from Interactions API structures.

`persistence/` owns Dexie database definitions, migrations, and repositories.

`attachments/` owns file/image metadata and ingestion policy.

`appearance/` owns themes, background settings, and portrait scaling state.

`diagnostics/` owns structured request diagnostics and user-facing debug events.

`analytics/` owns privacy-conscious product telemetry without message-content collection by default.

`google/` owns Google authorization and later service clients for Calendar, Tasks, Docs, and Chat.

`security/` owns Lockbox and secret/configuration boundaries.

`worker/` owns the server-side HTTP boundary and must not directly manipulate UI state.

These boundaries are logical ownership rules, not an excuse to create dozens of abstractions. Prefer small concrete modules over framework-heavy indirection.

## Data flow

The intended chat request flow is:

Android browser/PWA UI → chat orchestration → canonical provider contract → Worker/API boundary → `@google/genai` Interactions API → normalized stream events → chat state → Dexie persistence → UI.

UI code never stores Gemini API secrets. UI code never calls two different Gemini clients. UI code never parses raw provider-specific error formats. Diagnostics are attached to the same request lifecycle but stored without message contents or credentials.

## Gemini API version policy

The Gemini SDK/API version is a controlled dependency, not an implicit moving target. The implementation will pin the SDK version in `package-lock.json`, test the exact request/response contract that the pinned SDK exposes, and document the selected API version.

Google's current API-version documentation states that the SDK defaults to `v1beta` and that stable `v1` is explicitly configurable for the Interactions API. The implementation should prefer the stable `v1` API version unless a documented feature required by Elara is unavailable there. Any `v1beta` requirement must be explicit and tested.

## Dependency policy

Dependencies are selected from current npm releases at implementation time. We will not copy versions from the archived Elara repository.

For every dependency added to the application:

1. verify the current npm `latest` tag before installation;
2. prefer stable releases over beta/alpha/canary builds;
3. inspect package engines and peer-dependency requirements;
4. generate/update `package-lock.json` with npm;
5. run `npm ci` from the lockfile in CI;
6. run the project's lint, typecheck, tests, and production build in CI;
7. treat npm deprecation warnings as build hygiene failures to investigate, not harmless noise.

`npx` is the standard command for one-shot project tooling/scaffolding where the upstream package documents it. We will use the current package's `@latest` entry point for scaffolding rather than reviving an old CLI invocation.

## CI policy

GitHub Actions must use current stable major versions of official actions and a non-EOL Node.js line. The CI workflow will use the current `actions/checkout` and `actions/setup-node` majors and Node 24 with latest-patch resolution enabled.

As the codebase grows, CI will become a full reliability gate with at minimum:

- dependency installation from the committed lockfile;
- lint;
- TypeScript typecheck;
- unit/integration tests;
- production build;
- browser smoke/E2E coverage;
- dependency/deprecation hygiene checks;
- architecture boundary checks where cheap and useful.

A green repository means all required checks passed; a queued or partially successful workflow is not considered green.

## Rejected alternatives

Express is rejected for the initial server boundary because it would add a full Node server architecture without a demonstrated need.

Next.js is rejected because the product does not need SSR/RSC routing as its primary application model.

A second Gemini provider/client is rejected because duplicate provider paths were a known source of drift and failures in the previous architecture.

Cloudflare Workflows is postponed because native Gemini background execution exists and should be the first mechanism evaluated for long-running Gemini tasks.

Large state-management frameworks are postponed; local persistence and focused chat state are sufficient until a concrete need is demonstrated.

## Current-source verification used for this decision

The current Node.js release page lists Node 26 as Current, Node 24 as LTS, and Node 25 as EOL. This makes Node 24 the appropriate production baseline for the rebuild.

Current npm records checked during this prompt include React 19.2.8, TypeScript 7.0.2, `@google/genai` 2.19.0, Dexie 4.4.5, Zod 4.5.4, Vitest 4.1.10, Playwright 1.62.1, Tailwind CSS 4.3.3, and Vite 8.2.2. These checks are used as implementation-time verification; the lockfile will become authoritative once dependencies are scaffolded.

Sources:

- Node.js release status: https://nodejs.org/en/about/previous-releases
- React npm: https://www.npmjs.com/package/react
- TypeScript npm: https://www.npmjs.com/package/typescript
- `@google/genai` npm: https://www.npmjs.com/package/@google/genai
- Dexie npm: https://www.npmjs.com/package/dexie
- Zod npm: https://www.npmjs.com/package/zod
- Vitest npm: https://www.npmjs.com/package/vitest
- Playwright npm: https://www.npmjs.com/package/playwright
- Tailwind CSS npm: https://www.npmjs.com/package/tailwindcss
- Vite npm: https://www.npmjs.com/package/vite
- Gemini Interactions overview: https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini Interactions API reference: https://ai.google.dev/api/interactions-api-v1
- Gemini API versioning: https://ai.google.dev/gemini-api/docs/api-versions
