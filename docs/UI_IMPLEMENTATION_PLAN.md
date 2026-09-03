# Elara UI implementation plan

This document is the implementation contract for the visual and interaction layer established after the clean-room architecture work. The canonical UI body is a **9:16 Android portrait composition**. Other viewport sizes adapt from this reference; desktop is secondary.

## Product composition

The main chat screen is conversation-first but built around Elara's presence:

`safe area → left control spine → Elara landscape banner → horizontal quick-action rail → conversation → keyboard-aware composer`

The Elara banner uses approximately 4:5 artwork inside a wider landscape presentation area. The artwork must remain visually subordinate to readable conversation content. Portrait scale is a presentation setting and must not be coupled to character/personality logic.

The hamburger control opens a **sidebar menu** over the chat. The sidebar contains conversation threads and utility navigation. Opening a utility surface should preserve the ambient Elara layer where practical; the large banner can collapse to a compact avatar and return to its prior scale when the surface closes.

## Conversation threads

A thread is a first-class conversation object. Once a new thread receives its first meaningful user message, the application will request a short AI-generated theme/title of approximately **3–10 words**. The title is metadata, not a hidden prompt and not visible user content.

Thread generation, persistence, selection, rename/archive/delete behavior, and retrieval remain application concerns. The UI must not directly own persistence internals.

## Quick-action rail

The top utility rail is horizontally scrollable and deliberately does not squeeze every action into one row. Calendar, Tasks, Gmail, and other configured Workspace actions are quick execution surfaces.

A quick action must not inject a canned visible message such as "Show my calendar" into chat. The action dispatches an application capability/service and presents the result through its own surface or structured UI. The shortcut order and enabled actions will later be configurable in Settings.

## Sidebar menu

The left sidebar is a glass/frosted overlay that slides in from the left. It exposes recent/convenient conversation threads and a Settings entry at the bottom. The sidebar must remain independently testable and must not contain provider, OAuth, or persistence implementation details.

## Settings screen

Settings is a **separate screen**, not a modal panel inside the chat.

The mobile layout is a vertically scrolling, left-bound settings carousel/navigation column with the selected category's detail view occupying the remaining screen space to the right. Categories are independently navigable and must not force a full page reload.

The Settings surface is the home for:

- appearance and ambient visual controls;
- typography/font selection;
- conversation/startup behavior;
- the **API Lockbox** entry point and credential/security state;
- later OAuth, diagnostics, accessibility, and other application settings as their roadmap prompts land.

The API Lockbox belongs in Settings as a dedicated security surface, but secrets remain outside presentational components and are never included in model-visible schemas or debug output.

## Typography and Google Fonts

The application will provide a small curated set of Google-hosted UI font options rather than bundling font files into the repository. The initial candidates are **Inter**, **Manrope**, and **Outfit**.

The current Google Fonts CSS2 API supports requesting one or more families, explicit weight sets, and `display=swap`. The recommended wiring for Elara is a runtime stylesheet link to the CSS2 endpoint for the selected family, with a normal system sans-serif fallback. The browser downloads the stylesheet and then downloads the appropriate font resource; normal browser HTTP caching is responsible for reuse. citeturn765993search1turn765993search2

The application should not pretend this is equivalent to bundling local font files. A browser cache is not an offline guarantee. The service worker/offline strategy must therefore treat remote Google font availability as an enhancement and preserve a usable system-font fallback. `font-display: swap` is selected so text remains visible while the font loads. citeturn533491search1turn533491search7

When this surface is completed, font selection should load only the chosen family/weights needed by the UI. Google explicitly recommends requesting only the styles/weights actually used to reduce latency and payload size. citeturn765993search1

## Vector graphics

Interface icons are repository-owned SVG vectors or cleanly sourced open-source vector paths. The application must not depend on rasterized UI icons or remote image URLs for core controls. SVGs should use small, predictable path sets, explicit `viewBox` dimensions, accessible labels through surrounding controls, and consistent stroke geometry.

