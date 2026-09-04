# Elara Documentation Index

This directory is the authoritative documentation tree for Elara.

## Handoff and implementation notes

- [`oauth/README.md`](./oauth/README.md) — Google OAuth + Workspace future-self handoff, eight-pass implementation plan, security boundaries, scope strategy, background execution, Cron, notifications, and completion checklist.
- [`oauth/PASS_01_STATUS.md`](./oauth/PASS_01_STATUS.md) — Pass 1 state and the remaining protected Worker boundary.
- [`oauth/PASS_02_STATUS.md`](./oauth/PASS_02_STATUS.md) — Google Workspace settings UI implementation handoff.
- [`oauth/PASS_03_STATUS.md`](./oauth/PASS_03_STATUS.md) — audited OAuth scope implementation handoff.
- [`oauth/PASS_04_STATUS.md`](./oauth/PASS_04_STATUS.md) — Drive, Docs, and Sheets service implementation handoff.
- [`future-implementation/README.md`](./future-implementation/README.md) — future infrastructure notes for Worker health, Cron, background execution, push notifications, Telegram, and controlled internet access.

## Google Workspace architecture

- [`GOOGLE_OAUTH_ARCHITECTURE.md`](./GOOGLE_OAUTH_ARCHITECTURE.md) — single server-side OAuth authority.
- [`INCREMENTAL_AUTHORIZATION.md`](./INCREMENTAL_AUTHORIZATION.md) — demand-driven incremental consent.
- [`GOOGLE_SCOPE_REGISTRY.md`](./GOOGLE_SCOPE_REGISTRY.md) — application capability and provider-scope registry.
- [`GOOGLE_OAUTH_SETTINGS_UI.md`](./GOOGLE_OAUTH_SETTINGS_UI.md) — Google connection/settings UI contract.
- [`GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md`](./GOOGLE_OAUTH_FAILURE_DIAGNOSTICS.md) — structured authorization failure handling.
- [`GOOGLE_TOOL_BOUNDARY.md`](./GOOGLE_TOOL_BOUNDARY.md) — explicit model-visible Google tool allow-list.
- [`GOOGLE_CALENDAR_SERVICE.md`](./GOOGLE_CALENDAR_SERVICE.md) — Calendar service boundary.
- [`GOOGLE_TASKS_SERVICE.md`](./GOOGLE_TASKS_SERVICE.md) — Tasks service boundary.
- [`GOOGLE_GMAIL_SERVICE.md`](./GOOGLE_GMAIL_SERVICE.md) — Gmail service boundary.
- [`GOOGLE_DOCS_SERVICE.md`](./GOOGLE_DOCS_SERVICE.md) — Docs service boundary.
- [`GOOGLE_DRIVE_SERVICE.md`](./GOOGLE_DRIVE_SERVICE.md) — Drive service boundary.
- [`GOOGLE_SHEETS_SERVICE.md`](./GOOGLE_SHEETS_SERVICE.md) — Sheets service boundary.

## Rule for future sessions

Start with the relevant handoff README before changing an architectural area. Re-check current Google and Cloudflare documentation before implementing provider behavior because scopes, verification requirements, APIs, and runtime capabilities can change.
