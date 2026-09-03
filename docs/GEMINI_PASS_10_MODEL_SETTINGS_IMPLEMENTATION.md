# Gemini Pass 10 — Model Registry and Settings

## Status

Implemented in the executable runtime.

## Runtime changes

The application now has one data-driven stable Gemini chat-model registry and one capability-driven settings engine. The Settings → Gemini surface selects among stable production text-output models and renders only settings represented by the active model contract.

Persisted settings are stored in the existing Dexie application database (schema v3). Each model keeps its own last-used configuration. Switching models revalidates the selected settings and removes incompatible values before they can reach the provider. Changes are persisted automatically; Reset restores the selected model's documented application defaults.

The provider request now receives an effective generation configuration through the canonical Interactions boundary. Provider-specific field translation remains inside `src/gemini/provider.ts`.

## Current model policy

Only stable production text-output chat models are surfaced. Preview, experimental, image, audio, Live, embedding, robotics, and agent-only endpoints are excluded. Gemini 3.1 Pro is therefore not surfaced because its current API model ID remains `gemini-3.1-pro-preview`.

The current stable registry includes Gemini 3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 2.5 Pro, 2.5 Flash, and 2.5 Flash-Lite.

## Sampling controls

Temperature, top-p, and top-k are intentionally absent from the companion-facing settings surface. Current Gemini 3 production guidance recommends removing these sampling parameters, and the Interactions generation contract used by Elara does not expose them as the model control surface used here. Model-specific thinking, output-token, seed, stop-sequence, and thought-summary controls are capability-gated instead.

## Verification

The settings engine has unit coverage for model defaults, incompatible thinking levels, output-token clamping, and valid setting normalization. CI must complete lint, typecheck, unit tests, build, E2E, and the final architecture gate before this pass is considered green.
