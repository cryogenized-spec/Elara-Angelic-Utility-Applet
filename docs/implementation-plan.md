# Implementation Plan

## Gemini API Lockbox v2 — local session security and unlock modes

### Goal
Upgrade the existing local Gemini API Lockbox so users can choose one of three security modes:

1. **PIN** — default: 6–8 digit local unlock PIN.
2. **Passkey** — optional upgrade from PIN to platform authentication (biometric/device credential where supported).
3. **Off** — optional opt-out: authenticated users can disable the lock gate without persisting the plaintext API key.

The Gemini provider contract remains unchanged: it consumes the decrypted key only through the existing local `getGeminiApiKey()` path.

## Phase 1 — Security/session model

- Version the Lockbox metadata to include selected security mode and any required authentication metadata.
- Keep the Gemini API key encrypted at rest in IndexedDB using the existing AES-GCM-256 + PBKDF2-SHA-256 construction and current 310,000 iterations.
- Keep decrypted key material exclusively in JavaScript module memory. Never persist the plaintext key in `localStorage`, `sessionStorage`, or IndexedDB.
- Add a local activity timestamp for idle-session decisions; no Google/Gemini network call is involved in stale-session detection.
- Treat a missing in-memory key after reload/cold start as locked when security is enabled.
- On idle timeout, wipe the in-memory key and transition to locked state.
- Treat local activity metadata as convenience state, not as a security boundary.

## Phase 2 — PIN mode (default)

- Replace the current password-first setup/unlock experience with a 6–8 digit numeric PIN.
- Validate the PIN as numeric and exactly 6–8 digits.
- Retain the existing 310,000 PBKDF2 iterations; do not downgrade the KDF for UX speed.
- Add local failed-attempt backoff/throttling to slow repeated guesses without network dependencies.
- Use a dedicated mobile unlock surface with `type="password"`, `inputmode="numeric"`, numeric `pattern`, and an appropriate `autocomplete` value for a persistent PIN rather than an OTP.
- Focus the PIN field whenever the locked surface mounts so Android/Chromium has the opportunity to display the numeric keyboard.
- On incorrect PIN, clear the field, record the failed attempt, apply backoff, and show a concise error.
- Provide a destructive reset/recovery path for forgotten PINs. Reset wipes the encrypted Gemini API key and returns the Lockbox to an unconfigured state; there is no PIN recovery that weakens the secret model.

## Phase 3 — Passkey mode

- After successful PIN authentication, expose **Upgrade to Passkey**.
- Register a platform WebAuthn credential with user verification requested.
- Use WebAuthn only for authentication/key-unwrapping support; never transmit or expose the Gemini API key to the credential provider.
- Keep only minimal credential metadata needed by the client; private credential material remains managed by the platform authenticator.
- When passkey mode is configured, cold-start/idle unlock presents passkey authentication first.
- Keep the 6–8 digit PIN as a deliberate fallback when passkey is unavailable or the user chooses it.
- Gate passkey-dependent behavior on actual browser/device capability rather than assuming universal support.

## Phase 4 — Off mode

- Add **Off** as the third user-selectable mode.
- Require successful authentication with the current PIN/passkey before disabling security.
- When Off is selected, do not impose the local unlock gate merely because the page/session restarted. Do not solve this by persisting the plaintext API key; the implementation must keep the same encrypted-at-rest boundary.
- Allow security to be re-enabled from Settings after authentication.

## Phase 5 — Lockbox UI/UX

- Rework the Lockbox panel to make the three modes explicit and understandable.
- First-run setup starts in PIN mode.
- Show configured/unconfigured, locked/unlocked, and active security mode clearly.
- PIN mode: compact numeric unlock surface that requests focus immediately.
- Passkey mode: prominent biometric/passkey action with visible PIN fallback.
- Off mode: no unlock prompt; settings expose an explicit **Turn Security On** action.
- Add state-appropriate controls for Upgrade to Passkey, Switch to PIN, Change PIN, Turn Security Off/On, and Clear Lockbox.
- Require authentication for security downgrade/upgrade operations and make destructive clearing explicit.

## Phase 6 — Lifecycle/provider integration

- Keep `getGeminiApiKey()` unchanged as the provider-facing interface: it returns only the current in-memory secret, or an empty value while locked.
- Add a small client-side Lockbox/session controller for `visibilitychange`, focus, and meaningful activity.
- Throttle activity timestamp updates; do not write on every pointer/key event.
- Locking must immediately wipe the module-held key and update the UI without network traffic.
- Ensure reset/unmount paths do not retain the decrypted key.
- Do not alter Gemini request payloads, model settings, or provider generation behavior as part of this security work.

## Phase 7 — Tests and hardening

- Unit-test PIN validation, encryption/decryption, mode transitions, timeout behavior, timestamp logic, failed-attempt backoff, reset/wipe behavior, and provider behavior while locked.
- Assert that the API key never appears in plaintext in IndexedDB/localStorage/sessionStorage.
- Add browser tests for the locked PIN surface, numeric input configuration, focus request, and passkey capability handling.
- Add WebAuthn mocks for registration, authentication, unsupported-capability fallback, and PIN fallback.
- Test the complete state transitions: first-run → PIN → unlocked → stale → PIN unlock; PIN → passkey → stale → passkey unlock; passkey → PIN fallback; PIN → Off; Off → security enabled; forgotten PIN → full key wipe.
- Run lint, typecheck, unit tests, production build, Playwright, and E2E CI before merging.

## Non-goals

- No network-based stale-session checks.
- No plaintext API-key persistence.
- No reintroduction of the Cloudflare Worker as a credential transport layer.
- No changes to conversation/folder context scoping.
