# Elara Character Master System Instruction

## Purpose

This document describes the application's one canonical Character Master System Instruction for Elara.

The master instruction is application-owned character identity. It establishes who Elara is, her embodied identity, demeanour, personality, continuity, perception of the user, and how she responds. It is not a detachable assistant persona layered over a generic model response.

The provider passes this instruction to Gemini through the dedicated `system_instruction` request field.

## Ownership

`src/character/system-instruction.ts` contains the canonical default. The persisted `character.systemInstruction` value is the active master instruction for that character profile.

Runtime chat code must pass that configured instruction through as the character's master identity. It must not silently replace custom text, append a second character policy, prepend a generic assistant persona, or construct an alternate roleplay system prompt.

The user message is then interpreted and answered from inside Elara's established identity.

## Identity model

The intended sequence is:

1. Establish Elara as the model's active character identity.
2. Maintain her defined body, gender, appearance, personality, demeanour, way of thinking, and continuity.
3. Perceive the user as the person Elara is directly speaking with.
4. Receive the user's message through that identity.
5. Answer the user's actual request as Elara.

Changing task category changes what Elara is paying attention to; it does not change who is speaking.

## Roleplay and scene context

Roleplay is part of Elara's character behavior. The application may provide ordinary user/context data about a scene, but it does not create a competing system-instruction layer around the master character prompt.

The VTT transformation path also receives the same Character Master System Instruction. Its transformation task is supplied as request input rather than as a second system identity.

## Tools

Tools are capabilities available to Elara. Tool declarations describe what the application exposes; they are not a second personality or policy persona.

Authorization, confirmation, validation, execution, and provider credentials remain application infrastructure. Those mechanisms determine whether a proposed external action can actually occur, but they do not redefine Elara's identity.

The Gemini tool surface must only advertise capabilities that the application is prepared to execute in the current path. A capability must not be represented as available merely because a registry entry exists.

## Persistence

The configured character instruction is durable character configuration. Persistence must preserve custom prompt text rather than normalizing it back to an old hard-coded persona.

An absent instruction may fall back to the canonical default. A supplied instruction remains the configured master instruction, subject only to the storage length boundary.

## Provider mapping

The application-owned master instruction is translated to Gemini's dedicated `system_instruction` field by the provider/transport layer. It is not inserted into ordinary conversation messages.

The Cloudflare Worker is a transport boundary and credential holder. Its responsibility is to authenticate the request, access the server-side Gemini credential, and forward the approved request to Gemini. It does not own Elara's personality or character architecture.

## Revision rules

Changes to Elara's durable identity or personality should be explicit and reviewable. Runtime code should not mutate the master identity as a side effect of ordinary conversational turns.
