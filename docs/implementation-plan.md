# Implementation Plan

## Gemini API Lockbox v2 — local session security and unlock modes

Three user-selectable modes: PIN (default, 6–8 digits), Passkey (optional biometric/platform-authenticator upgrade with PIN fallback), and Off (optional opt-out, while retaining encrypted-at-rest storage and never persisting plaintext key). The provider-facing getGeminiApiKey() contract remains unchanged.

### Phase 1 — Security/session
- [x] Version Lockbox metadata with mode and auth metadata.
- [x] Retain AES-GCM-256 + PBKDF2-SHA-256 at 310,000 iterations.
- [x] Decrypted API key remains module memory only.
- [x] Add local activity timestamp and idle timeout; no network checks.
- [x] Cold start/reload with enabled security and no in-memory key becomes locked.
- [x] Idle timeout wipes in-memory key.

Default Phase 1 idle timeout is 15 minutes. The activity timestamp is held in module memory rather than persisted, and browser lifecycle events enforce the timeout locally.

### Phase 2 — PIN default
- [x] 6–8 digit numeric PIN setup/unlock.
- [x] Numeric validation, local failed-attempt backoff, and mobile input with type=password, inputmode=numeric, pattern, and persistent-PIN-appropriate autocomplete.
- [x] Focus PIN field when locked so Android/Chromium can present the numeric keyboard.
- [x] Wrong PIN clears input and reports failure.
- [x] Forgotten PIN has no recovery shortcut: destructive reset wipes the encrypted Gemini API key and returns to unconfigured.

Fresh Lockboxes now default to PIN authentication. Existing legacy password Lockboxes remain password-authenticated and are not silently re-encrypted. PIN failures use persisted local backoff metadata; successful unlock clears the failure state.

### Phase 3 — Passkey
- [x] After successful PIN authentication, offer Upgrade to Passkey.
- [x] Register platform WebAuthn with user verification requested.
- [x] Use WebAuthn for authentication/key-unwrapping support only; never expose Gemini API key to the credential service.
- [x] Passkey is primary when configured; PIN remains fallback.
- [x] Capability-detect and gracefully fall back when unsupported.

The passkey uses the WebAuthn PRF extension to derive a credential-bound symmetric wrapping key. That key wraps the existing Lockbox PIN; a successful passkey assertion recovers the PIN and then uses the existing encrypted API-key path. No Gemini API key material enters WebAuthn. If PRF is unavailable, PIN remains the supported path.

### Phase 4 — Off
- [ ] Add Off mode.
- [ ] Require current authentication before disabling security.
- [ ] Off must not cause plaintext API-key persistence.
- [ ] Allow security to be re-enabled after authentication.

### Phase 5 — UI/UX
- [ ] Clearly show mode and configured/locked/unlocked state.
- [ ] PIN: compact numeric unlock surface.
- [ ] Passkey: biometric/passkey first with PIN fallback.
- [ ] Off: no lock gate; expose Turn Security On.
- [ ] Provide Upgrade to Passkey, Switch to PIN, Change PIN, Turn Security Off/On, and Clear Lockbox as applicable.

### Phase 6 — Integration
- [ ] Add client-side lifecycle controller for visibilitychange, focus, and meaningful activity.
- [ ] Throttle activity timestamp writes.
- [ ] Lock immediately wipes memory and updates UI without network traffic.
- [ ] Keep provider/generation behavior unchanged.

### Phase 7 — Tests
- [ ] Unit-test crypto, PIN validation, mode transitions, stale timeout, activity, backoff, reset/wipe, and locked-provider behavior.
- [ ] Assert plaintext key never appears in IndexedDB/localStorage/sessionStorage.
- [ ] Browser-test lock UI, numeric input/focus, and WebAuthn capability/fallback.
- [ ] Run lint, typecheck, unit, build, Playwright, and E2E before merge.

### Non-goals
No network-based stale checks, no plaintext API-key storage, no Worker credential transport, and no conversation/folder context changes.
