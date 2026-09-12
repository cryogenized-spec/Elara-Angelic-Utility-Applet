# Elara documentation index

`/documents` is the canonical technical-documentation root. The existing `/docs` tree and the remaining `*_PASS_*` / `*_STATUS.*` files are migration inputs only; they are not authoritative and will be removed after their current facts have been consolidated.

For machine routing, read [`manifest.json`](./manifest.json) first. For repository-wide boundaries, read [`architecture.md`](./architecture.md). During the migration, [`migration-map.json`](./migration-map.json) records where every known legacy document belongs and which hard-coded references must be rewritten.

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

A legacy document may contain useful evidence, but its claims must be checked against the current implementation before migration.

## 2. Routing table

| ID | System | Canonical document | State |
| --- | --- | --- | --- |
| `SYS-ARCH` | Repository architecture | `architecture.md` | active |
| `SYS-UI` | Application and UI | `ui.md` | Phase 4 |
| `SYS-CHAT` | Conversation/chat | `chat.md` | Phase 4 |
| `SYS-GEM` | Gemini | `gemini.md` | Phase 4 |
| `SYS-VTT` | Voice-to-text | `vtt.md` | Phase 4 |
| `SYS-MEM` | Durable memory | `memory.md` | Phase 4 |
| `SYS-ART` | Artifacts/attachments | `artifacts.md` | Phase 4 |
| `SYS-DOC` | PDF/document generation and OCR | `documents.md` | Phase 4 |
| `SYS-CHAR` | Character and roleplay | `character.md` | Phase 4 |
| `SYS-GAUTH` | Google authorization | `google-auth.md` | Phase 4 |
| `SYS-GWS` | Google Workspace and model tool execution | `google-workspace.md` | Phase 4 |
| `SYS-MEDIA` | Media / YouTube | `media.md` | Phase 4 |
| `SYS-AUTO` | Autonomy | `autonomy.md` | Phase 4 |
| `SYS-SEC` | Lockbox and credentials | `security.md` | Phase 4 |
| `SYS-PERSIST` | Persistence | `persistence.md` | Phase 4 |
| `SYS-PWA` | PWA and deployment | `pwa.md` | Phase 4 |
| `SYS-WORKER` | Cloud Worker runtime | `worker.md` | Phase 4 |
| `SYS-REL` | Reliability, testing and diagnostics | `reliability.md` | Phase 4 |
| `SYS-LEGAL` | Third-party notices | `third-party-notices.md` | Phase 4 |

Until a target document is marked `active` in `manifest.json`, use `architecture.md` plus the owning source/tests. Do not promote a legacy document back to canonical status merely because the replacement has not yet been written.

## 3. Standard system-document shape

Each system document uses stable metadata and numbered chapters. The filenames and system IDs are the durable references; chapter numbers are local navigation only and must not be used for cross-document coupling.

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

Use paragraphs for explanation and compact tables or fenced machine-readable blocks for contracts, flows, ownership and invariants. Prefer source paths and exact symbol names over prose repetition. Do not copy implementation history into current-state reference material.

## 4. Cross-reference rule

Reference another system by stable ID and filename, for example `SYS-MEM / memory.md`. Do not write dependencies such as “see section 4.7.2”; chapter layouts are allowed to change independently.

When a contract spans systems, document the owning rule once and place only the boundary/consumer rule in the other document. This prevents duplicated prose from drifting in two places.

## 5. Maintenance rule

A change that modifies a durable contract must update the owning system document in the same change. New pass logs, handoff files, recovery notes, roadmap documents and implementation diaries are prohibited. Git commits and pull-request history already provide chronology.

`migration-map.json` is temporary scaffolding and should be deleted once every mapped source has been consolidated, all hard-coded references have moved to `/documents`, the legacy `/docs` tree is gone, and the documentation guard passes.
