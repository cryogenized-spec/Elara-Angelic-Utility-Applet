# Implementation Plan

## Gemini API Lockbox v2 — local session security and unlock modes

Three user-selectable modes: PIN (default, 6–8 digits), Passkey (optional biometric/platform-authenticator upgrade with PIN fallback), and Off (optional opt-out, while retaining encrypted-at-rest storage and never persisting plaintext key). The provider-facing getGeminiApiKey() contract remains unchanged.

### Phase 1 — Security/session
- Version Lockbox metadata with mode and auth metadata.
- Retain AES-GCM-256 + PBKDF2-SHA-256 at 310,000 iterations.
- Decrypted API key remains module memory only.
- Add local activity timestamp and idle timeout; no network checks.
- Cold start/reload with enabled security and no in-memory key becomes locked.
- Idle timeout wipes in-memory key.

### Phase 2 — PIN default
- 6–8 digit numeric PIN setup/unlock.
- Numeric validation, local failed-attempt backoff, and mobile input with type=password, inputmode=numeric, pattern, and persistent-PIN-appropriate autocomplete.
- Focus PIN field when locked so Android/Chromium can present the numeric keyboard.
- Wrong PIN clears input and reports failure.
- Forgotten PIN has no recovery shortcut: destructive reset wipes the encrypted Gemini API key and returns to unconfigured.

### Phase 3 — Passkey
- After successful PIN authentication, offer Upgrade to Passkey.
- Register platform WebAuthn with user verification requested.
- Use WebAuthn for authentication/key-unwrapping support only; never expose Gemini API key to the credential service.
- Passkey is primary when configured; PIN remains fallback.
- Capability-detect and gracefully fall back when unsupported.

### Phase 4 — Off
- Add Off mode.
- Require current authentication before disabling security.
- Off must not cause plaintext API-key persistence.
- Allow security to be re-enabled after authentication.

### Phase 5 — UI/UX
- Clearly show mode and configured/locked/unlocked state.
- PIN: compact numeric unlock surface.
- Passkey: biometric/passkey first with PIN fallback.
- Off: no lock gate; expose Turn Security On.
- Provide Upgrade to Passkey, Switch to PIN, Change PIN, Turn Security Off/On, and Clear Lockbox as applicable.

### Phase 6 — Integration
- Add client-side lifecycle controller for visibilitychange, focus, and meaningful activity.
- Throttle activity timestamp writes.
- Lock immediately wipes memory and updates UI without network traffic.
- Keep provider/generation behavior unchanged.

### Phase 7 — Tests
- Unit-test crypto, PIN validation, mode transitions, stale timeout, activity, backoff, reset/wipe, and locked-provider behavior.
- Assert plaintext key never appears in IndexedDB/localStorage/sessionStorage.
- Browser-test lock UI, numeric input/focus, and WebAuthn capability/fallback.
- Run lint, typecheck, unit, build, Playwright, and E2E before merge.

### Non-goals
No network-based stale checks, no plaintext API-key storage, no Worker credential transport, and no conversation/folder context changes.
