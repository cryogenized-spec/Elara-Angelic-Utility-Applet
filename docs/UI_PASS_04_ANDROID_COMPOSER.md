# UI Pass 4 — Android Composer and IME

## Status

Implemented on 2026-09-03 as the current UI milestone. Physical-device validation remains part of Pass 8.

## What changed

- Added `Composer.tsx` as the dedicated presentation/input boundary.
- Added bounded textarea auto-growth to 132px, then internal scrolling.
- Enter submits a non-empty draft; Shift+Enter inserts a newline.
- Added explicit response cancellation with `AbortController` plumbing through the temporary demo transport.
- Added VisualViewport metrics via `src/ui/useVisualViewport.ts`.
- The app shell now sizes to the current visual viewport instead of assuming a fixed keyboard height.
- VirtualKeyboard `geometrychange` notifications are consumed progressively when the API exists; the app does not require that limited-availability API.
- Conversation scrolling stays pinned near the end when the user is already near the latest message and re-evaluates on VisualViewport resize.
- Added Playwright regression coverage for multiline input, cancellation, and bounded composer sizing.

## Browser/platform decision

VisualViewport is the baseline signal because it is broadly available. The VirtualKeyboard API is treated as progressive enhancement because MDN currently marks it as limited-availability and not Baseline. Chrome/Android viewport behavior should be controlled through modern viewport semantics rather than fixed keyboard-height offsets. citeturn850901search1turn850901search5turn330441search0

The implementation retains the existing `viewport-fit=cover` mobile viewport declaration and safe-area CSS handling. citeturn726367view0

## Files

- `src/app/components/Composer.tsx`
- `src/app/components/composer.css`
- `src/ui/useVisualViewport.ts`
- `src/app/mobile-viewport.css`
- `src/app/App.tsx`
- `src/app/components/ConversationSurface.tsx`
- `src/chat/demo-turn-port.ts`
- `e2e/smoke.spec.ts`
- `README.md`
- `docs/UI_IMPLEMENTATION_PLAN.md`

## Deliberate limits

Attachment and voice controls remain entry points only. Their concrete runtime capability boundaries continue to belong to the dedicated attachment and voice passes. This pass does not add a second provider path or teach the composer about Gemini, OAuth, persistence, or Workspace execution.

## Verification target

The normal CI gate remains authoritative: install, lint, typecheck, unit tests, build, Playwright E2E, and reliability gate. Pass 8 will additionally validate the deployed PWA on physical Android hardware across keyboard open/close and sidebar/keyboard combinations.