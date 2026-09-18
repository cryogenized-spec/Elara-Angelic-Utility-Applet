---
id: SYS-UI
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: application presentation and interaction
paths: [src/app, src/ui, src/main.tsx]
keywords: [ui, layout, settings, composer, portrait, android, appearance]
---

# UI

## 1. Purpose and boundary

`SYS-UI` owns Elara's browser presentation, interaction geometry, Settings surfaces, portrait/banner presentation, composer UX, sidebar, quick-action presentation, typography and accessibility. `src/app/App.tsx` is the current composition root, but provider, OAuth, secret and database mechanics remain owned by their systems.

Android portrait is the canonical design target. Desktop widens the same layout rather than defining a second application shell.

## 2. Runtime architecture

```text
main.tsx -> App.tsx
  -> app shell / control stack / portrait banner
  -> conversation surface
  -> composer
  -> sidebar + Settings
  -> feature surfaces (Memory, Character, OAuth, Lockbox, Autonomy)
```

`src/app/layout.css` is the single shell-geometry authority. The shell uses one horizontal gutter, an overlay control stack, a shrinking conversation region and a flex-flow composer. `src/ui/useVisualViewport.ts` drives keyboard-aware viewport sizing; browser VirtualKeyboard support is progressive enhancement rather than a fixed keyboard-height assumption.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Composition | `src/app/App.tsx` |
| Shell geometry | `src/app/layout.css`, `src/app/layout-authority.test.ts` |
| Composer | `src/app/components/Composer.tsx`, composer CSS/autosize tests |
| Conversation rendering | `src/app/components/ConversationSurface.tsx` |
| Viewport/IME | `src/ui/useVisualViewport.ts` |
| Fonts | `src/ui/fontRegistry.ts`, `src/ui/fonts.css`, `src/ui/generated-fonts/` |
| Icons | `src/ui/icons.tsx` |
| Appearance | `src/app/components/ChatAppearanceSettings.tsx` |

## 4. Data and contracts

Canonical shell width is capped at `520px`; the 9:16 Android portrait composition is the reference geometry. Touch controls use a `44px` minimum shell control token. The composer is a four-track row: attachment, flexible editor, VTT and send. The editor grows to roughly ten visible lines, then scrolls internally; conversation space shrinks instead of being pushed outside the shell.

Built-in fonts are Inter, Manrope and Outfit as local Latin WOFF2 assets with system fallbacks. Custom Google Fonts are opt-in and accepted only from validated HTTPS `fonts.googleapis.com/css2` URLs.

## 5. Invariants

- UI never constructs raw Gemini requests or owns OAuth/credential/database implementation.
- Shell positioning belongs to `layout.css`; component styles do not invent competing shell offsets.
- Safe-area and IME behavior is dynamic; never hard-code an Android keyboard height.
- Conversation scrolling, composer growth and latest-message visibility must remain stable together.
- Core controls retain visible focus states, reduced-motion support and usable touch targets.
- Character artwork is presentation data, not the app's canvas or provider context by default.

## 6. Security and failure semantics

Presentation surfaces receive safe state and callbacks. Secret values must not enter generic React context, logs or rendered diagnostic payloads. External links use the owning subsystem's validated handoff rules. UI errors are explicit and recoverable; loading states must not become indefinite when a provider or capability fails.

## 7. Verification and tests

Primary checks are `src/app/layout-authority.test.ts`, `src/app/composer-layout.test.ts`, component tests, `src/ui/useVisualViewport.test.tsx`, and Playwright Android-portrait/onboarding suites. Physical Android IME, chooser and PWA behavior still require handset validation where browser emulation cannot prove platform behavior.

## 8. Known gaps

`App.tsx` remains a large composition root and should not accumulate new domain ownership. Real-device keyboard/viewport edge cases remain the final authority for mobile reliability. Feature-specific presentation contracts belong in their owning system documents rather than growing this file into a component catalog.
