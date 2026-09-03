# Prompt 7 — Gemini Settings Engine

## Status

Accepted as the capability-driven settings contract for Gemini model selection and request construction.

## Goal

The UI must not ask the provider what a setting means at render time, and it must not discover support by trying a request and waiting for a 400. The selected model's registry entry is the authority that determines which controls are visible and which fields may be emitted.

The settings engine has two stages:

```text
selected model registry entry
        ↓
settings capability profile
        ↓
validated user settings
        ↓
provider-normalized generation settings
```

A setting unavailable for the selected model has no representable enabled state. It is not merely hidden with a default value that can accidentally leak into the request.

## Current Gemini API facts verified for Prompt 7

The current Interactions API accepts model configuration including `generation_config`, and its current API surface also defines top-level interaction controls such as `thinking_level`/`thinking_summaries` in the published API schema. The JavaScript SDK's current types expose a `GenerationConfig` with fields including `maxOutputTokens`, `seed`, `stopSequences`, `temperature`, `topK`, `topP`, and `thinkingConfig`; Interactions examples use the API's `generation_config` structure. The provider translator, not the settings UI, owns any SDK/API naming conversion. citeturn527666search1turn527666search2turn104172search0

Google's current Gemini 3 guidance says thinking is controlled with `thinking_level`, while Gemini 2.5 uses `thinking_budget`. Current documentation specifically says Gemini 3.8/3.7 Flash do not support `minimal`, while Gemini 3.6/3.5 Flash and 3.5/3.1 Flash-Lite do. citeturn659057search3turn987008search7

Google's June 2026 release notes state that the sampling parameters `temperature`, `top_p`, and `top_k` are now deprecated for the newer Gemini 3-generation models. The settings engine therefore treats those as capability-controlled legacy sampling controls rather than universal chat controls. A control only appears when the selected model's current capability record explicitly permits it. citeturn104172search4

## Settings categories

### Thinking

Thinking is a first-class product setting, but its control model differs by model family.

For Gemini 3 models, represent it as a finite level selection:

```ts
type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
```

The model registry supplies the allowed subset. For example, current Gemini 3.8 Flash supports `low`, `medium`, and `high`; `minimal` must not be emitted because Google documents it as unsupported. Gemini 3.7 Flash follows the same restriction. Current documentation lists `minimal`, `low`, `medium`, and `high` for several other Gemini 3 models. citeturn247763search0turn247763search4turn987008search7

For Gemini 2.5 models, represent thinking with a bounded numeric budget plus a product-level automatic option. The provider translator maps this to the current API/SDK representation. Google documents `0` as disabled for models that permit disabling, `-1` as automatic/dynamic, and model-specific ranges otherwise. `gemini-2.5-pro` cannot disable thinking. citeturn987008search5turn104172search2

The UI must not expose a fake “off” control for a model whose documented minimum cannot disable thinking.

### Thought summaries

Thought summaries are separate from thinking itself. A model may think without returning a text summary. The settings engine may expose a “show thinking summary” preference only when the Interactions capability profile supports thought summaries and the product has a valid normalized representation for them.

Google documents that Interactions expose thoughts as dedicated `thought` steps and that summaries can be absent/empty. Therefore `includeThoughts`/summary configuration must never be treated as a guarantee that visible text will arrive. citeturn659057search2turn659057search3

### Maximum output tokens

`max_output_tokens`/the SDK's corresponding field is capability-controlled by the model's documented output token limit. The UI should offer a product-friendly range capped by the active model's known limit; it must never emit a value above the registry limit. citeturn527666search2turn104172search0

If a model has a lower or future-different output limit, the same engine narrows the control automatically.

### Sampling controls

`temperature`, `top_p`, and `top_k` are not universal Elara settings. They are only representable when the selected model registry entry explicitly declares current support.

For newer Gemini 3 models where Google documents these sampling parameters as deprecated, they are omitted from the normal Elara settings UI and are not emitted by default. This prevents an old UI preference from becoming an invalid provider request. citeturn104172search4

