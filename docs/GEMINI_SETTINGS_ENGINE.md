# Prompt 7 — Gemini Settings Engine

## Status

Accepted as the capability-driven settings contract.

## Goal

The selected model's registry entry determines which controls are visible and which request fields may be emitted. Unsupported settings have no representable enabled state.

## Model-aware controls

Gemini 3 thinking is represented by `minimal | low | medium | high`, narrowed to the exact model's supported subset. Gemini 2.5 thinking is represented by a bounded numeric budget/automatic value. Thought summaries are separate from thinking and only enable when supported. Output-token controls are capped by the active model limit. Sampling controls (`temperature`, `top_p`, `top_k`) are not universal and are emitted only when the live registry says they are supported. Seed/stop sequences remain technical fields, not default companion-facing controls.

## Effective settings

The engine transforms:

`selected model → capability profile → validated user settings → effective settings → normalized request`

A model switch revalidates or removes incompatible preferences; stale fields never survive into the next provider request. Omitted settings mean provider/model default; explicit settings are emitted only when supported.

## Invariants

No unknown settings keys; no level/budget mismatch; no unsupported thinking mode; no output-token overflow; no deprecated sampling field unless explicitly supported; no SDK objects in application state; deterministic, side-effect-free validation.

## Ownership

The settings engine owns capability evaluation and effective settings. It does not make network calls, construct `GoogleGenAI`, own UI state, or persist data. Prompt 28 later freezes the exact validated request schema.