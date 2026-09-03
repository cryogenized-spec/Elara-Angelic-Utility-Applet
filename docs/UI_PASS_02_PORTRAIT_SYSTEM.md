# UI Pass 2 — Elara Portrait System

## Scope

Pass 2 establishes the portrait/banner presentation boundary for the Android-first 9:16 shell.

## Implemented

- Dedicated `PortraitBanner` React component.
- Portrait artwork area uses a 4:5 internal artwork ratio inside a wider landscape banner.
- Three presentation-scale states are represented by the `PortraitScale` type: `1`, `2`, and `3`.
- The current shell uses scale `2` as the design baseline.
- Opening the sidebar collapses the banner into a compact avatar-like presentation.
- Closing the sidebar restores the expanded banner immediately through the same component state boundary.
- Portrait visual styling is isolated in `portrait-banner.css` rather than embedded in `App.tsx`.
- Placeholder geometry remains intentionally owned by the presentation layer; canonical Elara artwork can replace it later without changing chat, character, memory, OAuth, or provider logic.

## Design decisions

The application body remains a canonical 9:16 mobile composition. The portrait artwork is not itself the screen aspect ratio: it is a separate 4:5 art asset placed inside a wide banner container.

The portrait should create presence without dominating the conversation. Scale therefore changes the art presentation while leaving the surrounding shell geometry stable.

Sidebar expansion is treated as a presentation state. It does not destroy the banner or recreate the conversation; it transitions the same portrait component between expanded and collapsed states.

## Verification

Playwright covers the portrait placeholder visibility and the sidebar-driven collapsed/restored state. Typecheck, lint, unit tests, build, E2E, and the repository reliability gate remain required before Pass 2 is considered complete.

## Follow-up

Pass 3 will move the main effort into the conversation surface: AI-dominant message presentation, message grouping, empty state, and the expandable execution/reasoning-summary display.
