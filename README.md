# Elara Angelic Utility Applet

This README is the durable continuity record for the clean-room rebuild of Elara. It preserves project history, constraints, roadmap, verified implementation decisions, deployment expectations, and handoff notes.

## Current project definition

Elara is a mobile-first AI companion/chat application centered on Google's Gemini Interactions API.

The repository is a clean-room rebuild. The archived `Elara-Companion-current` repository is reference material only: use it for lessons, feature history, and proven UX ideas, but do not migrate its architecture, source layout, compatibility layers, or legacy execution paths.

Primary runtime target: Android portrait. Desktop is secondary.

**Canonical UI body: 9:16 Android portrait.** Other viewports adapt from this reference geometry.

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
16. Interface vectors should be repository-owned SVG assets or clean open-source paths; core UI chrome must not depend on remote raster images.
17. Remote Google Fonts are a progressive enhancement; the UI must retain a usable system fallback when the network is unavailable.

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

When Pages is enabled, use **Settings → Pages → Source → GitHub Actions**. The deployment workflow should build the application and publish only the generated `dist` directory. Do not create a `gh-pages` source branch merely to hold compiled output.

For the project-site URL form `https://<owner>.github.io/<repo>/`, Vite requires the corresponding repository base path in its build configuration. For a user/organization site or custom domain at the domain root, `/` is appropriate.

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

## UI implementation plan

The detailed UI contract lives in [`docs/UI_IMPLEMENTATION_PLAN.md`](docs/UI_IMPLEMENTATION_PLAN.md). The implementation is intentionally split into eight passes so each layer can be tested independently instead of creating one oversized UI component.

### Pass 1 — Foundation and geometry

Build the 9:16 Android reference canvas, black/deep-charcoal visual base, restrained blue/pink piping, white type, safe-area handling, design tokens, glass surfaces, left control spine, Elara landscape banner frame, horizontally scrolling quick-action rail, conversation region, and composer frame. Settings becomes a separate screen with a left-bound vertical navigation carousel and right-side detail surface. The API Lockbox is given its permanent Settings home now.

### Pass 2 — Elara portrait system

Implement the canonical landscape banner, 1×–3× presentation scaling, collapse-to-avatar transition while utility surfaces are open, restoration to the previous scale, and configurable ambient background hooks.

### Pass 3 — Conversation surface

Implement AI-dominant message presentation, empty-chat composition, grouped messages, timestamps, execution/thinking summaries with expansion controls, and reliable conversation scrolling.

### Pass 4 — Android composer and keyboard behavior

Implement multiline text, send, voice-to-text, attachment entry points, focus management, visual-viewport/IME handling, latest-message visibility and stable scrolling while the Android keyboard is open.

### Pass 5 — Sidebar menu and chat threads

Implement persisted threads, first-message theme generation, 3–10 word AI-generated thread titles, thread selection, new chat, and future archive/rename/delete/search semantics.

### Pass 6 — Quick-action rail

Implement configurable Calendar, Tasks, Gmail and future Workspace quick actions. Actions dispatch application capabilities and display results without injecting canned user messages into the visible chat.

### Pass 7 — Visual polish and motion

Tune typography, glass, piping, icon geometry, portrait composition, pressed/focus states, motion, reduced-motion behavior, accessibility contrast and touch targets.

### Pass 8 — Physical-device reliability

Test the deployed PWA on Android portrait hardware and representative viewport sizes. Exercise keyboard open/close, sidebar plus keyboard, long conversations, portrait scaling, Settings navigation, slow/offline font behavior and obscured-control failure modes.

## UI design decisions

### 9:16 is canonical

The UI body is designed against a 9:16 portrait composition. It is not a claim that every Android device has exactly that ratio; it is the design reference used to establish hierarchy and spacing. Responsive rules adapt outward from this portrait body.

### Portrait artwork is not the UI canvas

Elara's artwork is approximately 4:5 portrait-oriented artwork contained inside a wider landscape presentation banner. The artwork must never dominate the text or determine the app's aspect ratio.

### Sidebar menu

The hamburger control opens the **sidebar menu** as a frosted/glass left-side surface. The sidebar hosts conversation threads and a Settings entry. The sidebar is an application surface, not a persistence or provider implementation.

### Settings screen

