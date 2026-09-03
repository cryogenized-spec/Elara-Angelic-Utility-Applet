# Prompt 14 — Mobile-First Shell

## Status

Accepted as the shell contract for the eventual React/Vite implementation.

## Primary target

Android portrait is the canonical layout. The first usable viewport is a narrow phone width; desktop is a responsive adaptation rather than the design source of truth.

The shell must provide three stable regions:

1. app/header region;
2. scrollable conversation region;
3. composer/action region.

The shell owns layout and interaction framing only. It does not own Gemini calls, persistence, OAuth, tool execution, or message business rules.

## Layout invariants

Use a full-height app surface based on the visual viewport, not a fixed desktop-centric height. The conversation region must be the only primary scrolling surface.

The composer remains reachable when the software keyboard is open. Bottom spacing must account for safe-area insets using standards-based CSS environment values such as `env(safe-area-inset-bottom)`. citeturn339022search3turn339022search9

Avoid nested independently scrolling panels on the phone layout. A message list should not fight the page for scroll ownership.

## Responsive behavior

The mobile breakpoint is the baseline. Wider viewports progressively add horizontal breathing room and optional side-panel capability without changing the core chat flow.

Do not duplicate the chat implementation for mobile and desktop. Shared components receive layout tokens/constraints; responsive CSS determines presentation.

## Interaction rules

Touch targets must be comfortably tappable, controls must remain visible above the keyboard, and focus must be deterministic. The composer must not jump unpredictably when the viewport changes because of the IME.

The shell provides slots for future model/settings controls, attachment affordances, portrait, diagnostics and navigation, but does not import their implementations directly unless the feature is actually enabled.

## Accessibility

The shell must preserve logical landmark structure, visible focus, accessible names for icon-only actions, sufficient contrast, reduced-motion compatibility, and keyboard navigation on desktop.

## Character portrait

Portrait presentation is a shell concern; portrait ownership/state remains in the character/appearance domains. The shell receives a portrait view model and does not load or persist portrait files itself.

## Future tools and Workspace

Tool activity must render inside the same conversation surface rather than creating a second execution UI. Workspace integrations must not introduce their own navigation or shell runtime. The shell only presents application state exposed by the relevant feature boundary.

## Future memory/notes

Memory retrieval is not a shell concern. Retrieved context is invisible infrastructure unless a later product feature explicitly exposes memory management to the user.

## PWA/mobile constraints

The shell must tolerate installed-PWA display modes and browser chrome changes. Safe-area and dynamic viewport behavior are progressive enhancements; failure to expose a safe-area variable must degrade to ordinary padding.

## Prompt 14 completion criterion

The application has an explicit Android-portrait-first shell contract with one conversation scroll surface, keyboard-safe composer placement, safe-area handling, shared responsive components, and strict separation from provider/state concerns.