For legacy Gemini 2.5 support, the engine may retain supported sampling controls only after the live model capability entry confirms them. The engine must not infer support merely because the generic SDK type contains a field.

### Seed

`seed` is an optional technical control. It is not a normal user-facing companion setting in the first UI. The engine may represent it for controlled tests or developer diagnostics, but it must remain capability-gated and excluded from ordinary user settings unless a concrete product requirement is introduced. The current SDK type supports `seed`. citeturn104172search0

### Stop sequences

`stop_sequences` are likewise capability-controlled technical settings and are not part of the initial companion-facing control set. They can exist in the normalized provider contract later without appearing in the default UI.

## Canonical normalized user settings

The application-facing settings model should be intentionally smaller than the SDK's generic `GenerationConfig`:

```ts
interface GeminiUserSettings {
  thinking?:
    | { kind: 'level'; value: ThinkingLevel }
    | { kind: 'budget'; value: number | 'auto' };
  thoughtSummaries?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}
```

This is an architectural shape. Prompt 28 will define the final validated request schema and exact serialization rules.

The settings engine also produces a capability profile:

```ts
interface GeminiSettingsCapabilities {
  thinking: false
    | { kind: 'level'; levels: ThinkingLevel[]; default?: ThinkingLevel }
    | { kind: 'budget'; min: number; max: number; supportsAuto: boolean; canDisable: boolean };
  thoughtSummaries: boolean;
  maxOutputTokens?: { max: number };
  sampling: {
    temperature: boolean;
    topP: boolean;
    topK: boolean;
  };
}
```

The engine returns a sanitized effective settings object, never the raw user preference object. When the selected model changes, the engine revalidates the existing preferences against the new capability profile.

## Model-switch behavior

Changing models is allowed. Carrying incompatible settings across the switch is not.

Example:

```text
User selects Gemini 3.8 Flash
→ thinking options = low / medium / high
→ minimal disappears
→ legacy sampling controls stay absent

User switches to a model that supports minimal
→ minimal becomes available

User switches from Gemini 2.5 to Gemini 3
→ budget setting is converted to the closest valid product default/level
→ stale 2.5-only fields are removed before request construction
```

A model switch never causes the provider to receive stale settings from the previous model.

## Default policy

Defaults come from the model registry where Google's model documentation provides a model-specific default. Otherwise Elara uses a conservative product default recorded by the settings engine.

The engine must distinguish:

- omitted setting = use provider/model default;
- explicit setting = send only if supported;
- unsupported setting = remove before provider translation.

This distinction is important because sending an unnecessary field can change model behavior or cause a provider validation failure.

## Validation and invariants

The settings engine must enforce these invariants before a request reaches `gemini/`:

1. Every setting references an active model registry entry.
2. Every thinking value belongs to that model's allowed set/range.
3. A budget cannot be supplied to a level-based model, and a level cannot be supplied to a budget-based model.
4. A disabled-thought state cannot be represented for a model that cannot disable thinking.
5. `maxOutputTokens` cannot exceed the model's known limit.
6. Deprecated sampling controls cannot appear unless the live registry explicitly marks them supported.
7. Unknown setting keys are rejected or stripped at the validation boundary.
8. No settings object contains provider-specific SDK objects.
9. The resulting request can contain only fields the selected model is capable of receiving.
10. Settings validation is deterministic and side-effect free.

Zod is the default validator for external/user-provided settings when runtime validation is required.

## Ownership

The settings engine belongs between model registry data and application chat state. It does not construct `GoogleGenAI`, make network calls, or inspect React components.

```text
model registry → settings engine → normalized request → Gemini provider
```

The UI consumes the engine's capability view and effective settings. It never decides support through model-name string matching spread across components.

## Prompt 7 completion criterion

Model selection now has a documented, deterministic capability gate for thinking, thought summaries, output limits, and sampling controls. Unsupported settings have no path into the canonical Gemini provider, while the provider remains responsible for translating normalized settings into the exact current Interactions SDK/API shape.