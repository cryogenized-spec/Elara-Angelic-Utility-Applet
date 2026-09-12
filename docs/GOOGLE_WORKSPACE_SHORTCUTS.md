# Google Workspace Shortcuts — Design Contract

The top quick-action rail should be a fast launcher for saved Google Workspace agent recipes, not a list of stored prompts. A recipe has a friendly label, service/capability requirements, user intent, and a generated execution plan. The execution plan cannot grant OAuth scopes, invent tools, introduce arbitrary URLs, or bypass confirmation.

## UI contract

The top rail is a single consolidated Workspace trigger. Tapping it opens a services flyout to its right listing Calendar, Tasks, and Gmail; as Drive, Docs, and Sheets become production-ready they should join the same flyout without changing the interaction model.

The trigger is a **disclosure**, not a desktop application menu: it owns `aria-expanded`/`aria-controls`, the flyout is a labelled group, each service row is a disclosure button for its shortcut group, and every shortcut is an ordinary button. Tab/Enter/Space and Escape therefore behave exactly as the visible interaction implies. The flyout closes on outside pointerdown and on Escape (returning focus to the trigger), and it unmounts on close so a reopened flyout always starts collapsed.

Geometry: the flyout opens to the right of the trigger and is clamped to the viewport (`min-width`/`max-width` share the same `100vw` budget so `min-width` can never defeat the clamp). Below ~400px it reuses the fallback position below the trigger, where the full viewport width is available. At no width does it obscure the composer: its height is capped and it scrolls internally.

Tapping a service expands a compact vertically scrollable chooser of that service's saved recipes. Selecting a recipe does not append a synthetic user message to the visible conversation. It creates an internal agent-task request; the final assistant response appears normally in the conversation.

> Correction (2026-09-12): the paragraph above previously described selecting a recipe as creating "an internal agent-task request" with no synthetic user message in the conversation. That behaviour was implemented in `App.tsx` as a synthesized prompt — a turn the user never wrote, streamed to the provider with no persisted transcript message — which violated the standing rule that hidden chat prompts must not implement UI shortcuts, and left the provider holding input the transcript never recorded. Selecting a recipe now places the recipe's saved intent into the composer as the user's own visible, editable draft; sending it is an ordinary message turn, so the provider input and the transcript are the same text by construction. The per-recipe restricted tool set was dropped with it: a prefilled message runs with the standard tool set exactly like typed text.

The exact small-row pixel height is a visual tuning value, not a data-model contract. Keep the chooser touch-friendly and keyboard accessible.

## Settings contract

Put this under Settings → Google → Workspace shortcuts rather than making each service a top-level setting.

A shortcut editor should support enabled/disabled state, ordering, rename, delete, built-in templates, and custom natural-language definitions. Users may inspect and regenerate the generated execution-plan summary, but low-level provider tool schemas remain hard-coded application architecture.

## Data model

Each saved shortcut contains a stable id, service id, display label, optional icon, user intent, source (`template` or `custom`), required application capabilities, generated execution-plan text, referenced named tools derived from the hard-coded registry, enabled state, order, and timestamps.

The generated plan is an instruction artifact, not a security authority. The centralized tool executor must independently enforce registry membership, argument validation, capability authorization, endpoint allow-lists, and read/write/destructive/send confirmation.

## Starter templates

Calendar: Current schedule; Next five hours; Today's events; Tomorrow's schedule; Important/upcoming events.

Tasks: Current tasks; Due today; Due tomorrow; Overdue tasks; High-priority tasks.

Gmail: Unread summary; Important recent mail; Recent mail from a sender; Messages requiring a reply.

These templates should expand only as corresponding production tools are wired.

## Custom shortcut compilation

For a custom shortcut, the user writes what they want in normal language. A constrained compiler model converts that intent into a structured execution plan using only the known application service/tool vocabulary. The compiler output must be validated before saving. Generated instructions are never allowed to change OAuth scopes or security policy.

## Hidden-task execution

A shortcut invocation must:

1. avoid adding a fake user message to visible conversation history;
2. pass the compiled task to Gemini as an internal task input;
3. expose only the allowed named Google functions for that task;
4. allow authorized read operations automatically;
5. preserve existing confirmation gates for writes, destructive actions, and sending;
6. keep credentials and raw tokens out of tool payloads and conversation persistence;
7. render the assistant's final result through the ordinary response surface.

## Implementation order

Finish the Gemini Interactions function-calling continuation loop first. Then expose the existing hard-coded Google tool registry as validated Gemini function declarations, route function calls through the centralized executor, add hidden internal-task invocation, add deterministic templates, add the constrained custom shortcut compiler, build Settings → Google → Workspace shortcuts, and finally replace the current demo quick-action surfaces with saved-recipe choosers.

Calendar, Tasks, and Gmail already have useful API shapes for the first template set: Calendar events can be listed with time bounds, Tasks exposes task-list/task listing with pagination/filtering, and Gmail messages can be searched, paged, and retrieved by id. citeturn519312search2turn519312search3turn519312search0turn519312search4

Do not call the shortcut system production-ready until the Gemini tool loop and live Google authorization boundary both work end to end. Gemini's current Interactions API supports custom function calling and the streaming `requires_action`/function-call flow needed for this design. citeturn571419search0turn571419search6
