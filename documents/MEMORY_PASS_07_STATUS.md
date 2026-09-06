# Memory Pass 7 — Memory Bank UI

**Status:** implemented 2026-09-06

## What shipped

- Promoted the existing durable-memory settings surface into a dedicated **Memory Bank** Settings section rather than nesting memory management inside Character settings.
- Added case-insensitive search over memory title, body, and tags.
- Added lifecycle, kind, and global-scope filters.
- Records are collapsed by default; only one record can be expanded at a time.
- Opening a record acts as direct result navigation by expanding it and scrolling it into view.
- Expanded records render stored Markdown through the existing safe `MarkdownText` boundary.
- Human inspection reads through canonical `listMemories()` and a new pure `filterMemoryRecords()` projection. Browsing does not invoke model retrieval or increment recall counters.
- Human-owned edits, archive/restore, promotion, and deletion continue through the canonical memory store. Permanent deletion now requires confirmation in the UI.
- Added focused pure tests for inspection search and filters.
- Removed the memory editor from `CharacterSettings`; character identity and durable memory now have separate settings surfaces.

## Architectural boundary

Memory Bank is presentation and human-inspection UX over the same authoritative durable memory store used by the rest of the application. It does not introduce an IndexedDB table, UI-owned persistence layer, or duplicated durable memory context.

The Pass 5 ranked retrieval engine remains dedicated to model-context selection. Human browsing uses the canonical record listing plus a lightweight pure inspection projection so merely looking at a memory does not count as a Gemini recall.

## Safety and semantics

- Markdown is rendered with the existing allow-listed, URL-safe `MarkdownText` component.
- Archived memories remain inspectable when the lifecycle filter is selected.
- Delete is hard removal and requires explicit confirmation.
- Restore uses the existing canonical reinforcement operation, which returns archived records to an active lifecycle.
- No autonomous extraction or automatic memory mutation was introduced.

## Tests

`src/memory/inspection.test.ts` covers case-insensitive title/body/tag search and lifecycle/kind/global filters without mutation of the canonical records.

## Next pass

Pass 8 is long-horizon hardening: corruption/migration recovery, large-dataset performance, deletion and permission verification, conflict handling, export/import considerations, and stress coverage at thousands of records.
