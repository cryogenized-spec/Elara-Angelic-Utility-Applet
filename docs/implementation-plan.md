# Implementation Plan

## Gemini API Lockbox v2 — local session security and unlock modes

### Goal
Upgrade the existing local Gemini API Lockbox so users can choose one of three security modes:

1. PIN — default: 6–8 digit local unlock PIN.
2. Passkey — optional upgrade from PIN to platform authentication (biometric/device credential where supported).
3. Off — optional opt-out: authenticated users can disable the lock gate without persisting the plaintext API key.

The Gemini provider contract remains unchanged: it consumes the decrypted key only through the existing local getGeminiApiKey() path.

## Phase 1 — Security/session model
- Version Lockbox metadata with selected security mode and authentication metadata.
- Keep API key encrypted at rest in IndexedDB using existing AES-GCM-256 + PBKDF2-SHA-256 with 310,000 iterations.
- Keep decrypted key only in JavaScript module memory; never persist plaintext in browser storage.
- Add local activity timestamp for idle-session decisions; no Google/Gemini network call is involved in stale-session detection.
- Missing in-memory key after cold start/reload is locked when security is enabled.
- Idle timeout wipes the in-memory key and locks.

## Phase 2 — PIN mode (default)
- Replace password-first setup/unlock with a 6–8 digit numeric PIN.
- Validate numeric length 6–8.
- Retain 310,000 PBKDF2 iterations.
- Add local failed-attempt backoff.
- Use type=password, inputmode=numeric, numeric pattern, and persistent-PIN-appropriate autocomplete.
- Focus the PIN field whenever the locked surface mounts to request Android/Chromium numeric keyboard.
- Incorrect PIN clears input, records failure, applies backoff, and shows an error.
- Forgotten PIN uses destructive reset: wipe encrypted Gemini key and return to unconfigured state.

## Phase 3 — Passkey mode
- After successful PIN authentication, expose Upgrade to Passkey.
- Register platform WebAuthn credential with user verification requested.
- Use WebAuthn only for local authentication/key-unwrapping support; never expose the Gemini API key to the credential service.
- Store only minimum credential metadata.
- Passkey is the primary unlock path when configured; 6–8 digit PIN remains a deliberate fallback.
- Gate passkey behavior on actual browser/device capability.

## Phase 4 — Off mode
- Add Off as the third selectable mode.
- Require successful authentication before disabling security.
- Do not persist plaintext API key merely to make Off survive reloads; preserve encrypted-at-rest boundary.
- Allow security to be re-enabled from Settings after authentication.

## Phase 5 — Lockbox UI/UX
- Make the three modes explicit.
- First-run starts in PIN mode.
- Show configured/unconfigured, locked/unlocked, and active mode.
- PIN mode: compact numeric unlock surface with immediate focus request.
- Passkey mode: biometric/passkey action first with PIN fallback.
- Off mode: no unlock gate; expose Turn Security On.
- Add Upgrade to Passkey, Switch to PIN, Change PIN, Turn Security Off/On, and Clear Lockbox as appropriate.
- Require authentication for security changes and make destructive clearing explicit.

## Phase 6 — Lifecycle/provider integration
- Keep getGeminiApiKey() as provider interface, returning only in-memory key or empty while locked.
- Add client-side controller for visibilitychange, focus, and meaningful activity.
- Throttle activity timestamp writes.
- Locking immediately wipes memory and updates UI without network traffic.
- Ensure reset/unmount paths do not retain decrypted key.
- Do not change Gemini request payloads/provider generation behavior.

## Phase 7 — Tests and hardening
- Unit-test PIN validation, crypto, mode transitions, timeout, activity timestamps, backoff, reset/wipe, and provider-while-locked behavior.
- Assert API key never appears in plaintext in IndexedDB/localStorage/sessionStorage.
- Add browser tests for numeric input, focus, lock rendering, and passkey capability handling.
- Add WebAuthn mocks for registration, authentication, unsupported capability, and PIN fallback.
- Test all major transitions: first-run → PIN → unlock → stale → PIN; PIN → passkey → stale → passkey; passkey → PIN; PIN → Off; Off → security enabled; forgotten PIN → wipe.
- Run lint, typecheck, unit, build, Playwright, and E2E CI before merge.

## Non-goals
- No network-based stale-session checks.
- No plaintext API-key persistence.
- No Cloudflare Worker credential transport.
- No conversation/folder context changes.
