# Elara Angelic Utility Applet

This README is the durable continuity record for the clean-room rebuild of Elara. It preserves project history, constraints, roadmap, verified implementation decisions, deployment expectations, and handoff notes.

## Current project definition

Elara is a mobile-first AI companion/chat application centered on Google's Gemini Interactions API.

The repository is a clean-room rebuild. The archived `Elara-Companion-current` repository is reference material only: use it for lessons, feature history, and proven UX ideas, but do not migrate its architecture, source layout, compatibility layers, or legacy execution paths.

Primary runtime target: Android portrait. Desktop is secondary.

Canonical spine:

Android portrait UI → conversation state → one canonical Gemini Interactions provider → normalized streaming events → local persistence.

## Non-negotiable rules

1. One canonical Gemini execution path. Never add a legacy `generateContent` fallback or a second Gemini client/provider.
2. Use Google's current Gemini Interactions API through `@google/genai`.
3. Model settings are capability-driven. Never expose or send unsupported controls or fields.
4. UI must not construct raw Gemini requests, own persistence, manage OAuth internals, or handle secrets.
5. Keep modules small and responsibility-focused; no monolithic managers/services.
6. Android portrait comes first.
7. External data crossing trust boundaries must be validated.
8. Provider/network failures must become explicit diagnosable states; no endless spinner.
9. One authoritative persistence store per domain.
10. Build vertically; later capabilities must not block proof of core chat.
11. Direct commits to `main` are normal. Do not leave pull requests open.
12. CI must be green before a milestone is called complete.
13. Revalidate live Node/npm/package/SDK/CLI/GitHub Action choices before use.
14. Use `npx` for one-shot upstream CLIs with current documented `@latest` entry points.
15. Never invent a lockfile; generate it with npm from the actual dependency graph.

## Future architecture requirements

Tool calling is a curated application capability surface. Model-visible schemas are explicit allow-listed declarations; actual execution occurs in validated application services. Tool schemas never contain secrets. Google Workspace capabilities use the single OAuth authority, centralized scope checks, diagnostics, and future write confirmation.

The character has a dedicated master system-instruction source containing durable identity, personality, roleplay behavior, style, and rules. It is separate from user messages, ordinary conversation history, and tool schemas. Prompt 27 now provides the production creative-context instruction.

Long-term notes/memory are a separate retrievable domain for notable events and past experiences. Ordinary conversation history is not automatically permanent memory. This preserves important experiences when model context windows turn over without creating a giant memory manager.

Never combine provider calls, stream parsing, tool execution, Workspace access, character prompting, memory retrieval, persistence, diagnostics, and presentation into one manager/service/runtime.

## Google Workspace orchestration direction

Google Workspace is not being implemented as a collection of generic CRUD adapters. Calendar, Tasks, Gmail, Docs, and Chat are independent service boundaries feeding a future orchestration/Kanban layer.

Calendar and Tasks receive special emphasis because the eventual Kanban system will let Elara manage work conversationally while the user retains a direct visual overview. Task hierarchy/position and Calendar event movement/partial updates therefore remain first-class operations rather than being collapsed into generic update calls.

Gmail is equally important for orchestration. Message search, thread inspection, labels, label modifications, trash/untrash, drafts, and sending are separate operational concepts. Consequential operations remain subject to OAuth capability checks and the per-action write-confirmation layer.

The future Kanban/orchestration layer must consume normalized, auditable operation records from these services. It must not own Google OAuth, provider endpoint logic, or service-specific credential handling.

## Deployment architecture

Elara is a Vite application and should be published to GitHub Pages as built static output, not by serving the source repository root.

Canonical deployment path:

`main` → GitHub Actions build → `dist/` artifact → GitHub Pages

When Pages is enabled, use **Settings → Pages → Source → GitHub Actions**. The deployment workflow should build the application and publish only the generated `dist/` directory. Do not create a `gh-pages` source branch merely to hold compiled output.

For the project-site URL form `https://<owner>.github.io/<repo>/`, Vite requires the corresponding repository base path in its build configuration. For a user/organization site or custom domain at the domain root, `/` is appropriate. The repository deployment workflow will own this setting when the exact Pages URL is finalized.

GitHub's current Pages guidance supports custom Actions workflows, and Vite's current deployment guidance supports GitHub Actions for Vite builds. Cloudflare Pages remains a viable future alternative because it can build Vite and publish `dist`, but it is not the primary deployment target for this roadmap. citeturn472153search0turn472153search2turn275656search0turn275656search7

## 50-prompt roadmap

1. Repository Forensics
2. Product Boundary
3. Technical Architecture
4. System Boundaries
5. Gemini Integration Strategy
6. Current Gemini Model Registry
7. Gemini Settings Engine
8. Streaming Architecture
9. Thinking Display
10. Conversation Data Model
11. Local Persistence
12. API Lockbox
13. Gemini Credential Architecture
14. Mobile-First Shell
15. ChatGPT-Style Composer
16. Voice-to-Text
17. Attachment System
18. Image Input
19. Document Input
20. Character Portrait
21. Appearance System
22. Performance Budget
23. Modular Code Rules
24. Testing Strategy
25. Minimal Vertical Slice
26. Gemini Safety Policy
27. Creative-Context System Instruction
28. Gemini Request Contract
29. Provider Error Normalization
30. HTTP Diagnostic Console
31. Developer Diagnostics UI
32. Request Timing and Timeout System
33. Retry Policy
34. Request Lifecycle State Machine
35. Analytics Architecture
36. Analytics Dashboard
37. Google OAuth Architecture
38. Google Scope Registry
39. Incremental Authorization
40. Stay Connected Semantics
41. Google OAuth Settings UI
42. Google Calendar Service
43. Google Tasks Service
44. Google Docs Service
45. Google Chat Service
46. Google Tool Boundary
47. Google Write Confirmation
48. OAuth Failure Diagnostics
49. Gemini Native Background Execution
50. End-to-End Reliability Gate

