---
id: SYS-SEC
status: active
verified_commit: 482da748f482a005d8d89c91649de0ac73dd52fe
scope: browser credential boundaries and security architecture enforcement
paths: [src/persistence/gemini-api-key.ts, src/persistence/gemini-passkey.ts, src/persistence/gemini-lockbox-settings.ts, src/autonomy/cloud/credential.ts, src/autonomy/cloud/pairing.ts, scripts/security-architecture-gate.mjs]
keywords: [lockbox, credential, secret, pin, passkey, encryption, capability, egress, confirmation]
---

# Security and credential boundaries

## 1. Purpose and boundary

`SYS-SEC` defines credential handling and the repository-level capability boundary. The primary browser API Lockbox stores the Gemini API key and named secondary credentials such as the YouTube API key behind one security authority and one unlock session. Consumers receive narrow named accessors; there is no general model/UI `getSecret()` capability.

Autonomy's installation token is a separate device credential because cloud sync must resume without requiring the interactive Lockbox to be unlocked. It is nevertheless never ordinary application state or plaintext durable pairing metadata: it is sealed in a dedicated device-local credential store and resolved only at the cloud request boundary.

## 2. Runtime architecture

```text
Gemini / YouTube credential
-> Lockbox security mode
-> encrypted Dexie secrets store
-> explicit unlock session
-> named accessor
-> owning provider

Autonomy installation token
-> pairing input
-> AES-GCM device-local credential store
-> pairing-only credential resolver
-> cloud-client runtime token handoff
-> autonomy cloud request
```

The Gemini record is the Lockbox security authority. Secondary Lockbox records inherit the primary security mode and are unlocked with the same credential/session; stale or weaker secondary mode stamps are not treated as authority.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Lockbox encrypted store/session | `src/persistence/gemini-api-key.ts` |
| Passkey integration | `src/persistence/gemini-passkey.ts` |
| PIN/security settings | `src/persistence/gemini-lockbox-settings.ts` |
| Lockbox UI | `src/app/components/GeminiApiLockbox.tsx` |
| Gemini consumer | `src/gemini/provider.ts` |
| YouTube consumers | `src/media/youtube/`, `src/media/search.ts` |
| Autonomy credential store | `src/autonomy/cloud/credential.ts` |
| Autonomy pairing metadata/runtime resolver | `src/autonomy/cloud/pairing.ts` |
| Autonomy plaintext request consumer | `src/autonomy/cloud/client.ts` |
| Capability expansion gate | `scripts/security-architecture-gate.mjs` |
| Gate/CI integrity | `scripts/check-verification-integrity.mjs` |

## 4. Data and cryptography

The Lockbox database is `elara-gemini-lockbox`, with `secrets` keyed by secret ID. Current IDs include `gemini-api-key` and `youtube-api-key`. Security modes are `password`, `pin`, `passkey`, `off`; PIN length is 6–8 digits. Protected passphrase/PIN records use PBKDF2-SHA-256 (310,000 iterations) to derive a 256-bit AES-GCM key with random 16-byte salt and 12-byte IV. Unlocked plaintext lives only in the in-memory session map.

When security is enabled, the Lockbox session has a 15-minute idle timeout. `off` mode uses a device-local non-extractable Web Crypto key rather than plaintext persistence. A legacy plaintext localStorage Gemini key is migrated into encrypted/device-local Lockbox storage when possible and removed only after successful migration.

The autonomy installation token uses a dedicated Dexie store, AES-GCM-256 and a non-extractable device-local CryptoKey. `elara.autonomy.pairing.v1` stores pairing metadata only. Legacy pairing records containing `token` are migrated loss-safely: the plaintext field is removed only after the protected credential write succeeds.

## 5. Credential invariants

- Gemini credentials are never `VITE_*` build variables.
- Secrets never appear in model-visible schemas, ordinary app state, conversation records, cache keys, URLs, analytics or diagnostic exports.
- Lockbox consumers use named minimum-capability accessors.
- YouTube keys are resolved just in time and sent only in `x-goog-api-key` headers.
- The autonomy installation token is never serialized into new pairing JSON and is never placed in a network target.
- Only `src/autonomy/cloud/pairing.ts` may directly import the autonomy credential store; only `src/autonomy/cloud/client.ts` may consume `resolvePairingToken` outside the pairing authority.
- Credential-bearing autonomy modules do not gain `console.*` logging authority without explicit architecture review.
- Secondary Lockbox credentials cannot silently remain under weaker protection after primary security changes.
- Lock/idle enforcement clears the in-memory Lockbox unlock session.
- Cryptographic/storage migration failures must preserve recoverable legacy state rather than deleting the only usable credential.

## 6. Capability change-control boundary

`npm run security:check` is a dependency-free pre-install CI gate. It treats acquisition of new powers as an explicit architecture event. The reviewed surface currently freezes:

- dynamic execution and raw HTML injection primitives, which are forbidden;
- alternate raw browser transports (`XMLHttpRequest`, WebSocket, EventSource and `sendBeacon`) and remote dynamic module imports, which are forbidden;
- Node filesystem/process/network/VM host authorities in runtime code, which are forbidden;
- the two approved dynamic executable script loaders: Google Identity Services and the official YouTube IFrame API, including their exact provider URLs;
- the two approved browser Worker constructors, both restricted to local module targets for OCR and document compilation;
- Dexie database owners, so a new durable authority cannot appear silently;
- Lockbox plaintext consumers, so secret propagation cannot expand silently;
- autonomy credential-store and runtime-token consumers, so that separate secret boundary cannot expand silently;
- global outbound fetch owners/references and reviewed provider destinations;
- Google service import boundaries;
- shared Google mutation confirmation-broker consumers;
- the autonomy token's encrypted-storage and HTTPS egress contract.

The verification-integrity gate pins `security:check`, its CI order and the individual capability classes above. CI runs documentation integrity, verification integrity and the security/architecture boundary before `npm ci`, then repeats the security gate through the final reliability command.

## 7. Network and confirmation boundaries

Global `fetch` is the reviewed ordinary request transport. Raw alternate transports are forbidden, while executable script loading is separately frozen to the Google GIS and official YouTube IFrame API authorities. New transport ownership is therefore a security architecture change rather than an ordinary implementation detail.

Google Workspace API calls receive an authorized fetch from `src/google/oauth/authority.ts`, which enforces HTTPS and an explicit Google API hostname set. Raw service classes remain behind the reviewed tool-handler boundary. Mutation execution must continue through the shared confirmation policy/broker path.

YouTube search, playback readiness and key validation use reviewed Google API endpoints with injectable fetch seams for tests. The runtime key stays in a request header, never in a URL. Autonomy cloud pairing accepts only HTTPS worker targets without embedded credentials, query strings or fragments.

Google permission and mutation confirmation dialogs build DOM nodes directly and assign untrusted/display text through `textContent`; runtime code does not retain arbitrary HTML parsing/injection authority.

## 8. Verification

Primary checks are `npm run security:check`, `npm run verify:gates`, the complete unit/Worker/E2E matrix and `npm run reliability:check`. Credential changes require behavioral tests proving sensitive material does not reach ordinary persistence. `src/autonomy/cloud/pairing.test.ts` explicitly verifies the installation token is absent from pairing localStorage.

## 9. Known boundary

Repository gates materially reduce accidental or unauthorized capability expansion, but a repository cannot externally protect its own workflow/ruleset configuration from an actor who is authorized to rewrite every guard simultaneously. CI/supply-chain/ruleset hardening remains a separate change-control layer.