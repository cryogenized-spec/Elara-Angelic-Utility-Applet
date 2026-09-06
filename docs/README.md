# Elara Documentation Index

This directory is the authoritative documentation tree for Elara.

## Handoff and implementation notes

- [`oauth/README.md`](./oauth/README.md) — Google OAuth + Workspace future-self handoff, eight-pass implementation plan, security boundaries, scope strategy, background execution, Cron, notifications, and completion checklist.
- [`oauth/PASS_01_STATUS.md`](./oauth/PASS_01_STATUS.md) — Pass 1 state and the remaining protected Worker boundary.
- [`oauth/PASS_02_STATUS.md`](./oauth/PASS_02_STATUS.md) — Google Workspace settings UI implementation handoff.
- [`oauth/PASS_03_STATUS.md`](./oauth/PASS_03_STATUS.md) — audited OAuth scope implementation handoff.
- [`oauth/PASS_04_STATUS.md`](./oauth/PASS_04_STATUS.md) — Drive, Docs, and Sheets service implementation handoff.
- [`oauth/PASS_05_STATUS.md`](./oauth/PASS_05_STATUS.md) — Drive and Sheets model-tool surface handoff.
- [`oauth/PASS_06_STATUS.md`](./oauth/PASS_06_STATUS.md) — centralized Google tool execution, risk/confirmation, and safe diagnostics handoff.
- [`oauth/PASS_07_STATUS.md`](./oauth/PASS_07_STATUS.md) — protected Cloudflare OAuth Worker implementation, session-backed Workspace proxy, and production provisioning handoff.
- [`future-implementation/README.md`](./future-implementation/README.md) — future infrastructure notes for Worker health, Cron, background execution, push notifications, Telegram, and controlled internet access.

## Memory architecture

- [`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md) — authoritative memory store, capability, permission policy, observation/consolidation, retrieval, Gemini context, Memory Bank, and long-horizon hardening boundaries.
- [`../documents/MEMORY_PASS_01_STATUS.md`](../documents/MEMORY_PASS_01_STATUS.md) — foundation pass and retired compatibility seams.
- [`../documents/MEMORY_PASS_02_STATUS.md`](../documents/MEMORY_PASS_02_STATUS.md) — deliberate `memory.save` capability boundary and cleanup.
- [`../documents/MEMORY_PASS_03_STATUS.md`](../documents/MEMORY_PASS_03_STATUS.md) — explicit observation recording and consolidation contract.
- [`../documents/MEMORY_PASS_04_STATUS.md`](../documents/MEMORY_PASS_04_STATUS.md) — centralized permission policy and first-class forget/delete handoff.
- [`../documents/MEMORY_PASS_05_STATUS.md`](../documents/MEMORY_PASS_05_STATUS.md) — pure ranked retrieval engine and hard context budgeting.
- [`../documents/MEMORY_PASS_06_STATUS.md`](../documents/MEMORY_PASS_06_STATUS.md) — bounded durable-memory projection in the single Gemini provider path and non-fatal fallback behavior.
- [`../documents/MEMORY_PASS_07_STATUS.md`](../documents/MEMORY_PASS_07_STATUS.md) — dedicated Memory Bank inspection UI, canonical search/filter projection, Markdown reading view, and human-owned memory management.
- [`../documents/MEMORY_PASS_08_STATUS.md`](../documents/MEMORY_PASS_08_STATUS.md) — read-only integrity diagnostics, multi-thousand retrieval stress coverage, and long-horizon hardening boundaries.

## Google Workspace architecture

- [`GOOGLE_OAUTH_ARCHITECTURE.md`](./GOOGLE_OAUTH_ARCHITECTURE.md) — single server-side OAuth authority.
- [`GOOGLE_OAUTH_WORKER_IMPLEMENTATION.md`](./GOOGLE_OAUTH_WORKER_IMPLEMENTATION.md) — protected Worker source, session storage, token encryption, proxy boundaries, and production configuration.
- [`INCREMENTAL_AUTHORIZATION.md`](./INCREMENTAL_AUTHORIZATION.md) — demand-driven incremental consent.
- [`GOOGLE_SCOPE_REGISTRY.md`](./GOOGLE_SCOPE_REGISTRY.md) — application capability and provider-scope registry.
- [`GOOGLE_OAUTH_SETTINGS_UI.md`](./GOOGLE_OAUTH_SETTINGS_UI.md) — Google connection/settings UI contract.
- [`GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md`](./GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md) — structured authorization failure handling.
- [`GOOGLE_TOOL_BOUNDARY.md`](./GOOGLE_TOOL_BOUNDARY.md) — explicit model-visible Google tool allow-list.
- [`GOOGLE_TOOL_EXECUTION.md`](./GOOGLE_TOOL_EXECUTION.md) — centralized tool risk, confirmation, authorization, and diagnostics gate.
- [`GOOGLE_CALENDAR_SERVICE.md`](./GOOGLE_CALENDAR_SERVICE.md) — Calendar service boundary.
- [`GOOGLE_TASKS_SERVICE.md`](./GOOGLE_TASKS_SERVICE.md) — Tasks service boundary.
- [`GOOGLE_GMAIL_SERVICE.md`](./GOOGLE_GMAIL_SERVICE.md) — Gmail service boundary.
- [`GOOGLE_DOCS_SERVICE.md`](./GOOGLE_DOCS_SERVICE.md) — Docs service boundary.
- [`GOOGLE_DRIVE_SERVICE.md`](./GOOGLE_DRIVE_SERVICE.md) — Drive service boundary.
- [`GOOGLE_SHEETS_SERVICE.md`](./GOOGLE_SHEETS_SERVICE.md) — Sheets service boundary.

## Rule for future sessions

Start with the relevant handoff README before changing an architectural area. Re-check current Google and Cloudflare documentation before implementing provider behavior because scopes, verification requirements, APIs, and runtime capabilities can change.
