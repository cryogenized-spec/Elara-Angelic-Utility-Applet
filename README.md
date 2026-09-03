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

## Future architecture requirements to preserve now

Tool calling will use curated, explicit application capabilities. Model-visible schemas are allow-listed declarations; actual execution occurs only in validated application services. Google Workspace tools must remain behind the single Google OAuth authority, scope enforcement, diagnostics, and future write-confirmation rules.

The character has a dedicated master system-instruction source containing durable identity, personality, roleplay behavior, style, and rules. It is separate from user messages, tools, and ordinary conversation persistence. Prompt 27 will author the production creative-context instruction.

Long-term notes/memory are a separate retrievable domain for notable events and past experiences. Ordinary conversation history is not automatically permanent memory. This allows important history to survive context-window turnover without creating a giant memory manager.

Never combine provider calls, stream parsing, tool execution, Google Workspace access, character prompting, memory retrieval, persistence, and diagnostics into one monolith.

## 50-prompt roadmap

The roadmap below is the authoritative sequence. Do not restart completed work merely because the chat context changes; use repository evidence.

### Prompt 1 — Repository Forensics
Clean-room repository forensics and lessons from the archived specimen.
### Prompt 2 — Product Boundary
Exact initial product scope, exclusions, later scope, mobile-first rules, and success criterion.
### Prompt 3 — Technical Architecture
React/TypeScript/Vite, Tailwind, Dexie, Zod, Vitest, Playwright, `@google/genai`, Workers, and PWA foundation.
### Prompt 4 — System Boundaries
Responsibility ownership and directional dependencies.
### Prompt 5 — Gemini Integration Strategy
Single canonical Interactions provider boundary and exclusion of legacy execution paths.
### Prompt 6 — Current Gemini Model Registry
Live model registry and capability metadata.
### Prompt 7 — Gemini Settings Engine
Model-aware generation settings and unsupported-field prevention.
### Prompt 8 — Streaming Architecture
Canonical streaming lifecycle, deltas, completion, cancellation/failure, normalized events.
### Prompt 9 — Thinking Display
Separate normalized thinking-summary display semantics.
### Prompt 10 — Conversation Data Model
Minimal conversation/message schema and continuity metadata.
### Prompt 11 — Local Persistence
Dexie/IndexedDB authority, schema versions, migrations, recovery.
### Prompt 12 — API Lockbox
Central secret/configuration boundary.
### Prompt 13 — Gemini Credential Architecture
Secure Gemini credential mediation.
### Prompt 14 — Mobile-First Shell
Android portrait application shell.
### Prompt 15 — ChatGPT-Style Composer
Mobile multiline composer and keyboard behavior.
### Prompt 16 — Voice-to-Text
Voice input capability detection and failure handling.
### Prompt 17 — Attachment System
Attachment lifecycle.
### Prompt 18 — Image Input
Image attachment support.
### Prompt 19 — Document Input
PDF/document support.
### Prompt 20 — Character Portrait
Persistent portrait system.
### Prompt 21 — Appearance System
Theme, background, readability, persistence.
### Prompt 22 — Performance Budget
Mobile performance targets and enforcement.
### Prompt 23 — Modular Code Rules
Practical modularity rules.
### Prompt 24 — Testing Strategy
Unit/provider/persistence/diagnostics/e2e test strategy.
### Prompt 25 — Minimal Vertical Slice
First end-to-end chat path.
### Prompt 26 — Gemini Safety Policy
Safety policy against exact pinned API/SDK support.
### Prompt 27 — Creative-Context System Instruction
Production character/creative system instruction.
### Prompt 28 — Gemini Request Contract
Validated normalized provider request contract.
### Prompt 29 — Provider Error Normalization
Normalized provider diagnostics.
### Prompt 30 — HTTP Diagnostic Console
Detailed HTTP/network/provider diagnostics.
### Prompt 31 — Developer Diagnostics UI
Controlled developer-facing diagnostics UI.
### Prompt 32 — Request Timing and Timeout System
Explicit timeout behavior.
### Prompt 33 — Retry Policy
Conservative retry/idempotency policy.
### Prompt 34 — Request Lifecycle State Machine
Deterministic request states.
### Prompt 35 — Analytics Architecture
Privacy-conscious product analytics.
### Prompt 36 — Analytics Dashboard
Product health dashboard.
### Prompt 37 — Google OAuth Architecture
One Google authorization authority.
### Prompt 38 — Google Scope Registry
Central Workspace scope registry.
### Prompt 39 — Incremental Authorization
Feature-driven incremental scopes.
### Prompt 40 — Stay Connected Semantics
Persistent grant/silent recovery/disconnect.
### Prompt 41 — Google OAuth Settings UI
User-facing connection settings.
### Prompt 42 — Google Calendar Service
Calendar vertical slice.
### Prompt 43 — Google Tasks Service
Tasks vertical slice.
### Prompt 44 — Google Docs Service
Docs vertical slice.
### Prompt 45 — Google Chat Service
Chat vertical slice.
### Prompt 46 — Google Tool Boundary
Safe exposure of Google capabilities as tools.
### Prompt 47 — Google Write Confirmation
Confirmation before side effects.
### Prompt 48 — OAuth Failure Diagnostics
OAuth error normalization.
### Prompt 49 — Gemini Native Background Execution
Background execution evaluation/implementation.
### Prompt 50 — End-to-End Reliability Gate
Full reliability and quality gate.

## Milestones and verified state

Milestones 1–4 complete.

Prompts 5–7 complete with green CI.

Prompts 8–12 are the current batch and are **not yet marked complete** in this README until their artifacts, commits, and CI results have all been verified.

Node.js 24 LTS is the runtime baseline; live CI previously resolved Node.js 24.20.0 and npm 11.19.0 on 2026-09-03.

## External-source revalidation rule

Before implementing any fast-moving Gemini, npm, Node, Google OAuth, or GitHub Action surface, verify the current official documentation/release state. The lockfile, once created, is authoritative for installed dependency versions.

## Future-self handoff protocol

This is only for a genuinely later context-loss iteration. It is not a current restart instruction.

A future iteration must inspect README, architecture docs, git history, CI, and the actual source tree; determine the highest completed prompt from evidence; make its changes; and leave the same evidence for the next iteration.

Every completed prompt must record what changed, why, files, key decisions, live facts verified, tests/lint/typecheck/build, CI result, failures/fixes, unresolved risks, exact commit SHA, and recommended next work.

## Current implementation posture

Build deliberately, directly, and incrementally. Do not add abstraction for abstraction's sake. Do not create compatibility facades for code that does not exist. Keep the system modular so future tools, Workspace integrations, character prompting, and memory can be added without changing the canonical Gemini spine.