---
id: SYS-SEC
status: active
verified_commit: 85f2c3bca5193775b31ac3347e4938ebb40f262e
scope: browser credential boundaries and security architecture enforcement
paths: [src/persistence/gemini-api-key.ts, src/persistence/gemini-passkey.ts, src/persistence/gemini-lockbox-settings.ts, src/autonomy/cloud/credential.ts, src/autonomy/cloud/pairing.ts, src/gemini/google-tool-loop.ts, scripts/security-architecture-gate.mjs]
keywords: [lockbox, credential, secret, pin, passkey, encryption, capability, egress, confirmation, oauth, fail-closed]
---

# Security and credential boundaries

## 1. Purpose and boundary

`SYS-SEC` defines credential handling and repository-level capability change control. The browser Lockbox stores Gemini and named secondary API credentials behind one security authority. The self-hosted Worker installation token is a separate device credential. Google refresh credentials are a third boundary owned by the user's Worker OAuth vault and never enter browser persistence.

Elara is self-hosted shareware: deployment owners supply and control their own provider credentials and Worker. There is no shared Elara credential service.

## 2. Runtime architecture

```text
Gemini / YouTube credential
-> Lockbox security mode
-> encrypted Dexie secrets store
-> explicit unlock session
-> named accessor
-> owning provider
```

```text
self-hosted Worker installation token
-> pairing input
-> AES-GCM device-local credential store
-> pairing resolver
-> reviewed runtime consumers only:
   - autonomy cloud transport
   - Google OAuth browser authority
```

```text
Google refresh credential
-> GIS popup authorization code
-> signed browser -> self-hosted Worker exchange
-> GoogleOAuthVault
-> AES-GCM encrypted Worker persistence
-> refresh happens inside Worker
-> only short-lived access token returns to browser memory
```

## 3. Source map

| Concern | Authority |
| --- | --- |
| Lockbox encrypted store/session | `src/persistence/gemini-api-key.ts` |
| Passkey integration | `src/persistence/gemini-passkey.ts` |
| PIN/security settings | `src/persistence/gemini-lockbox-settings.ts` |
| Lockbox UI | `src/app/components/GeminiApiLockbox.tsx` |
| Autonomy/Worker credential store | `src/autonomy/cloud/credential.ts` |
| Pairing metadata/runtime resolver | `src/autonomy/cloud/pairing.ts` |
| Reviewed installation-token consumers | `src/autonomy/cloud/client.ts`, `src/google/oauth/authority.ts` |
| Durable Google refresh vault | `worker/src/google/oauth-vault.ts` |
| Worker OAuth admission | `worker/src/google/oauth-routes.ts` |
| Model tool authority/confirmation | `src/gemini/google-tool-loop.ts` |
| Capability expansion gate | `scripts/security-architecture-gate.mjs` |
| Gate/CI integrity | `scripts/check-verification-integrity.mjs` |

## 4. Data and cryptography

The Lockbox database is `elara-gemini-lockbox`, with secrets keyed by secret ID. Protected passphrase/PIN records use PBKDF2-SHA-256 to derive an AES-GCM key with random salt/IV. Unlocked plaintext lives only in the in-memory session map. `off` mode still uses a device-local non-extractable Web Crypto key rather than plaintext persistence.

The Worker installation token uses a dedicated Dexie store, AES-GCM-256 and a non-extractable device-local CryptoKey. `elara.autonomy.pairing.v1` stores pairing metadata only. Legacy pairing records containing plaintext token material migrate loss-safely: plaintext is removed only after the protected write succeeds.

The Google refresh token is not a browser secret at all. `GoogleOAuthVault` derives an AES-GCM key from the deployment-owned `GOOGLE_OAUTH_VAULT_KEY` using a domain-separation context, encrypts with a random 12-byte IV and stores ciphertext/IV in the SQLite-backed Durable Object. The refresh token is decrypted only inside the Worker when exchanging for a new short-lived access token or revoking the grant.

Browser Google access tokens remain memory-only. Browser localStorage contains only non-secret capability/scope/account metadata.

