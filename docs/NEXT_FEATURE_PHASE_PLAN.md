# Elara — Next Feature Phase Plan

This document replaces the earlier informal 51–58 proposal with the corrected implementation contract for the next feature phase after the completed 50-prompt foundation.

## Scope and principles

The 50-prompt architectural foundation remains intact. This phase adds character configuration, artwork selection, chat background/presentation, roleplay context, restricted Markdown rendering, and conversation styling without creating duplicate provider, tool, OAuth, persistence, or security authorities.

The application has two fundamentally different instruction/configuration classes:

1. **Soft-coded character/master system prompt:** editable application character configuration defining identity, personality, behaviour, conversational style, roleplay conventions, truthfulness, and other character-level guidance.
2. **Hard-coded application tool contract:** tool schemas, tool registry, model-visible capabilities, usage rules, authorization boundaries, confirmation policy, and tool semantics remain application-owned code. They are not editable through the character prompt UI and are not exposed as arbitrary editable prompt text.

The editable master prompt therefore does not control what tools exist, what the model can call, OAuth scopes, confirmation policy, safety enforcement, or provider transport.

## Prompt 51 — Character identity and soft-coded master prompt

### Goal
Create the application-owned Character configuration surface and wire it into the existing canonical provider boundary without weakening hard-coded tool/security ownership.

### UI
Add a dedicated **Character** Settings section containing:

- AI name field, defaulting to Elara;
- editable multiline **Master System Prompt** editor;
- concise explanation of what the prompt controls;
- explicit explanation that tools, tool schemas, authorization, confirmation, provider transport, and other hard-coded application capabilities are outside this editor;
- reset-to-default character prompt action;
- unsaved-change protection where appropriate;
- character configuration save status.

### Data model
Introduce a typed character profile owned by application configuration/persistence, separate from conversation messages and separate from tool definitions. The model should include at minimum:

- `name`;
- `systemPrompt`;
- stable configuration metadata/versioning sufficient to know which character configuration produced a conversation turn.

### Provider integration
The canonical Gemini provider receives the effective application-owned character instruction as system/context input. Tool declarations and tool-use rules remain supplied by the hard-coded tool boundary exactly as defined by the application architecture.

### Acceptance criteria

- Changing the character prompt changes character behaviour without changing the registered tool set.
- Tool schemas cannot be edited from this screen.
- No OAuth secrets, provider credentials, tool endpoints, scope strings, or confirmation policy become editable prompt content.
- Existing conversations remain readable.
- Character settings persist across reloads.

## Prompt 52 — Character artwork mode: portrait OR landscape

### Goal
Allow exactly one primary character artwork mode for the main Elara presence.

### Choice model
The user chooses **one** of:

- **Portrait** — target composition approximately **4:5**.
- **Landscape** — target composition approximately **16:6** for the wide banner presentation.

These are alternatives, not two simultaneously active character assets. Switching modes changes the active artwork presentation and its associated crop/focal positioning.

### UI
Add artwork controls under **Appearance**:

- artwork mode selector: Portrait / Landscape;
- image upload;
- replace image;
- remove image;
- preview frame matching the selected aspect ratio;
- crop/focal-position controls;
- concise guidance for each mode.

### Persistence
Keep source artwork and presentation metadata separate so crop/focal changes do not destroy the original asset.

### Presentation
Portrait mode may be used for compact character/avatar presentation. Landscape mode fills the primary upper banner and is intended to create the larger, dominant “looming” Elara presence described in the product direction.

### Acceptance criteria

- Exactly one artwork mode is active at a time.
- Portrait preview maintains a 4:5 composition.
- Landscape preview maintains the wide banner composition.
- Switching modes never silently invents an image; an unavailable mode reports that it needs an image.
- Crop/focal metadata survives reloads.

## Prompt 53 — Chat background and appearance system

### Goal
Add a dedicated chat background configuration without coupling it to character identity.

### Chat background
Support a **9:16-oriented chat background presentation** suitable for Android portrait, with responsive adaptation to the real viewport.

