# Character Master — Pass 1 Status

## Status

Pass 1 is shipped on `main` as the canonical Character Master runtime boundary.

## What changed

- `src/character/system-instruction.ts` now owns the single resolver for the active Character Master instruction.
- The resolver treats `null`, `undefined`, and whitespace-only values as the canonical empty default.
- Non-empty configured prompt text is preserved exactly; no hidden persona layer is appended or prepended.
- Main chat sends, response regeneration, and Workspace shortcut execution all obtain the instruction through the same resolver.
- The existing five first-run templates remain user-selectable and persist through the existing Character profile store.
- Regression coverage now proves empty-default behavior and exact preservation of configured master text.

## Boundary

The Character Master is request configuration, not conversation content. It is passed through Gemini's dedicated `system_instruction` field. Roleplay, memory, tools, OAuth, and provider transport do not create a second character identity layer.

## Deliberate non-goals

- No built-in Elara persona is silently injected on a fresh install.
- No legacy character-instruction resolver is restored.
- No prompt rewriting, enrichment, or automatic style policy is applied to user-configured master text.

## Verification target

CI must remain green on the resulting `main` commit. The existing E2E character-runtime test verifies that saved master text reaches the Gemini request boundary.
