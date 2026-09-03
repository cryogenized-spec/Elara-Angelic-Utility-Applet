# Elara Angelic Utility Applet

This README is the durable continuity record for the clean-room rebuild of Elara. It is intended to preserve project history, non-negotiable constraints, the 50-prompt roadmap, verified implementation decisions, and handoff notes so later development iterations do not depend on human memory or chat context.

## Current project definition

Elara is a mobile-first AI companion/chat application centered on Google's current Gemini Interactions API.

The repository is a clean-room rebuild. The archived `Elara-Companion-current` repository is reference material only: use it for lessons, feature history, and proven UX ideas, but do not migrate its architecture, source layout, compatibility layers, or legacy execution paths.

The primary runtime target is Android portrait. Desktop is a secondary adaptation.

The v1 spine is deliberately small:

Android portrait UI → conversation state → one canonical Gemini Interactions provider → normalized streaming events → local persistence.

## Non-negotiable rules

1. One canonical Gemini execution path. Never add a legacy `generateContent` fallback or a second Gemini client/provider.
2. Use Google's current Gemini Interactions API through `@google/genai`.
3. Model settings are capability-driven. Never expose or send unsupported controls or fields.
4. UI code must not construct raw Gemini requests, own persistence, manage OAuth internals, or handle secrets directly.
5. Keep modules small and responsibility-focused. Do not recreate the previous application's monolithic manager/service/compatibility sprawl.
6. Android portrait comes first: composer, keyboard behavior, scrolling, safe areas, dialogs, portrait, attachments, and touch targets must work on a narrow phone viewport before desktop polish.
7. External data crossing trust boundaries must be validated.
8. Provider/network failures must become explicit diagnosable states. No endless spinner.
9. One authoritative persistence store per domain.
10. Build vertically. A later feature must not become a prerequisite for proving core chat.
11. Direct commits to `main` are the normal workflow. Do not leave pull requests open. If a PR is ever required, merge it immediately after verification.
12. CI must be green before calling a milestone complete.
13. Never silently accept deprecated Node.js, npm, package, SDK, CLI, or GitHub Action choices because an older repository used them.
14. Use `npx` for one-shot upstream CLI/scaffolding commands, using the package's current documented `@latest` entry point.
15. Never invent a lockfile. Generate `package-lock.json` from the actual dependency graph with npm and commit it.

## Future architecture requirements to preserve now

These requirements are intentionally recorded before their implementation prompts so future work cannot accidentally design them out of the foundation:

- **Tool calling:** Gemini may later receive curated function/tool declarations. Tool schemas are application-owned capabilities, not arbitrary browser-exposed functions. The model can request a tool; only a validated application service may execute it. Tool schemas, execution, OAuth, diagnostics, and write confirmation remain separate owners.
- **Google Workspace:** Calendar, Tasks, Docs, and Chat will later be exposed through the single Google OAuth authority and Google tool boundary. No Workspace service may create its own OAuth flow or bypass scope checks.
- **Character master system prompt:** The companion's durable character identity, personality, roleplay behavior, style, and behavioral rules belong in a dedicated system-instruction source. They are not user messages and are not tool schemas. The prompt builder must compose them into the provider request without turning the UI into a prompt engine.
- **Long-term notes/memory:** Notable past experiences will later be promoted into a separate retrievable memory/notes domain. Ordinary conversation history is not automatically permanent memory. Memory retrieval/insertion must remain modular and explicit so context-window changes do not erase important user-approved history.
- **No monolithic orchestration:** Never collapse tool execution, Workspace access, prompt construction, memory retrieval, chat state, provider calls, persistence, and diagnostics into one manager/service/runtime. Each concern needs a clear owner and narrow contract.

## Runtime and dependency policy

Node.js 24 LTS is the production baseline. `.nvmrc` contains `24`. GitHub Actions resolves the latest patch release in that LTS line. Do not use an EOL Node line, and do not switch to a Current Node major merely because its number is higher.

