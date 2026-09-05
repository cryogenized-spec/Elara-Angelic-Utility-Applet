# Implementation Plan

## Gemini API Lockbox v2 — local session security and unlock modes

### Goal
Upgrade the existing local Gemini API Lockbox so users can choose one of three session-security modes without changing the Gemini provider contract:

1. **PIN** — the default: a 6–8 digit local unlock PIN.
2. **Passkey** — optional upgrade from PIN to platform authentication (Android biometric/device credential where supported).
3. **Off** — optional opt-out: once the user authenticates with the current PIN, the Lockbox remains available across normal app/session restores until explicitly re-enabled or the encrypted key is cleared.

The encrypted Gemini API key remains local and the provider continues to consume the same `getGeminiApiKey()` interface.

## Phase 1 — Security/session model

- Extend the Lockbox persistence model with an explicit security mode (`pin`, `passkey`, `off`) and versioned metadata.
- Keep the Gemini API key encrypted at rest in IndexedDB with the existing AES-GCM-256 + PBKDF2-SHA-256 construction and current 310,000 iterations.
- Keep the decrypted API key exclusively in module memory; do not move plaintext key material to persistent browser storage.
- Add a local activity timestamp and idle-timeout policy. Use client-side signals only; no Google/Gemini network request is needed for stale-session detection.
- On cold start/reload/process-memory loss, treat the in-memory key as unavailable and enter the configured unlock state.
- On idle timeout, clear the in-memory key and transition to locked state.
- Keep local-storage activity metadata non-authoritative; the actual secret boundary remains whether the decrypted key exists in memory.

## Phase 2 — PIN mode (default)

- Replace the current password-first unlock flow with a 6–8 digit numeric PIN setup flow.
- Validate that the PIN is numeric and exactly 6–8 digits.
- Use a random salt and AES-GCM encryption for the API key, retaining the stronger existing PBKDF2 iteration count.
- Add a local failed-attempt throttle/backoff so repeated guesses are slowed without introducing network dependencies.
- Build a dedicated mobile unlock surface with `inputmode="numeric"`, numeric pattern, password masking, and immediate mount focus.
- Request focus whenever the locked state becomes active so Android/Chromium can present the numeric keyboard naturally.
- On incorrect PIN: clear the field, increment failure state, apply the local backoff, and show a concise error.
- On forgotten PIN: do not attempt insecure recovery. Provide a destructive reset path that removes the encrypted Gemini API key and returns the Lockbox to unconfigured state.

## Phase 3 — Passkey mode

- Add an explicit **Upgrade to Passkey** action available after successful PIN authentication.
- Register a platform passkey using WebAuthn with user verification required where supported.
- Use passkey-derived/wrapped local key material only where the browser/device supports the required WebAuthn capability; never expose the Gemini API key or Lockbox PIN to the credential service.
- Store only the minimum credential metadata needed by the client; never persist the private key material.
- On cold start or idle timeout, offer the passkey unlock path first when configured.
- Preserve PIN as a fallback when passkey support is unavailable or when the user deliberately chooses fallback authentication.
- Provide a clear recovery path if passkey registration is unavailable on the current browser/device.

## Phase 4 — Off mode

- Add a third security mode, **Off**, selectable from Lockbox settings.
- Require successful authentication with the current PIN before allowing security to be disabled.
- After disabling, keep the decrypted key available for the normal application lifetime and do not force a Lockbox prompt on ordinary stale-session transitions.
- Keep the encrypted-at-rest record intact; “Off” must not mean storing the plaintext API key persistently.
- Allow security to be re-enabled later from Settings, requiring the current PIN/authentication before changing the mode.

## Phase 5 — Lockbox UI

- Redesign the Lockbox panel around the three modes and current state.
- Default first-run setup to **PIN**.
- Show current status clearly: configured/unconfigured, locked/unlocked, and selected security mode.
- While locked, show the appropriate unlock action:
  - PIN entry for PIN mode.
  - Passkey/biometric action first, with PIN fallback, for passkey mode.
  - No unlock gate for Off mode unless the user explicitly re-enables security.
- Add actions for Upgrade to Passkey, Switch to PIN, Turn Security Off, Turn Security On, Change PIN, and Clear Lockbox as appropriate to state.
- Make destructive operations explicit and require authentication where necessary.

## Phase 6 — Provider and lifecycle integration

- Keep `getGeminiApiKey()` returning only the currently decrypted in-memory API key.
- Ensure provider initialization fails cleanly while the Lockbox is locked instead of attempting an empty/undefined credential.
- Add a lightweight lockbox/session controller that listens to `visibilitychange`, focus, and meaningful user activity.
- Throttle activity writes and avoid per-keystroke localStorage churn.
- Ensure locking immediately invalidates the in-memory API key and updates UI state without a network call.
- Ensure logout/reset/unmount paths clear memory-held key material.

## Phase 7 — Tests and hardening

- Unit-test PIN validation, encryption/decryption, mode transitions, stale-session logic, activity timestamps, failed-attempt throttling, and destructive reset behavior.
- Test that the Gemini API key is never persisted in plaintext in IndexedDB/localStorage/sessionStorage.
- Add browser tests for numeric input focus and locked-state rendering.
- Add capability-gated WebAuthn tests/mocks for passkey registration and unlock/fallback.
- Test transitions: first-run → PIN → unlocked → stale → PIN unlock; PIN → passkey → stale → passkey unlock; passkey → PIN fallback; PIN → off → normal relaunch; forgotten PIN → destructive reset.
- Re-run lint, typecheck, unit tests, production build, Playwright, and E2E CI before merging.

## Non-goals for this pass

- Do not modify Gemini request payloads or provider generation behavior.
- Do not reintroduce the Cloudflare Worker as a credential transport layer.
- Do not persist the decrypted Gemini API key in browser storage.
- Do not make network calls to detect stale sessions or unlock the local Lockbox.
- Do not alter conversation/folder context scoping as part of the Lockbox work.
