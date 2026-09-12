---
id: SYS-SEC
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: local API Lockbox and protected browser credentials
paths: [src/persistence/gemini-api-key.ts, src/persistence/gemini-passkey.ts, src/persistence/gemini-lockbox-settings.ts]
keywords: [lockbox, credential, secret, pin, passkey, encryption]
---

# Lockbox and credentials

## 1. Purpose and boundary

`SYS-SEC` owns Elara's browser API Lockbox. It stores the primary Gemini API key and named secondary credentials such as the YouTube API key behind one security authority and one unlock session. Consumers receive narrow named accessors; there is no general model/UI `getSecret()` capability.

## 2. Runtime architecture

```text
credential entry
-> Lockbox security mode
-> encrypt + Dexie secrets store
-> explicit unlock session
-> named accessor (Gemini / YouTube)
-> owning provider
-> idle relock when security is enabled
```

The Gemini record is the Lockbox security authority. Secondary credential records inherit the primary security mode and are unlocked with the same credential/session; stale/weaker secondary mode stamps are not treated as authority.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Encrypted store/session | `src/persistence/gemini-api-key.ts` |
| Passkey integration | `src/persistence/gemini-passkey.ts` |
| PIN/security settings | `src/persistence/gemini-lockbox-settings.ts` |
| UI | `src/app/components/GeminiApiLockbox.tsx` |
| Gemini consumer | `src/gemini/provider.ts` |
| YouTube consumer | `src/media/youtube/` |

## 4. Data and contracts

The Lockbox database is `elara-gemini-lockbox`, with `secrets` keyed by secret ID. Current IDs include `gemini-api-key` and `youtube-api-key`. Security modes are `password`, `pin`, `passkey`, `off`; PIN length is 6–8 digits. Protected passphrase/PIN records use PBKDF2-SHA-256 (310,000 iterations) to derive a 256-bit AES-GCM key with random 16-byte salt and 12-byte IV. Unlocked plaintext lives only in the in-memory session map.

When security is enabled, the session has a 15-minute idle timeout. `off` mode uses a device-local non-extractable Web Crypto key rather than plaintext persistence. A legacy plaintext localStorage Gemini key is migrated into encrypted/device-local Lockbox storage when possible and removed only after successful migration.

## 5. Invariants

- Gemini credentials are never `VITE_*` build variables.
- Secrets never appear in model-visible schemas, ordinary app state, conversation records, cache keys, URLs, analytics or diagnostic exports.
- Consumers use named minimum-capability accessors.
- Secondary credentials cannot silently remain under weaker protection after primary security changes.
- Lock/idle enforcement clears the in-memory unlock session.
- Provider configuration distinguishes empty, locked/unlocked and secondary mismatch states explicitly.

## 6. Security and failure semantics

Cryptographic failure is reported as a safe Lockbox error without exposing ciphertext/key material. Failed unlock/backoff metadata lives with the authority record. Secret mismatches are surfaced instead of making a key silently unusable. Passkey availability is a capability check, not an assumption about every browser/device.

## 7. Verification and tests

Use `src/persistence/gemini-api-key.test.ts`, passkey/Lockbox settings tests, `GeminiApiLockbox.test.tsx`, provider configuration tests and the reliability gate. Security changes require migration tests for existing stored records and secondary credentials.

## 8. Known gaps

The Lockbox protects browser-local credentials; it is not a substitute for server-side secrets used by `SYS-WORKER`. If more secondary credentials are added, preserve named accessors and the single security authority rather than exposing a generic secret vault API.
