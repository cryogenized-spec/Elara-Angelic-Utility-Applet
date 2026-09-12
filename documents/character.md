---
id: SYS-CHAR
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: character master, portrait, roleplay preferences and world canvas
paths: [src/character, src/domain/character.ts, src/domain/roleplay-world.ts, src/persistence/character.ts, src/persistence/roleplay-world.ts]
keywords: [character, master-prompt, portrait, roleplay, world-canvas]
---

# Character and roleplay

## 1. Purpose and boundary

`SYS-CHAR` owns the user-configurable Character Master instruction, character profile/portrait presentation and Roleplay World Canvas. Character configuration is separate from ordinary chat history, memory records and model tool schemas.

The application intentionally ships with an empty built-in Character Master. A fresh install therefore has no hidden Elara persona; optional templates may be chosen explicitly by the user.

## 2. Runtime architecture

```text
persisted Character Master
-> resolveMasterCharacterInstruction()
-> Gemini systemInstruction

Roleplay Mode
-> persistent World Canvas
-> model read/mutation tools
-> shared confirmation boundary for mutations
-> deterministic local world state
```

The runtime may append application context such as durable memory after the Character Master; it must not create a competing persona/system instruction.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Character Master slot | `src/character/system-instruction.ts` |
| Character persistence | `src/persistence/character.ts` |
| Character Settings | `src/app/components/CharacterSettings.tsx` |
| Roleplay domain | `src/domain/roleplay-world.ts` |
| Roleplay persistence | `src/persistence/roleplay-world.ts` |
| Roleplay model tools | `src/google/tools/roleplay-world-*.ts` |
| Confirmation | `src/google/confirmation/roleplay-broker.ts` |
| Roleplay Settings | `src/app/components/RoleplaySettings.tsx` |

## 4. Data and contracts

`ELARA_SYSTEM_INSTRUCTION` is the empty string. A non-empty persisted Character Master is returned without rewriting its contents; whitespace-only input resolves to empty. Empty configuration must not block normal chat or regeneration.

<a id="roleplay-world"></a>
The World Canvas stores a versioned world with `world`, `building`, `room`, `outdoor`, `place`, `area` and `object` entities. Each entity has a human-readable ID and a separate 16-hex opaque ref used for unambiguous mutations. The deterministic YAML view intentionally omits opaque refs.

Model-visible world operations can list/inspect/create/update/move/delete entities when Roleplay Mode is active. Reads can proceed normally; persistent mutations use the shared confirmation path before state changes.

## 5. Invariants

- There is one Character Master system-instruction authority; do not layer a second persona prompt on top.
- Empty Character Master is valid and remains empty.
- Character portrait is presentation data and is not sent to Gemini unless explicitly attached through `SYS-ART`.
- Roleplay world state is persistent setting data, not conversation transcript or durable personal memory.
- World mutation requires explicit confirmation; model text is never mutation authority.
- Opaque refs exist to disambiguate entities but remain hidden from human-readable YAML.

## 6. Security and failure semantics

Roleplay tool schemas validate model input. Entity refs use cryptographic digest material and mutations use the same confirmation infrastructure as other consequential application actions. Invalid world data is normalized/rejected at the domain boundary rather than trusted from model output.

## 7. Verification and tests

Use character persistence/system-instruction tests, `src/domain/roleplay-world.test.ts`, roleplay tool/declaration tests, Settings component tests and `e2e/roleplay-world.spec.ts`. The reliability gate enforces the empty built-in Character Master and confirmation/ref invariants.

## 8. Known gaps

Keep user-facing world-building help concise and separate from this reference if expanded later. New roleplay memory or lore systems must decide whether they belong to the World Canvas or `SYS-MEM`; do not duplicate facts into both automatically.