At implementation time, check the live npm registry/package pages for every new dependency. Prefer stable releases. Inspect `engines` and peer dependencies. Treat deprecation warnings as issues to investigate rather than noise.

The package lock is authoritative once dependencies are scaffolded. CI should use the committed lockfile and `npm ci`.

The initial architecture selected current releases verified during Prompt 3: React 19, TypeScript 7, Vite 8, Tailwind CSS 4, Dexie 4, Zod 4, Vitest 4, Playwright 1, and `@google/genai` 2. The lockfile, not this paragraph, is the authority for exact installed versions once dependency installation occurs.

## Product requirements carried across the build

Chat: create and continue conversations, send text, stream Gemini responses, display supported thinking summaries, cancel generation, recover from provider/network/timeout failures, retry only when safely retryable, and persist recoverable conversation state.

Gemini: one Interactions implementation, one normalized request contract, one normalized stream-event contract, model selection, capability-driven generation settings, supported thinking controls, explicit creative/fictional system context, and preserved provider diagnostics.

Input: mobile multiline composer, Android keyboard friendliness, voice-to-text, attachment picker, image attachments, document attachments with PDF as a primary target, previews, validation, progress, failure handling, and removal.

Character: persistent portrait, default portrait, custom upload, replacement/removal, enlarged viewing, and 1x–3x scaling.

Appearance: light/dark/system, custom background image, readability treatment behind chat, and persisted appearance state.

Persistence: local authoritative store, schema/version boundary, migrations, corruption-safe recovery, no competing storage authorities.

Security: central configuration boundary, Lockbox classification for secrets/configuration, no browser-bundled application-owned Gemini secret, and no secrets in logs, analytics, diagnostics, or normal persisted state.

Diagnostics/analytics: structured lifecycle state, HTTP/provider/network/timeout diagnostics, request IDs, timings, retry information, safe export, privacy-conscious analytics, and no message-content analytics by default.

Google later: Google OAuth, Calendar, Tasks, Docs, and Chat. Google Keep is explicitly out of scope.

Background later: evaluate Gemini-native Interactions background execution first. Add Cloudflare Workflows only if a concrete requirement remains after that evaluation.

## The 50-prompt build sequence

This is the durable roadmap. The numbered titles are preserved from the project planning record. Do not treat this README as a reason to restart already-completed work; current milestone status is recorded below.

### Prompt 1 — Repository Forensics
Establish the clean-room repository forensics. Inspect the archived implementation as a reference specimen, document what is worth carrying forward, identify complexity and failure modes to avoid, and conclude with the minimal vertical chat spine. No source migration.

### Prompt 2 — Product Boundary
Define the exact initial product boundary for Elara Angelic Utility Applet: what v1 must include, what is explicitly out of scope, what is planned later, the non-negotiable mobile-first and one-Gemini-path rules, and the core success criterion.

### Prompt 3 — Technical Architecture
Select and accept the smallest maintainable architecture: React + TypeScript + Vite, Tailwind CSS, Dexie/IndexedDB, Zod, Vitest, Playwright, `@google/genai` with Gemini Interactions only, Cloudflare Workers as the thin server boundary, and standards-based PWA tooling. Reject unnecessary Next.js, Express, duplicate providers, premature Workflows, and framework-heavy abstractions.

### Prompt 4 — System Boundaries
Define the responsibility boundaries and ownership rules so UI, chat, Gemini, persistence, attachments, appearance, diagnostics, analytics, Google, security, and Worker concerns remain separated without creating an abstraction maze.

### Prompt 5 — Gemini Integration Strategy
Design the single canonical Gemini provider integration around the current Interactions API and `@google/genai`. Eliminate legacy execution paths and define the provider boundary, request direction, response direction, and error ownership.

### Prompt 6 — Current Gemini Model Registry
Build the current Gemini model registry from live, verified model information. Record supported models and model capability metadata so the UI and request builder are data-driven rather than hard-coded around assumptions.

