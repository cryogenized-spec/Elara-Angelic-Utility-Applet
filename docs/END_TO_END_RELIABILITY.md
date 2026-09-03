# End-to-End Reliability Gate

Prompt 50 closes the initial 50-prompt clean-room foundation with an enforceable reliability sequence.

## Required CI sequence

Every push to `main` and every pull request targeting `main` must pass:

1. Node 24 runtime verification
2. foundation-document verification
3. dependency installation
4. ESLint
5. TypeScript typecheck
6. unit tests
7. production build
8. Playwright Chromium E2E smoke tests
9. final repository reliability checks

The final gate verifies required architecture documents exist, the expected npm quality scripts exist, the Node baseline remains 24, and no legacy `generateContent()` call has appeared in the production TypeScript source tree.

## Reliability invariants

- one canonical Gemini Interactions provider path
- no UI-owned Gemini or OAuth credentials
- no arbitrary Google HTTP/model tool
- Google service boundaries remain separate
- Google mutations retain explicit risk and confirmation controls
- background Gemini execution reuses the canonical provider boundary
- provider and OAuth failures are normalized instead of becoming endless loading states
- source architecture remains modular and independently testable

## Milestone rule

The 50-prompt foundation is not considered complete until the latest commit on `main` has a completed green CI run covering all gates above.

This gate is intentionally additive. It does not replace unit, integration, or E2E tests; it verifies that the repository still preserves the architectural invariants that those tests cannot fully express.
