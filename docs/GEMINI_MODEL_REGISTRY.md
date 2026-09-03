# Prompt 6 — Current Gemini Model Registry

Status: accepted.

The registry is data, not scattered UI conditionals. Only stable production Gemini text-output models appropriate for Elara chat belong here; preview, experimental, image, Live API, TTS, transcription, embedding, robotics, and agent-only endpoints do not.

Live snapshot checked 2026-09-03 includes the currently served stable chat models: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite`.

Gemini 3.1 Pro remains excluded from the user-facing production registry because Google's current model ID is `gemini-3.1-pro-preview`. Preview models remain outside the "fully served" product list even when an endpoint is still available.

Each model entry supplies identity, lifecycle, supported input/output modalities, token ceilings when verified, thinking configuration family, and major tool/capability flags. The executable registry models Gemini 3 thinking as `thinking_level`; current Interactions settings use the same generation-control vocabulary across the stable chat set. Model-specific capabilities determine which later UI/request code may emit.

The preferred current stable Flash default is `gemini-3.8-flash`; this is a product default rather than an automatic replacement rule for future releases.

The registry must remain extensible without changing consumers when Google adds or removes models. A model becoming unavailable is a model-selection/diagnostic condition, not permission to switch to a different Gemini API path.