Settings is a separate screen. Its navigation is a vertically scrolling, left-bound carousel/list. Selecting an item leaves the selector visible on the left and renders the corresponding controls/details on the right for the remaining space. The API Lockbox is a dedicated security category.

### Thread descriptions

After the first meaningful message in a new conversation, Elara will generate a 3–10 word description/title for that thread. That generated metadata is stored as thread metadata; it is not inserted as a user-visible chat prompt.

### Quick tools

The top toolbar is horizontally scrollable rather than compressing all utilities into a cramped row. Calendar, Tasks, Gmail and other shortcuts execute application actions directly. No hidden canned prompt should appear in chat merely because a shortcut was pressed.

## Typography and Google Fonts

The UI intentionally offers a small curated set of Google-hosted font choices: **Inter**, **Manrope**, and **Outfit**. They are not bundled into the application.

The wiring uses Google's documented CSS2 API: `https://fonts.googleapis.com/css2?family=...&display=swap`, requesting only the weights the UI needs. Google documents that the browser receives a stylesheet tailored to the request and then fetches the appropriate font resources; the browser's normal HTTP cache is therefore the reuse mechanism. citeturn765993search1turn765993search2

This is deliberately different from self-hosting font files. A browser cache is not an offline guarantee. The app therefore keeps a system-font fallback and uses `font-display: swap` so readable text remains available while a selected web font loads. citeturn533491search1turn533491search7

The initial implementation contains a small font loader that dynamically adds one Google CSS2 stylesheet link per selected family. It records loaded families in-memory to avoid duplicate DOM work. Later Settings persistence will preserve the selected family as an application setting.

Google recommends requesting only the styles and weights actually used so the delivered font payload remains small. citeturn765993search1

## Vector policy

Core interface graphics are SVG vectors owned by the repository, with small predictable path sets and consistent stroke geometry. This includes the hamburger, Settings, Calendar, Tasks, Mail, microphone, attachment, send, chevron and related UI symbols. The character portrait remains an independent artwork asset and is not forced into an SVG representation.

## Engineering practices for the UI

Keep feature components small and responsibility-focused. Presentation components receive explicit props and callbacks; they do not reach directly into Gemini, OAuth, IndexedDB, credentials, or diagnostics internals.

Use semantic buttons, labels, focus states, visible keyboard navigation where relevant, sufficient touch targets, contrast-aware text, and `prefers-reduced-motion` support. Avoid fixed keyboard heights and fixed device dimensions.

Keep application decisions outside JSX where possible. Do not hide business rules in CSS, giant event handlers, or sprawling effects. Prefer narrow typed contracts, explicit state machines where interaction is stateful, and validation at trust boundaries.

Do not introduce a giant `UIManager`, `AppManager`, or generic `Utils` module to connect unrelated concerns. Keep provider, persistence, OAuth, security, diagnostics, portrait presentation, appearance, conversation, and Workspace services independently testable.

## External-source revalidation rule

Before changing Gemini, npm, Node, Google OAuth, Cloudflare Workers, GitHub Pages, GitHub Action, or Google Fonts surfaces, re-check current official documentation/release state. The generated `package-lock.json`, once dependencies are scaffolded, is authoritative for installed versions.

Google's current Calendar documentation recommends narrowly focused scopes and distinguishes event read/write permissions; contextual incremental authorization is a current Google recommendation. Sensitive or restricted scopes can also require additional verification.

The current Gemini Interactions documentation supports background execution, polling/reconnection, cancellation, and `previous_interaction_id` chaining after the prior interaction is no longer active.

## Future-self handoff protocol

Only a genuinely later context-loss iteration uses this protocol. It is not a current restart instruction.

A future iteration must inspect README, architecture docs, git history, CI, and the actual source tree; determine the highest completed prompt from evidence; make changes; and leave equivalent evidence for the next iteration.

Every completed prompt must record what changed, why, files, decisions, live facts verified, tests/lint/typecheck/build, CI result, failures/fixes, unresolved risks, exact commit SHA, and recommended next work.

## Current implementation posture

Build directly and incrementally. Do not recreate the archived architecture. Keep tool calling, Workspace integrations, character prompting, memory, persistence, diagnostics, attachments, appearance, background execution, and the canonical Gemini provider modular and independently testable.

**Current UI milestone:** Pass 1 implementation is underway. The first pass establishes the visual geometry and surface boundaries while keeping the existing deterministic chat transport intact for verification.
