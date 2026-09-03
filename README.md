# Elara Angelic Utility Applet

This README is the durable continuity record for the clean-room rebuild of Elara. It preserves project history, constraints, roadmap, verified implementation decisions, and handoff notes.

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

Tool calling is a curated application capability surface. Model-visible schemas are explicit allow-listed declarations; actual execution occurs only in validated application services. Tool schemas never contain secrets. Google Workspace capabilities use the single OAuth authority, centralized scope checks, diagnostics, and future write confirmation.

The character has a dedicated master system-instruction source containing durable identity, personality, roleplay behavior, style, and rules. It is separate from user messages, ordinary conversation history, and tool schemas. Prompt 27 will author the production creative-context instruction.

Long-term notes/memory are a separate retrievable domain for notable events and past experiences. Ordinary conversation history is not automatically permanent memory. This preserves important experiences when model context windows turn over without creating a giant memory manager.

Never combine provider calls, stream parsing, tool execution, Workspace access, character prompting, memory retrieval, persistence, and diagnostics into one manager/service/runtime.

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

These five prompts intentionally stop short of claiming runtime/package implementation because the repository did not yet contain the npm scaffold or generated lockfile. The contracts are now fixed so the runtime implementation can be generated from the current package graph without changing the architecture.

Node.js 24 LTS remains the runtime baseline. Live dependency/API verification remains mandatory for fast-moving surfaces.

## External-source revalidation rule

Before changing Gemini, npm, Node, Google OAuth, Cloudflare Workers, or GitHub Action surfaces, re-check current official documentation/release state. The generated `package-lock.json`, once dependencies are scaffolded, is authoritative for installed versions.

Current Prompt 13 verification: Cloudflare Workers secrets are encrypted bindings exposed through the Worker environment; sensitive values must not be put in plaintext `vars`. citeturn957008search0turn957008search1

Current Prompt 14–17 verification: Vite's current scaffolding remains `npm create vite@latest`; safe-area handling uses CSS environment variables; Web Speech `SpeechRecognition` has limited browser availability; HTML `accept` is a picker hint rather than a validation mechanism. citeturn339022search0turn339022search3turn957008search8turn339022search1

## Future-self handoff protocol

Only a genuinely later context-loss iteration uses this protocol. It is not a current restart instruction.

A future iteration must inspect README, architecture docs, git history, CI, and the actual source tree; determine the highest completed prompt from evidence; make changes; and leave equivalent evidence for the next iteration.

Every completed prompt must record what changed, why, files, decisions, live facts verified, tests/lint/typecheck/build, CI result, failures/fixes, unresolved risks, exact commit SHA, and recommended next work.

## Current implementation posture

Build directly and incrementally. Do not recreate the archived architecture. Keep tool calling, Workspace integrations, character prompting, memory, persistence, diagnostics, and the canonical Gemini provider modular and independently testable.
