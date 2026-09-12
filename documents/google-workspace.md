---
id: SYS-GWS
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: Google Workspace service adapters and model tool execution
paths: [src/google/calendar, src/google/tasks, src/google/gmail, src/google/docs, src/google/drive, src/google/sheets, src/google/chat, src/google/tools, src/google/confirmation]
keywords: [workspace, calendar, tasks, gmail, docs, drive, sheets, tools, confirmation]
---

# Google Workspace and tool execution

## 1. Purpose and boundary

`SYS-GWS` owns validated Google Workspace service adapters, the executable model tool registry and confirmation of consequential operations. OAuth/token authority remains `SYS-GAUTH / google-auth.md`. The registry also contains a few application-local/non-Google tools; those tools' domain semantics belong to their owning system documents.

## 2. Runtime architecture

```text
Gemini function call
-> canonical tool registry descriptor
-> schema validation
-> capability check
-> confirmation when risk != read
-> service/local handler
-> normalized result
-> Gemini grouped continuation
```

The registry assigns each operation a capability, risk (`read|write|send|destructive`), exposure and optional execution plane. Declarations are generated from this executable registry rather than maintained as a second schema list.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Tool registry | `src/google/tools/registry.ts` |
| Gemini declarations | `src/google/tools/gemini-declarations.ts` |
| Execution | `src/google/tools/executor.ts`, service handlers |
| Confirmation | `src/google/confirmation/broker.ts`, policy modules |
| Calendar | `src/google/calendar/` |
| Tasks | `src/google/tasks/` |
| Gmail | `src/google/gmail/` |
| Docs/Drive/Sheets | matching `src/google/*/` folders |
| Chat adapter | `src/google/chat/` |

## 4. Data and contracts

Gemini-visible Workspace operations cover Calendar events; Tasks lists/tasks; Gmail message/thread/label/search/send/mutation operations; Docs inspect/create/edit; Drive app-file and optional library reads plus file mutations; Sheets reads/writes. `document.create_pdf`, Roleplay World tools and `youtube.search` share the generic registry but execute through their own systems.

Google Chat service code and scopes exist, but Chat tools are currently marked internal/deferred from Workspace v1 and are not advertised to Gemini. Internal primitives such as `docs.getDocument`, `docs.batchUpdate` and `sheets.batchUpdate` also remain non-Gemini-facing.

The shared confirmation broker supports single or grouped mutation approvals, explicit decline, approve-selected and approve-all controls. Cancellation fails closed.

## 5. Invariants

- Model-visible declarations derive from the executable registry; no shadow allow-list.
- `additionalProperties:false` and service schemas reject undeclared arguments.
- Reads may execute when authorized; write/send/destructive operations require confirmation.
- Confirmation is separate from OAuth: permission to call an API is not consent to mutate data.
- Tool schemas never contain credentials, raw scopes or provider URLs.
- Browser/worker execution-plane filtering is explicit; browser-only tools are not silently advertised by the Worker.

## 6. Security and failure semantics

Arguments are validated before execution, OAuth capabilities are checked centrally, and mutation confirmations summarize the target without leaking secrets. Handler/provider failures are normalized before returning to Gemini. If confirmation UI is unavailable, already busy or aborted, mutations resolve as denied rather than auto-approved.

## 7. Verification and tests

Use service contract tests, `src/google/tools/*test*`, Gemini declaration tests, confirmation broker/policy tests and integration/E2E flows. The reliability gate locks key invariants including Calendar write capability, grouped confirmations, registry-derived declarations and explicit accessibility controls.

## 8. Known gaps

Google Chat remains deferred from the Gemini surface. Any future orchestration/Kanban layer should consume these normalized service/tool boundaries rather than embedding Google API logic or OAuth state in UI components.