### Prompt 7 — Gemini Settings Engine
Design model-aware generation settings. A selected model must determine which controls are visible and which request fields can be emitted. Unsupported settings must disappear from the UI and never reach the provider.

### Prompt 8 — Streaming Architecture
Define and implement the canonical streaming model for Interactions responses, including lifecycle, text deltas, completion, cancellation, failure, and normalized internal events.

### Prompt 9 — Thinking Display
Implement supported Gemini thinking-summary handling as a separate normalized event/display concern. Never assume every model emits the same thinking capabilities.

### Prompt 10 — Conversation Data Model
Define the minimal conversation/message schema needed for v1 chat, including identity, ordering, timestamps, roles, content, generation state, provider continuity identifiers where needed, and recoverable failure state.

### Prompt 11 — Local Persistence
Implement local-first persistence using Dexie over IndexedDB as the single authoritative client persistence layer. Include versioning, migrations, and recovery boundaries.

### Prompt 12 — API Lockbox
Define the central Lockbox/configuration boundary. Secrets must never leak into the normal browser application state, diagnostics, analytics, logs, or persisted conversation data.

### Prompt 13 — Gemini Credential Architecture
Define how the Gemini credential is supplied through the secure boundary and Worker/API mediation without embedding an application-owned Gemini secret in the browser bundle. Keep secret ownership centralized.

### Prompt 14 — Mobile-First Shell
Implement the Android-portrait-first application shell. Treat narrow portrait as the design baseline and make desktop a secondary responsive adaptation.

### Prompt 15 — ChatGPT-Style Composer
Implement the modern mobile composer: multiline text input, send/cancel states, keyboard-friendly behavior, attachment affordance, and correct scrolling/safe-area behavior.

### Prompt 16 — Voice-to-Text
Implement browser-supported voice-to-text input with graceful capability detection, permissions, user feedback, and failure handling.

### Prompt 17 — Attachment System
Design the attachment lifecycle: pick, validate, preview, progress, failure, remove, and handoff into the provider boundary. Keep attachment ownership independent from chat rendering.

### Prompt 18 — Image Input
Implement image attachment support and the normalized representation needed for Gemini multimodal input, including limits, validation, previews, and diagnostics.

### Prompt 19 — Document Input
Implement document attachment support, with PDF as a primary target, including file validation, metadata, supported-type handling, progress/failure states, and provider handoff.

### Prompt 20 — Character Portrait
Implement persistent character portrait support: default portrait, custom upload, replacement/removal, enlarged viewing, and 1x–3x scaling.

### Prompt 21 — Appearance System
Implement light, dark, and system appearance plus custom background support, readability treatment, and persisted appearance settings.

### Prompt 22 — Performance Budget
Define and enforce a realistic mobile performance budget: bundle size, startup, render cost, persistence cost, stream rendering behavior, memory, and attachment handling. Avoid unnecessary dependencies and work.

### Prompt 23 — Modular Code Rules
Turn the architectural ownership rules into practical coding rules. Keep modules small, dependencies directional, responsibilities explicit, and shared helpers narrow. Prevent generic dumping-ground modules.

### Prompt 24 — Testing Strategy
Define the test pyramid and boundaries: unit tests, provider contract tests, persistence tests, diagnostics tests, and a small number of high-value Playwright end-to-end flows. Prefer behavior over historical topology.

### Prompt 25 — Minimal Vertical Slice
Prove the first end-to-end product path: Android portrait app → conversation state → canonical Interactions provider → normalized stream → thinking summary → persistence → reopen/recover → useful failure state instead of an infinite spinner.

### Prompt 26 — Gemini Safety Policy
Define the application's Gemini safety policy against the exact capabilities of the pinned Interactions API/SDK. Where configurable safety settings are actually supported, use the intended policy for the four relevant categories; never send unsupported safety fields.

### Prompt 27 — Creative-Context System Instruction
Centralize a system instruction that establishes fictional/creative roleplay context without attempting to override provider safety policy or facilitate illegal activity.

