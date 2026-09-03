# Prompt 6 — Current Gemini Model Registry

## Status

Accepted as the live-model registry contract for Elara's Gemini chat surface.

## Registry principles

The registry is data, not scattered UI conditionals. A model entry is eligible for the Elara chat picker only when its current Google model documentation confirms that it is a supported text-output Gemini model appropriate for the product's Interactions path.

The registry is deliberately narrower than Google's complete model catalog. Image-generation-only, Live API-only, TTS, transcription, embeddings, robotics, and other specialized models are not normal Elara chat models.

Preview models are allowed only when explicitly marked `preview`; they must never masquerade as stable production models.

Models reported by Google as shut down or deprecated without an active safe endpoint are excluded from the active registry. They can be referenced only by deprecation documentation when explaining migration history.

## Live verification snapshot — 2026-09-03

Google's current model catalog lists these Gemini 3 chat-capable families as active: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, and `gemini-3.1-pro-preview`, with `gemini-3-flash-preview` also still listed as a preview model. Google's catalog separately lists specialized image, live, TTS, transcription, video, and embedding variants; those are not part of the initial text-chat registry. citeturn247763search1turn987008search8turn723676search1

`gemini-3.8-flash` is the newest stable Flash model, released September 2, 2026. Its documented input types include text, image, video, audio, and PDF; output is text; context is 1,048,576 input tokens with 65,536 maximum output tokens; thinking levels are `low`, `medium`, and `high`, and `minimal` is explicitly unsupported. It supports function calling, search grounding, code execution, file search, structured outputs, and other documented capabilities. citeturn247763search0

`gemini-3.7-flash` is stable and documented with 1M context, 64K maximum output, and `low`/`medium`/`high` thinking levels. Google recommends it for complex coding, agentic workflows, and reliable multi-step execution. citeturn247763search4

`gemini-3.6-flash`, `gemini-3.5-flash`, and `gemini-3.5-flash-lite` are stable Gemini 3-family chat models. Google documents Gemini 3.5 Flash as GA/stable with 1M context and 65K maximum output, while the current catalog identifies 3.6 Flash as a stable previous-generation Flash model and 3.5 Flash-Lite as a cost/latency-oriented stable model. citeturn987008search1turn987008search6turn987008search12

`gemini-3.1-flash-lite` is stable and is the current replacement for its shut-down preview predecessor. Google lists a 1,048,576-token input limit, text/image/video/audio/PDF input, text output, tool support, structured outputs, and thinking support. citeturn987008search10turn247763search5

`gemini-3.1-pro-preview` remains an active preview model with 1,048,576 input tokens, 65,536 maximum output tokens, text/image/video/audio/PDF input, text output, function calling, search grounding, structured outputs, and thinking support. Its exact preview status must stay visible in UI metadata. citeturn723676search1

`gemini-3-flash-preview` remains listed as a preview model with 1,048,576 input tokens, 65,536 maximum output tokens, multimodal input including PDF, text output, tool support, structured outputs, and thinking. It is kept in the registry only as a preview entry rather than the default stable choice. citeturn987008search8

The stable Gemini 2.5 family remains available in Google's current catalog: `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite`. The older dated preview variants are not registered as active models because Google documents them as shut down. Gemini 2.5 uses `thinking_budget`/the corresponding SDK representation rather than Gemini 3's `thinking_level`. citeturn247763search1turn723676search3turn723676search2turn987008search5

## Active registry

| ID | Status | Family | I/O for Elara chat | Thinking | Registry role |
|---|---|---|---|---|---|
| `gemini-3.8-flash` | stable | 3.8 | multimodal input → text | low / medium / high | preferred current Flash default |
| `gemini-3.7-flash` | stable | 3.7 | multimodal input → text | low / medium / high | high-quality Flash alternative |
| `gemini-3.6-flash` | stable | 3.6 | multimodal input → text | model-defined Gemini 3 levels | stable Flash alternative |
| `gemini-3.5-flash` | stable | 3.5 | multimodal input → text | minimal / low / medium / high | stable legacy-family option |
| `gemini-3.5-flash-lite` | stable | 3.5 Lite | multimodal input → text | minimal / low / medium / high | low-cost/high-throughput option |
| `gemini-3.1-flash-lite` | stable | 3.1 Lite | multimodal input → text | model-defined Gemini 3 levels | efficiency option |
| `gemini-3.1-pro-preview` | preview | 3.1 Pro | multimodal input → text | low / medium / high | premium preview option |
| `gemini-3-flash-preview` | preview | 3 Flash | multimodal input → text | Gemini 3 levels | compatibility/preview option |
| `gemini-2.5-pro` | stable | 2.5 Pro | multimodal input → text | thinking budget | older reasoning option |
| `gemini-2.5-flash` | stable | 2.5 Flash | multimodal input → text | thinking budget | older balanced option |
| `gemini-2.5-flash-lite` | stable | 2.5 Lite | multimodal input → text | thinking budget | older efficiency option |

The table is intentionally a concise application registry. Prompt 22/24 work may later add pricing/latency observations and automated verification, but those are not required to make model selection safe today.

## Capability record shape

Every implementation entry should be representable by a small data object with at least:

```ts
interface GeminiModelRegistryEntry {
  id: string;
  displayName: string;
  status: 'stable' | 'preview';
  family: string;
  inputModalities: Array<'text' | 'image' | 'video' | 'audio' | 'pdf'>;
  outputModalities: Array<'text'>;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  thinking:
    | { kind: 'level'; levels: Array<'minimal' | 'low' | 'medium' | 'high'>; default?: string }
    | { kind: 'budget'; min: number; max: number; dynamicValue?: number };
  supports: {
    functionCalling: boolean;
    structuredOutputs: boolean;
    searchGrounding: boolean;
    codeExecution: boolean;
    fileSearch: boolean;
  };
}
```

This is the conceptual registry contract. Prompt 7 turns its capability metadata into the settings-engine rules that determine which fields the provider can actually emit.

## Exclusions confirmed during this prompt

The registry does not include:

- `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, or `gemini-2.5-flash-image` as chat defaults because they are image-generation/editing models;
- `gemini-3.1-flash-live-preview` or other Live API endpoints because they use a different real-time session boundary;
- TTS or transcription models;
- embedding models;
- robotics-specific models;
- shut-down dated preview aliases such as `gemini-2.5-flash-preview-09-2025`, `gemini-2.5-flash-lite-preview-09-2025`, `gemini-3-pro-preview`, or `gemini-3.1-flash-lite-preview`. Google documents those endpoints as shut down. citeturn723676search3turn723676search2turn723676search0turn987008search0

## Default selection policy

Until user preferences are implemented, the registry's preferred current default is `gemini-3.8-flash` because it is Google's newest stable Flash release and is explicitly positioned for long-horizon engineering, agentic workflows, and complex tasks. This is a product default, not a promise that every future model release will automatically replace it. citeturn247763search0

The picker must display status clearly for preview models and must not silently substitute one model for another when an explicitly selected ID becomes invalid. An unavailable/deprecated model is a diagnostic condition and a deliberate model-selection failure, not permission to fall back to a different Gemini API path.

## Prompt 6 completion criterion

The repository now has a live-verified model registry definition covering the supported Gemini chat families, model lifecycle status, major input/output capabilities, thinking configuration family, and active/dead endpoint policy. UI and request-building work can consume this registry rather than hard-coding model assumptions.