# UI Pass 8 — Android Portrait Reliability

Pass 8 is the final planned UI implementation pass: make the existing mobile-first shell defensible across a representative Android portrait viewport and add regression coverage for the failure modes that are practical to verify in CI.

## Implemented

- Added an isolated Playwright `android-portrait` project at 412×915 with touch input enabled.
- Added narrow-portrait coverage for viewport containment of the shell, Workspace rail, and composer.
- Verified coarse-pointer Workspace controls remain at least 44px high.
- Verified the Workspace rail remains horizontally scrollable rather than forcing page-wide overflow.
- Verified sidebar open/close preserves composer availability.
- Verified Settings remains recoverable on a narrow portrait viewport.
- Added reduced-motion execution to the portrait project so non-essential motion regressions are exercised automatically.

## Boundary

This is automated representative-device validation, not a claim of physical-handset certification. A real Android handset still provides the final human validation for IME behavior, browser chrome, viewport resizing, font rendering, and device-specific touch/gesture nuances.

No provider, OAuth, Gemini, persistence, or Workspace capability behavior was changed by this pass.

## Exit criterion

The planned UI pass sequence is complete when the desktop Chromium suite, the Android-portrait reliability suite, lint, typecheck, unit tests, build, and repository reliability gate are green on `main`.
