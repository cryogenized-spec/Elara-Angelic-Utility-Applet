# Elara documentation index

`/documents` is the canonical technical-documentation root. Every bounded system has an active current-state reference. Legacy `/docs` and remaining `*_PASS_*` / `*_STATUS.*` files are migration-only inputs pending reference migration and deletion.

For machine routing, start with [`manifest.json`](./manifest.json). For repository-wide boundaries, use [`architecture.md`](./architecture.md). [`migration-map.json`](./migration-map.json) is temporary cleanup scaffolding and is not technical authority.

## 1. Minimal load protocol

For repair or feature work, use this order:

```text
manifest.json
-> one matching system document
-> exact source/tests named by that document
-> architecture.md or another system document only if the change crosses a boundary
```

Path routing uses the most-specific matching manifest path. Keyword routing is for conceptual tasks without a clear path. This keeps routine agent context small without hiding the human-readable index.

## 2. Authority

```text
source code + tests
        ↓
canonical /documents system document
```

Legacy documents and Git history are evidence/history only. When prose conflicts with implementation, verify the implementation and repair the canonical document.

## 3. Routing table

| ID | System | Canonical document |
| --- | --- | --- |
| `SYS-ARCH` | Repository architecture | [`architecture.md`](./architecture.md) |
| `SYS-UI` | Application and UI | [`ui.md`](./ui.md) |
| `SYS-CHAT` | Conversation/chat | [`chat.md`](./chat.md) |
| `SYS-GEM` | Gemini | [`gemini.md`](./gemini.md) |
| `SYS-VTT` | Voice-to-text | [`vtt.md`](./vtt.md) |
| `SYS-MEM` | Durable memory | [`memory.md`](./memory.md) |
| `SYS-ART` | Artifacts/attachments | [`artifacts.md`](./artifacts.md) |
| `SYS-DOC` | PDF/document generation and OCR | [`documents.md`](./documents.md) |
| `SYS-CHAR` | Character and roleplay | [`character.md`](./character.md) |
| `SYS-GAUTH` | Google authorization | [`google-auth.md`](./google-auth.md) |
| `SYS-GWS` | Google Workspace and model tool execution | [`google-workspace.md`](./google-workspace.md) |
| `SYS-MEDIA` | Media / YouTube | [`media.md`](./media.md) |
| `SYS-AUTO` | Autonomy | [`autonomy.md`](./autonomy.md) |
| `SYS-SEC` | Lockbox and credentials | [`security.md`](./security.md) |
| `SYS-PERSIST` | Persistence | [`persistence.md`](./persistence.md) |
| `SYS-PWA` | PWA and deployment | [`pwa.md`](./pwa.md) |
| `SYS-WORKER` | Cloud Worker runtime | [`worker.md`](./worker.md) |
| `SYS-REL` | Reliability, testing and diagnostics | [`reliability.md`](./reliability.md) |
| `SYS-LEGAL` | Third-party notices | [`third-party-notices.md`](./third-party-notices.md) |

## 4. Standard system-document shape

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

Use paragraphs for explanation and compact tables/fenced flows for contracts. Prefer exact symbols, source paths and invariants over duplicated prose. Do not copy chronology into current-state references.

## 5. Cross-reference rule

Reference another system by stable ID and filename, for example `SYS-MEM / memory.md`. Do not couple documents with references such as “section 4.7.2”; chapters may be reorganized independently.

When a contract spans systems, document the owning rule once and only the consumer/boundary rule elsewhere. This prevents duplicated prose from drifting.

## 6. Maintenance rule

A change that modifies a durable contract updates the owning system document in the same change. New pass logs, handoff files, recovery notes, roadmap documents and implementation diaries are prohibited. Git commits/PR history provide chronology.

`manifest.json` is the low-token router. Load only the mapped system document(s) for the task unless a real cross-system dependency requires more context.

## 7. Legacy cleanup state

Canonical extraction is complete. Remaining cleanup is mechanical: rewrite application documentation links, move CI/reliability assertions to canonical paths, delete legacy `/docs` plus old pass/status files, and remove `migration-map.json` after no legacy references remain. `public/core/README.md` is an operational BusyTeX deployment note and is intentionally preserved in place.