### Prompt 28 — Gemini Request Contract
Define and validate the normalized request contract that sits between application chat state and the canonical Gemini Interactions implementation. Make unsupported fields impossible to leak through accidentally.

### Prompt 29 — Provider Error Normalization
Normalize Gemini/provider errors while preserving exact HTTP/provider details needed for diagnostics. Separate safe public diagnostics from secrets and message content.

### Prompt 30 — HTTP Diagnostic Console
Build the diagnostic model and console for HTTP 400/401/403/404/408/409/413/415/422/429/500/502/503/504 plus network, gateway, provider, and timeout failures. Preserve request ID, timings, retries, retryability, and provider status where available.

### Prompt 31 — Developer Diagnostics UI
Expose high-value diagnostics in a controlled developer-facing UI. Never leak secrets, credentials, or user message contents into diagnostic records or exports.

### Prompt 32 — Request Timing and Timeout System
Implement explicit request timing and timeout behavior so provider hangs become deterministic timeout states instead of indefinite spinners.

### Prompt 33 — Retry Policy
Implement a conservative retry policy based on normalized retryability and idempotency. Do not blindly retry every error and do not create duplicate user messages or requests.

### Prompt 34 — Request Lifecycle State Machine
Model request lifecycle explicitly from idle through sending/streaming/completed/cancelled/failure/timeout/retry where applicable. State transitions must be deterministic and testable.

### Prompt 35 — Analytics Architecture
Build privacy-conscious product analytics as a separate concern from diagnostics. Do not collect message content by default; record only useful product-level events and metadata.

### Prompt 36 — Analytics Dashboard
Create the analytics view needed to understand product health while preserving the privacy boundary. Keep analytics distinct from detailed developer diagnostics.

### Prompt 37 — Google OAuth Architecture
Design one Google OAuth authority for later Workspace capabilities, with persistent grant metadata and centralized scope ownership.

### Prompt 38 — Google Scope Registry
Create the centralized Google scope registry for Calendar, Tasks, Docs, and Chat. Keep Google Keep excluded.

### Prompt 39 — Incremental Authorization
Implement incremental authorization so new Google capability scopes are requested only when the corresponding feature is used, while already-granted scopes are retained.

### Prompt 40 — Stay Connected Semantics
Define “authorize once” correctly: persist consent/grant state, use silent/non-interactive token recovery when possible, distinguish expired access tokens from revoked consent, and provide explicit disconnect.

### Prompt 41 — Google OAuth Settings UI
Build the user-facing Google connection/settings UI around the one OAuth authority, persisted grant state, incremental capabilities, and explicit disconnect/recovery behavior.

### Prompt 42 — Google Calendar Service
Implement the Google Calendar capability as a vertical slice attached to the existing OAuth boundary. Do not create a second authorization system.

### Prompt 43 — Google Tasks Service
Implement the Google Tasks capability as a vertical slice attached to the same OAuth authority and scope registry.

### Prompt 44 — Google Docs Service
Implement the Google Docs capability through the established Google boundary, validating inputs/outputs and keeping the service independent of UI state.

### Prompt 45 — Google Chat Service
Implement the Google Chat capability through the same OAuth and service boundary. Keep permissions/scopes explicit.

### Prompt 46 — Google Tool Boundary
Define how Google capability calls can later be exposed to the companion/tooling system without allowing arbitrary UI-driven API access. Keep authorization, validation, diagnostics, and service ownership centralized.

### Prompt 47 — Google Write Confirmation
Require appropriate confirmation for side-effecting Google writes so the user understands what will change before mutations occur.

### Prompt 48 — OAuth Failure Diagnostics
Normalize and expose OAuth failures with useful status/state information while keeping tokens and sensitive authorization data out of diagnostics.

### Prompt 49 — Gemini Native Background Execution
Evaluate and implement Gemini-native Interactions background execution after the foreground chat path is proven. Only add extra durable orchestration such as Cloudflare Workflows if a concrete requirement remains.