Provide a background source selector capable of supporting:

- plain/solid background;
- gradient background;
- user-supplied image background;
- optional preset backgrounds later.

Provide readability controls such as:

- background opacity;
- contrast/readability overlay strength;
- blur amount where applicable.

Backgrounds must never interfere with conversation hit targets, text contrast, scrolling, or keyboard handling.

### Ownership
Chat background belongs to Appearance/Chat Presentation. It is not part of the character system prompt.

### Acceptance criteria

- Background persists locally.
- Conversation remains readable over every supported background.
- No remote arbitrary HTML/CSS execution is introduced.
- Default remains conservative and performant on Android.

## Prompt 54 — Roleplay mode and creative-context state

### Goal
Introduce an explicit roleplay mode as structured application state.

### Behaviour
Provide a toggle:

**Roleplay Mode — Off / On**

When OFF, roleplay-only controls remain collapsed/hidden and the normal chat configuration applies.

When ON, the roleplay configuration section reveals itself beneath the toggle.

### Creative-context instruction
When enabled, the application adds a dedicated roleplay/creative-context instruction layer to the canonical character context. It should clearly establish that the interaction is fictional/creative and that roleplay conventions apply.

This context does not replace or bypass:

- provider safety enforcement;
- hard-coded tool policies;
- authorization;
- confirmation requirements;
- the master character prompt.

No prompt text should claim that provider safety controls can be disabled or overridden by application wording.

### Roleplay defaults
The default roleplay presentation rules are:

- physical action and scene narration use italics;
- spoken dialogue uses ordinary text;
- the application maintains the fictional/meta context while Roleplay Mode is enabled;
- leaving Roleplay Mode returns to ordinary conversational presentation.

### Acceptance criteria

- Toggle state persists.
- Turning roleplay off hides its subordinate settings.
- Turning roleplay on reveals only roleplay-specific controls.
- Roleplay context is structured data, not appended as visible user conversation text.
- Provider/tool/security boundaries remain intact.

## Prompt 55 — Roleplay environment configuration

### Goal
Give roleplay sessions an optional structured environment without building a full world engine.

### Settings
When Roleplay Mode is ON, reveal:

- environment preset selector;
- custom environment name;
- custom environment description;
- optional time of day;
- optional weather;
- optional atmosphere/mood.

Initial presets may include examples such as:

- House;
- Bedroom;
- Living room;
- Office;
- Poolside;
- Outdoors;
- Custom.

### Runtime
The effective environment becomes structured roleplay context supplied through the application-owned instruction/context layer. It is not stored as fake assistant messages and is not treated as ordinary user content.

### Acceptance criteria

- Environment settings are available only when roleplay is active.
- They persist across reloads.
- Changing an environment does not alter the hard-coded tool registry.
- The environment can be cleared cleanly.

## Prompt 56 — Restricted GitHub-Flavored Markdown renderer

### Goal
Provide useful Markdown rendering while intentionally excluding executable/raw HTML features.

### Supported subset

- emphasis: `*text*`;
- strong emphasis: `**text**`;
- strong emphasis + italics: `***text***`;
- strikethrough: `~~text~~`;
- inline code: `` `code` ``;
- fenced code blocks for code/data;
- unordered lists;
- ordered lists;
- blockquotes;
- links with safe URL handling;
- horizontal rules.

### Intentionally unsupported

- raw HTML;
- inline event handlers;
- script content;
- arbitrary embedded SVG;
- iframe/embed/object content;
- arbitrary CSS/style attributes;
- executable or browser-active markup.

The renderer must sanitise and validate links and never pass arbitrary HTML from model/user text into the browser DOM.

### Roleplay formatting
The renderer must preserve the roleplay convention:

`*physical action / scene narration*`

while ordinary dialogue remains ordinary text.

### Acceptance criteria