The character portrait is separate artwork, not a UI vector requirement.

## Composer and Android keyboard behavior

The composer is designed for Android portrait first. It must remain above the software keyboard, and the conversation must maintain visibility of the latest relevant message while typing.

Implementation will use modern viewport/inset behavior rather than fixed keyboard-height offsets. The UI should react to the visual viewport/IME state, preserve focus, avoid layout jumps, and keep scrolling intentional. This behavior is validated on physical Android/PWA testing as a separate reliability pass.

## Motion and visual language

The palette is predominantly black/deep-charcoal with white typography. Blue and pink are restrained accent/piping colors. Glass and frosted surfaces provide depth without turning the app into a neon dashboard.

Motion should be short and purposeful: sidebar slide, portrait collapse/restore, tool-rail interactions, focus states, and lightweight state transitions. Motion must never obscure the conversation or create input lag.

## Eight implementation passes

### Pass 1 — UI foundation and geometry

Establish the 9:16 Android reference geometry, design tokens, spacing, radii, typography hierarchy, glass surface primitives, safe-area behavior, layering/z-index, and core responsive rules. Establish the initial Elara banner, sidebar shell, quick-action rail, conversation area, and composer frame using clean modular React components.

### Pass 2 — Elara banner / portrait system

Implement the landscape portrait banner, 1×–3× presentation scale, collapse-to-avatar behavior, restoration, configurable background hooks, and independent presentation-layer boundaries.

### Pass 3 — Conversation surface

Implement the AI-dominant message presentation, empty chat, message grouping, timestamps, thinking/execution summary display, expand/collapse interaction, and conversation scroll behavior.

### Pass 4 — Android composer + keyboard behavior

Implement multiline composer, send, attachment entry points, voice input entry point, focus management, visual-viewport-aware IME handling, latest-message visibility, and robust scrolling on Android/PWA.

### Pass 5 — Sidebar menu + chat threads

Implement persisted threads, first-message theme generation contract, 3–10 word AI titles, thread selection, new chat, rename/archive/delete semantics, sidebar search where appropriate, and state restoration.

### Pass 6 — Quick-action rail

Implement configurable quick tools and action surfaces for Calendar, Tasks, Gmail, and future Workspace capabilities without hidden chat prompts. Keep execution in application services.

### Pass 7 — Visual polish + motion

Tune the glass treatment, piping, typography, portrait composition, focus/pressed states, animations, accessibility contrast, touch targets, and perceived responsiveness.

### Pass 8 — Physical-device reliability

Test the deployed PWA on Android portrait devices and representative viewport sizes. Exercise keyboard open/close, sidebar + keyboard interaction, long conversation scroll, portrait scaling, settings navigation, offline/slow-font conditions, and no-obscuration guarantees.

## Engineering practices

Keep presentation, application orchestration, provider access, persistence, OAuth, security, diagnostics, and character prompting in separate modules. Components should be small and accept explicit data/callbacks rather than reaching into global services.

Prefer typed contracts and narrow interfaces. Validate external data at trust boundaries. Avoid `any` and broad type assertions. Use accessible semantic controls, keyboard/focus handling, reduced-motion support, and minimum touch targets appropriate to Android.

Do not hide business logic inside CSS, React effects, or event handlers. Keep state transitions explicit. Avoid giant conditional render functions; split feature surfaces when responsibilities diverge.

Do not hardcode browser/keyboard dimensions. Do not ship large raster assets for interface chrome. Do not couple portrait, theme, settings, memory, or Workspace state to the chat component.

Every pass should leave lint, typecheck, unit tests, build, and applicable Playwright checks green before being called complete. CI remains authoritative until real physical-device validation is performed.

## Current pass state

Pass 1 is the first implementation target. The initial foundation should already include the 9:16 body geometry, left sidebar control, Elara banner treatment, horizontally scrolling quick-action rail, modular conversation surface, Android-oriented composer frame, and a separate Settings screen with the API Lockbox home and Google-font selection foundation.