### Prompt 50 — End-to-End Reliability Gate
Perform the complete reliability pass across chat, streaming, persistence, diagnostics, attachments, appearance, security, OAuth/integrations where implemented, background execution where implemented, performance, tests, dependency hygiene, and CI. The repository is only considered complete for the current stage when the required quality gate is green.

## Milestones and verified state

Milestone 1 complete: clean-room repository exists and the archived app has been documented as reference material only.

Milestone 2 complete: product boundary is recorded in `docs/PRODUCT_BOUNDARY.md`.

Milestone 3 complete: technical architecture is recorded in `docs/ARCHITECTURE_DECISION.md`.

Prompt 4 is now complete: responsibility and dependency ownership rules are recorded in `docs/SYSTEM_BOUNDARIES.md`.

Prompts 5–7 are complete: canonical Gemini integration strategy, live model registry, and capability-driven settings are recorded in the Gemini architecture documents.

Prompts 8–12 are the current foundation batch: streaming, thinking display, conversation data model, local persistence, and API Lockbox are now recorded in the corresponding architecture documents.

Runtime baseline verified in live CI: `.nvmrc` is `24`; GitHub Actions resolved Node.js `24.20.0` and npm `11.19.0` on 2026-09-03.

## External-source revalidation rule

This project deliberately does not trust old model knowledge for fast-moving dependencies or APIs. Before implementing or changing a relevant surface, re-check the live official source for that dependency/API.

For npm packages: check the npm package page/registry for the current `latest` version, release stability, engines, peer dependencies, and deprecation status. Use `npx` with the package's current documented CLI entry point. Generate the lockfile with npm. Do not paste old dependency versions from the archived application.

For Node.js: keep Node 24 LTS as the production baseline unless live Node.js release status materially changes the support picture. Prefer the newest supported LTS over a Current line.

For Gemini: re-check current Interactions request/response types, SDK version, API version, model IDs, model capabilities, streaming events, thinking controls, safety support, background execution, and error semantics before coding.

For Google OAuth: re-check current Google Identity Services/OAuth guidance and the exact scopes/service requirements before implementing or changing Calendar, Tasks, Docs, or Chat integrations.

## What to carry forward from the archived application

Carry forward proven UX concepts and functional lessons: mobile chat/composer patterns, streaming, supported thinking summaries, model-aware settings, character portrait, custom background/appearance, local persistence, multimodal attachments, structured diagnostics, incremental Google authorization, Lockbox classification, and later background execution.

Do not carry forward the old project's architectural baggage: multiple Gemini paths, legacy GenerateContent runtime, duplicate provider abstractions, Express server infrastructure without a demonstrated need, multiple background runtimes, long-term memory/consolidation, Workspace/artifact/revision systems, large plugin registries, automation infrastructure, Google Keep, or compatibility facades retained solely for history.

## Future-self handoff protocol

This section is for a genuinely later development iteration when context continuity is actually lost. It is not an instruction to restart or jump to a particular prompt during the current build.

A future iteration must first inspect the repository's current README, milestone records, architecture documents, git history, current CI state, and actual source tree. It must determine the highest completed prompt from evidence rather than assuming the next prompt number from memory.

Every completed prompt must leave a concise handoff record containing: what changed; why it changed; files added/changed; important architectural decisions; external facts that were verified live; tests/lint/typecheck/build results; CI run/result; failures encountered and the fix; unresolved risks; exact commit SHA; and what the current iteration believes the next work should be after independently inspecting the repository.

Do not overwrite previous handoff history. Append a new dated entry or update the relevant milestone record while preserving the prior evidence.

The future iteration must repeat this discipline for the next iteration. The chain is: past self leaves evidence → current self verifies it → current self makes changes → current self leaves new evidence for the next future self.

## Current implementation posture

The project is being built deliberately and incrementally. Do not restart completed work merely because the active chat context is new. Do not skip verification because a change looks small. Do not add advanced subsystems prematurely. Keep the repository simple, current, testable, and directly traceable to the roadmap above.