- Markdown renders consistently for assistant and user content according to the product presentation rules.
- Raw HTML is rendered as text or otherwise safely neutralised, never executed.
- Links are restricted to approved safe schemes.
- Existing plain-text conversations remain visually correct.

## Prompt 57 — Markdown composer reference

### Goal
Make the supported Markdown discoverable directly from the composer.

### UI
Add a compact **Markdown (M)** composer control. On activation, show a small frosted reference popover containing the supported syntax and rendered examples.

Include at minimum:

- italic;
- bold;
- bold italic;
- strikethrough;
- inline code;
- code block;
- bullets;
- numbered list;
- quote;
- link;
- horizontal rule;
- roleplay action formatting.

Include a small documentation link to `docs/MARKDOWN_FORMAT.md`.

### Documentation
Create `docs/MARKDOWN_FORMAT.md` describing:

- the exact supported syntax;
- rendered examples;
- roleplay conventions;
- unsupported syntax;
- sanitisation rules;
- safe-link policy;
- parser/rendering boundaries;
- examples for assistant and user messages.

## Prompt 58 — Conversation presentation and colour controls

### Goal
Add controlled per-speaker visual customisation without changing the global application typography.

### Controls
Under Chat/Appearance settings provide separate controls for:

**Elara**

- assistant text colour;
- optional subtle assistant accent/glow.

**User**

- user text colour;
- user message surface/background colour;
- opacity;
- surface style: solid / frosted / soft gradient.

Use an Android-friendly colour picker where practical, plus a hexadecimal input for precise selection.

### Guardrails

- colours are validated as CSS-safe colour values or normalised to canonical hex/RGBA values;
- no arbitrary CSS text is accepted;
- preview changes are live but persistence remains application-owned;
- contrast/readability checks should prevent obviously unusable combinations or provide a warning.

### Acceptance criteria

- Assistant and user colours are independent.
- Typography family/size remains separately controlled.
- User bubble styling does not turn Elara into a symmetrical SMS-style bubble.
- Settings persist across reloads.

## Prompt 59 — Integration, migration, accessibility, and reliability

### Goal
Integrate the entire feature phase without weakening the completed architecture.

### Work

- add typed persistence models and migrations;
- wire Settings navigation for Character, Appearance, Chat, Roleplay, and Markdown-related controls without duplicating state authorities;
- integrate effective character + roleplay context into the canonical provider request path;
- ensure hard-coded tool schemas/registry remain untouched by editable prompt state;
- preserve OAuth, confirmation, diagnostics, security, and provider boundaries;
- add unit tests for configuration normalization and persistence;
- add renderer/security tests for Markdown sanitisation;
- add Playwright coverage for artwork mode switching, image configuration UI, prompt editing, roleplay expand/collapse, environment controls, Markdown reference, chat background, and colour controls;
- verify Android 9:16 behaviour and nested scrolling;
- ensure reduced-motion rules remain honoured;
- ensure the Settings header and left navigation remain static while only the selected category's detail content scrolls;
- run lint, typecheck, unit tests, build, Playwright, and the architecture reliability gate.

## Resulting Settings structure

The intended Settings navigation after this phase is:

- **Appearance** — theme/presentation, character artwork mode and artwork, chat background;
- **Character** — AI name and editable master system prompt;
- **Typography** — font family and text size;
- **Gemini** — model and generation settings already present;
- **Chat** — conversation presentation, speaker colours, message surface style, composer preferences;
- **Roleplay** — only visible/expanded while roleplay is active, or reachable through the Roleplay toggle in Chat depending on final navigation fit;
- **Lockbox** — protected API/security boundary already implemented.

The navigation remains static. The selected detail pane is the only scrollable region on mobile/Android.

## Phase completion gate

This feature phase is complete only when all nine prompts above are implemented, the hard-coded tool boundary remains separate from editable character configuration, no raw HTML is introduced into Markdown rendering, the one-active-artwork-mode rule is enforced, chat background is independent of character configuration, and all automated CI gates are green. Physical Android validation remains a separate real-device verification activity, as with the earlier UI plan.
