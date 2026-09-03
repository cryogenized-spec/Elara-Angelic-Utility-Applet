# Prompt 6 — Current Gemini Model Registry

Status: accepted.

The registry is data, not scattered UI conditionals. Only active Gemini text-output models appropriate for Elara chat belong here; specialized image, Live API, TTS, transcription, embedding, robotics, and shut-down preview models do not.

Live snapshot checked 2026-09-03 includes current active chat families such as `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, plus stable Gemini 2.5 Pro/Flash/Flash-Lite. Lifecycle state must remain explicit.

Each model entry supplies identity, lifecycle, supported input/output modalities, token ceilings when verified, thinking configuration family, and major tool/capability flags. Gemini 3 thinking is modeled as `thinking_level`; Gemini 2.5 uses the budget-style thinking control. Model-specific capabilities determine what later UI/request code may emit.

The preferred current stable Flash default is `gemini-3.8-flash`; this is a product default rather than an automatic replacement rule for future releases.

The registry must remain extensible without changing consumers when Google adds or removes models. A model becoming unavailable is a model-selection/diagnostic condition, not permission to switch to a different Gemini API path.