## Milestones

Prompts 1–4 complete.

Prompts 5–7 complete: canonical Gemini strategy, live model registry, capability-driven settings.

Prompts 8–12 complete: canonical streaming architecture, thinking-summary display boundary, minimal conversation data model, Dexie/IndexedDB persistence boundary, and API Lockbox.

Prompts 13–17 complete as foundation contracts: credential architecture, Android-portrait shell, composer behavior, voice capability boundary, and attachment lifecycle.

Prompts 18–22 complete as foundation contracts: image input, PDF/document input, character portrait, appearance system, and mobile performance budget.

Prompts 23–24 complete: modular code rules and layered testing strategy.

Prompt 25 complete: first executable Vite/React vertical slice with a mobile-first shell, application turn boundary, normalized demo streaming events, Dexie persistence, unit test, and Playwright smoke test. The demo transport is explicitly non-Gemini and temporary; it does not create a second Gemini path.

Prompt 26 complete: safety policy and enforcement boundaries. Custom safety settings are not exposed because the current Interactions API does not support custom safety settings.

Prompt 27 complete: production creative-context master system instruction for Elara, stored separately from ordinary conversation content, tool schemas, and future memory notes.

Prompts 28–32 complete: canonical Gemini request contract, normalized provider-error model, safe HTTP diagnostics contract, developer diagnostics presentation contract, and request timing/timeout contract.

Prompts 33–37 complete as foundation contracts: bounded retry policy, explicit request lifecycle state machine, privacy-conscious analytics architecture, aggregate analytics dashboard contract, and one-authority Google OAuth architecture.

Prompts 38–42 complete: central Google scope registry, demand-driven incremental authorization, stay-connected state semantics, Google OAuth settings UI contract, and the first concrete Google Calendar service boundary plus contract test.

Prompts 43–47 complete: granular Google Tasks service, focused Docs service, Google Chat service, orchestration-critical Gmail service, explicit model-visible Google tool registry, and a bounded write-confirmation policy for consequential operations.

Prompts 48–50 complete: structured Google OAuth failure diagnostics, native Gemini Interactions background-execution contract, and an enforceable final reliability gate covering architecture invariants plus lint/typecheck/unit/build/E2E CI.

## Runtime status

The first executable vertical slice exists. It proves the application plumbing with a deterministic demo transport:

Android-first UI → application turn boundary → normalized stream events → local persistence.

The demo transport is temporary test/demo infrastructure, not an alternate Gemini implementation. The production provider remains the single canonical Gemini Interactions adapter and will enter through the same application-facing turn boundary.

The repository does not contain a fabricated `package-lock.json`. Until a real lockfile is generated from npm and committed, CI uses `npm install`. Once a genuine lockfile exists, CI should switch to lockfile-aware caching and `npm ci`.

## Google Workspace status

Workspace access is architecturally connected through one OAuth authority. Calendar, Tasks, Docs, Chat, and Gmail each have focused service boundaries. The model-visible Google tool surface is explicitly allow-listed, with OAuth capability mapping and separate write-confirmation classification. Gmail and Tasks are treated as especially important orchestration inputs because the future Kanban layer will need fine-grained task movement/state and email workflow control.

Gemini native background execution is now defined as another lifecycle around the same canonical provider boundary. Long-running work can be represented by a server-side interaction reference and later surfaced to orchestration/Kanban without creating a second model client.

## External-source revalidation rule

Before changing Gemini, npm, Node, Google OAuth, Cloudflare Workers, GitHub Pages, or GitHub Action surfaces, re-check current official documentation/release state. The generated `package-lock.json`, once dependencies are scaffolded, is authoritative for installed versions.

Google's current Calendar documentation recommends narrowly focused scopes and distinguishes event read/write permissions; contextual incremental authorization is a current Google recommendation. Sensitive or restricted scopes can also require additional verification. citeturn616269search0turn616269search1turn616269search5turn616269search8

The current Gemini Interactions documentation supports background execution, polling/reconnection, cancellation, and `previous_interaction_id` chaining after the prior interaction is no longer active. citeturn383674search0turn383674search1turn383674search3

## Future-self handoff protocol

Only a genuinely later context-loss iteration uses this protocol. It is not a current restart instruction.

A future iteration must inspect README, architecture docs, git history, CI, and the actual source tree; determine the highest completed prompt from evidence; make changes; and leave equivalent evidence for the next iteration.

Every completed prompt must record what changed, why, files, decisions, live facts verified, tests/lint/typecheck/build, CI result, failures/fixes, unresolved risks, exact commit SHA, and recommended next work.

## Current implementation posture

Build directly and incrementally. Do not recreate the archived architecture. Keep tool calling, Workspace integrations, character prompting, memory, persistence, diagnostics, attachments, appearance, background execution, and the canonical Gemini provider modular and independently testable.