## 5. Credential invariants

- Gemini credentials are never `VITE_*` build variables.
- `VITE_GOOGLE_CLIENT_ID` is public OAuth client identification, not a secret.
- Google client secret and vault key remain Worker-only deployment secrets.
- Secrets never appear in model-visible schemas, conversation records, cache keys, URLs, analytics or diagnostic exports.
- Lockbox consumers use named minimum-capability accessors.
- The installation token is never serialized into new pairing JSON or placed in a network target.
- Only `src/autonomy/cloud/pairing.ts` directly imports the installation credential store.
- Only `src/autonomy/cloud/client.ts` and `src/google/oauth/authority.ts` may consume `resolvePairingToken` at runtime.
- Credential-bearing modules do not gain `console.*` logging authority without explicit security review.
- Google refresh tokens never return to the browser, Gemini, Workspace tool schemas or autonomy storage.
- Lock/idle enforcement clears in-memory Lockbox plaintext.
- Corrupt/undecryptable sealed material fails closed.
- Cryptographic/storage migration failures preserve recoverable legacy state instead of deleting the only credential.

## 6. Capability change-control boundary

`npm run security:check` is a dependency-free pre-install CI gate. New runtime power is an architecture event. The reviewed surface freezes:

- dynamic evaluation/raw HTML injection and alternate browser transports, which are forbidden;
- Node filesystem/process/network/VM host authorities in runtime code, which are forbidden;
- the reviewed Google GIS and official YouTube script loaders and exact provider URLs;
- approved local browser Worker constructors;
- Dexie database owners;
- Lockbox plaintext consumers;
- installation-token store and runtime consumers;
- global outbound fetch owners/references and reviewed provider destinations;
- the durable Google OAuth browser brokerage markers (`requestGoogleAuthorizationCode`, signed Worker write, paired credential resolution and refresh route);
- Google service import boundaries;
- shared Google mutation confirmation-broker consumers.

The verification-integrity gate pins `security:check`, CI ordering and the guarded capability classes. Adversarial mutation sentinels must continue to prove that forbidden authority fails closed.

## 7. Network, OAuth and confirmation boundaries

Global `fetch` is the reviewed ordinary request transport. Google Workspace API calls receive an authorized fetch from `src/google/oauth/authority.ts`, which enforces HTTPS and an explicit Google API hostname set.

For a paired installation, the same authority may contact only the paired self-hosted Worker URL after validating HTTPS and URL shape. Protected OAuth writes are HMAC-signed with method/path/timestamp/nonce/body. The public Worker verifies admission and the `GoogleOAuthVault` independently verifies the write and records the nonce durably. Authorization-code exchange additionally requires `X-Requested-With: XmlHttpRequest` and exact request-origin/redirect-origin equality.

A mutation confirmation is time-bounded application authority, not an OAuth grant. Google scopes do not bypass the shared confirmation policy. Confirmation freshness is rechecked around delayed OAuth or grouped-approval flows.

The Worker CORS allowlist is deployment-owned configuration. A fork must configure its own exact PWA origin; it must not rely on another deployment's allowlist.

## 8. Verification

Primary checks are `npm run security:check`, `npm run verify:gates`, unit/Worker/E2E tests and `npm run reliability:check`.

Google durable-auth verification covers encrypted-at-rest persistence, refresh without browser interaction, signed admission, durable replay rejection, popup CSRF, origin mismatch, CORS, disconnect/revocation and proof that browser persistence contains no access/refresh/installation credential material.

Existing Lockbox/adversarial tests continue to cover corrupt ciphertext, stale protection stamps, rotation/orphan prevention and locked-session write refusal. Autonomy credential tests continue to require a fail-closed empty read from corrupt sealed material.

## 9. Known boundary

A repository cannot externally protect its own workflow/ruleset configuration from an actor authorized to rewrite every guard simultaneously; CI/supply-chain/ruleset hardening remains a separate layer.

The existence of durable Google credentials is not permission for autonomous Google execution. Future orchestration must add explicit tool/execution authority rather than treating credential availability as consent.
