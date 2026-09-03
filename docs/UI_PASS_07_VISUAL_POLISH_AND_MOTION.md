# UI Pass 07 — Visual polish + motion

## Status
Implementation pushed to `main`; CI is the completion gate.

## Scope

Pass 7 refines the existing Android-first UI without changing application ownership boundaries. The quick-action rail receives clearer active/focus/pressed states, a stronger but restrained hover treatment, and touch-target sizing that increases to at least 44 CSS pixels on coarse pointers. The Workspace close control is also 40×40 pixels, keeping the control comfortably touchable while preserving the compact visual language.

The Elara portrait banner now explicitly disables its transition effects when the user requests reduced motion. Workspace action surfaces already use the same reduced-motion media query, so the visual system does not rely on JavaScript preference detection for this behavior.

The implementation keeps `backdrop-filter` as progressive enhancement: supported browsers render the glass blur while the existing translucent background remains the functional fallback. Current MDN compatibility guidance treats `backdrop-filter` as Baseline 2024, so this is appropriate for the modern Android/PWA target while retaining graceful rendering on older engines. citeturn520817search0

Motion follows the platform accessibility preference rather than introducing a custom motion setting. MDN documents `prefers-reduced-motion` as widely available and recommends removing, reducing, or replacing non-essential motion when the preference is enabled. Android 9+ exposes the corresponding accessibility preference at the OS level. citeturn520817search1

Focus styling remains explicit through `:focus-visible`; current MDN guidance recommends visible focus indicators for keyboard and assistive-technology users and notes that button focus styling should retain adequate contrast. citeturn520817search2turn520817search8

## Files

- `src/app/quick-action-rail.css` — active/focus/pressed treatment, touch sizing and reduced-motion behavior.
- `src/app/components/portrait-banner.css` — reduced-motion transition suppression.
- `e2e/smoke.spec.ts` — stabilized quick-action locators for CI reliability.

## Boundary decisions

No provider, OAuth, persistence, or conversation semantics changed in this pass. Visual behavior remains a presentation concern. No new settings state or JavaScript motion manager was introduced.

## Validation

The existing Playwright Workspace test continues to prove that quick actions open dedicated surfaces without adding chat messages. The CI suite remains authoritative for the combined Pass 6 + Pass 7 changes. The touch and reduced-motion CSS are deterministic and use standards-based media queries rather than device-specific hard-coded dimensions.

## Next

Pass 8 is deployed physical-device reliability validation. It should exercise Android portrait hardware, keyboard open/close, sidebar plus keyboard, long conversations, portrait scaling, Settings navigation, and degraded/offline font loading.
