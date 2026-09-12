# Elara documentation index

`/documents` is the canonical technical-documentation root. Every bounded system now has an active current-state reference. The existing `/docs` tree and remaining `*_PASS_*` / `*_STATUS.*` files are legacy migration inputs only; Phase 5 removes them after hard-coded references and CI assertions are migrated.

For machine routing, read [`manifest.json`](./manifest.json) first. For repository-wide boundaries, read [`architecture.md`](./architecture.md). [`migration-map.json`](./migration-map.json) is temporary Phase 1–5 scaffolding that records where legacy material is being retired.

## 1. Authority

Use this precedence when sources disagree:

```text
source code + tests
        ↓
canonical /documents system document
        ↓
legacy /docs and pass/status notes
        ↓
Git history for historical context only
```

Legacy prose is never promoted merely because it is longer or older. Verify durable facts against implementation/tests before changing a canonical document.

## 2. Routing table

| ID | System | Canonical document |
| --- | --- | --- |
| `SYS-ARCH` | Repository architecture | `architecture.md` |
| `SYS-UI` | Application and UI | `ui.md` |
| `SYS-CHAT` | Conversation/chat | `chat.md` |
| `SYS-GEM` | Gemini | `gemini.md` |
| `SYS-VTT` | Voice-to-text | `vtt.md` |
| `SYS-MEM` | Durable memory | `memory.md` |
| `SYS-ART` | Artifacts/attachments | `artifacts.md` |
| `SYS-DOC` | PDF/document generation and OCR | `documents.md` |
| `SYS-CHAR` | Character and roleplay | `character.md` |
| `SYS-GAUTH` | Google authorization | `google-auth.md` |
| `SYS-GWS` | Google Workspace and model tool execution | `google-workspace.md` |
| `SYS-MEDIA` | Media / YouTube | `media.md` |
| `SYS-AUTO` | Autonomy | `autonomy.md` |
| `SYS-SEC` | Lockbox and credentials | `security.md` |
| `SYS-PERSIST` | Persistence | `persistence.md` |
| `SYS-PWA` | PWA and deployment | `pwa.md` |
| `SYS-WORKER` | Cloud Worker runtime | `worker.md` |
| `SYS-REL` | Reliability, testing and diagnostics | `reliability.md` |
| `SYS-LEGAL` | Third-party notices | `third-party-notices.md` |

## 3. Standard system-document shape

Each system document uses stable metadata and numbered chapters. Filenames and system IDs are durable references; chapter numbers are local navigation only.

```markdown
---
id: SYS-XXX
status: active
verified_commit: <code SHA>
scope: <bounded system>
paths: [src/...]
keywords: [routing, terms, aliases]
---

# System name

## 1. Purpose and boundary
## 2. Runtime architecture
## 3. Source map
## 4. Data and contracts
## 5. Invariants
## 6. Security and failure semantics
## 7. Verification and tests
## 8. Known gaps
```

Use paragraphs for explanation and compact tables/fenced flows for contracts. Prefer exact source paths and symbols over duplicated prose. Do not copy chronology into current-state reference material.

## 4. Cross-reference rule

Reference another system by stable ID and filename, for example `SYS-MEM / memory.md`. Do not couple documents with references such as “section 4.7.2”; chapters may be reorganized independently.

When a contract spans systems, document the owning rule once and only the consumer/boundary rule elsewhere. This prevents duplicated prose from drifting.

## 5. Maintenance rule

A change that modifies a durable contract updates the owning system document in the same change. New pass logs, handoff files, recovery notes, roadmap documents and implementation diaries are prohibited. Git commits/PR history provide chronology.

`manifest.json` is the low-token router for agents. Load only the mapped system document(s) for the task unless a cross-system boundary actually requires more context.

## 6. Migration state

Phase 4 has completed canonical system consolidation. Phase 5 still owns reference migration and deletion: rewrite application documentation links, update CI/reliability assertions, remove `/docs` plus old pass/status files, then delete `migration-map.json` only after no legacy references remain. `public/core/README.md` is an operational BusyTeX deployment note and is intentionally preserved in place.
