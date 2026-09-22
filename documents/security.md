---
id: SYS-SEC
status: active
verified_commit: 9c3ddd82851eb0c1f8d7e6680e54414481b53a6e
scope: browser credential boundaries and security architecture enforcement
paths: [src/persistence/gemini-api-key.ts, src/persistence/gemini-passkey.ts, src/persistence/gemini-lockbox-settings.ts, src/autonomy/cloud/credential.ts, src/autonomy/cloud/pairing.ts, src/gemini/google-tool-loop.ts, scripts/security-architecture-gate.mjs]
keywords: [lockbox, credential, secret, pin, passkey, encryption, capability, egress, confirmation, oauth, fail-closed]
---

# Security and credential boundaries

## 1. Purpose and boundary

`SYS-SEC` defines credential handling and repository-level capability change control. The browser Lockbox stores Gemini and named secondary API credentials behind one security authority. The self-hosted Worker installation token is a separate device credential. Google refresh credentials and ClickUp access credentials are provider-specific Worker vault boundaries and never enter browser persistence.

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
   - ClickUp OAuth browser authority
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

```text
ClickUp access credential
-> either OAuth code exchange OR Worker-configured personal API token
-> signed browser credential-establishment request
-> ClickUpOAuthVault
-> identity + accessible Workspaces verified with ClickUp
-> provider credential AES-GCM encrypted in Worker persistence
-> provider REST executes inside the vault
-> provider credential never returns to the browser

personal-token mode
-> browser sends only a signed empty activation request
-> Worker reads CLICKUP_PERSONAL_TOKEN from its secret environment
-> token is never accepted from browser input
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
| Reviewed installation-token consumers | `src/autonomy/cloud/client.ts`, `src/google/oauth/authority.ts`, `src/clickup/oauth/authority.ts` |
| Durable Google refresh vault | `worker/src/google/oauth-vault.ts` |
| Google Worker OAuth admission | `worker/src/google/oauth-routes.ts` |
| Durable ClickUp access-token vault | `worker/src/clickup/oauth-vault.ts` |
| ClickUp Worker OAuth admission | `worker/src/clickup/oauth-routes.ts` |
| ClickUp REST egress | `worker/src/clickup/provider.ts` |
| Model tool authority/confirmation | `src/gemini/google-tool-loop.ts` |
| Capability expansion gate | `scripts/security-architecture-gate.mjs` |
| Gate/CI integrity | `scripts/check-verification-integrity.mjs` |

## 4. Data and cryptography

The Lockbox database is `elara-gemini-lockbox`, with secrets keyed by secret ID. Protected passphrase/PIN records use PBKDF2-SHA-256 to derive an AES-GCM key with random salt/IV. New encrypted writes use 600,000 PBKDF2 iterations. Existing records retain their stored iteration count so upgrades do not strand credentials. New or rotated PIN protection requires 10–12 numeric digits; legacy 6–8 digit PIN records remain unlockable and may be upgraded in place. Passkey or a strong password is the preferred posture when copied-profile/offline guessing resistance matters. Unlocked plaintext lives only in the in-memory session map. `off` mode still uses a device-local non-extractable Web Crypto key rather than plaintext persistence.

The Worker installation token uses a dedicated Dexie store, AES-GCM-256 and a non-extractable device-local CryptoKey. `elara.autonomy.pairing.v1` stores pairing metadata only. Legacy pairing records containing plaintext token material migrate loss-safely: plaintext is removed only after the protected write succeeds.

The Google refresh token is not a browser secret at all. `GoogleOAuthVault` derives an AES-GCM key from the deployment-owned `GOOGLE_OAUTH_VAULT_KEY` using a domain-separation context, encrypts with a random 12-byte IV and stores ciphertext/IV in the SQLite-backed Durable Object. The refresh token is decrypted only inside the Worker when exchanging for a new short-lived access token or revoking the grant.

Browser Google access tokens remain memory-only. Browser localStorage contains only non-secret capability/scope/account metadata. ClickUp provider credentials do not enter browser memory at all; only schema-validated non-secret account/Workspace connection metadata may persist locally. Inside the encrypted ClickUp vault payload, credential kind is stored as a separate discriminant from token bytes. Legacy raw vault plaintext is treated as OAuth only, so no token prefix or sentinel can silently change Authorization semantics.

## 5. Credential invariants

- Gemini credentials are never `VITE_*` build variables.
- `VITE_GOOGLE_CLIENT_ID` is public OAuth client identification, not a secret.
- Google client secret and vault key remain Worker-only deployment secrets.
- ClickUp OAuth client secret, OAuth access token, personal API token and vault key remain Worker-only; provider credentials stay inside `ClickUpOAuthVault` during normal execution.
- Secrets never appear in model-visible schemas, conversation records, cache keys, URLs, analytics or diagnostic exports.
- Lockbox consumers use named minimum-capability accessors.
- The installation token is never serialized into new pairing JSON or placed in a network target.
- Only `src/autonomy/cloud/pairing.ts` directly imports the installation credential store.
- Only `src/autonomy/cloud/client.ts`, `src/google/oauth/authority.ts` and `src/clickup/oauth/authority.ts` may consume `resolvePairingToken` at runtime.
- Credential-bearing modules do not gain `console.*` logging authority without explicit security review.
- Google refresh tokens never return to the browser, Gemini, Workspace tool schemas or autonomy storage.
- ClickUp OAuth access tokens and personal API tokens never return to the browser, Gemini, MCP schemas, conversation state or autonomy storage.
- ClickUp credential kind is structural encrypted metadata, never inferred from token contents.
- An ambiguous ClickUp connection write triggers authoritative status reconciliation; if that also fails, cached ClickUp status is cleared so stale identity metadata cannot authorize tool election.
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
- the ClickUp paired-Worker OAuth/personal-token authority, encrypted vault, internal provider-command boundary and exact ClickUp API origins;
- Google service import boundaries;
- shared Google mutation confirmation-broker consumers.

The verification-integrity gate pins `security:check`, CI ordering and the guarded capability classes. Adversarial mutation sentinels must continue to prove that forbidden authority fails closed.

## 7. Network, OAuth and confirmation boundaries

Global `fetch` is the reviewed ordinary request transport. Google Workspace API calls receive an authorized fetch from `src/google/oauth/authority.ts`, which enforces HTTPS and an explicit Google API hostname set. ClickUp browser egress is restricted to the paired HTTPS Worker; ClickUp provider egress is server-side and fixed to `https://api.clickup.com/api/v2` plus the documented OAuth token endpoint.

For a paired installation, the Google and ClickUp browser authorities may contact only the paired self-hosted Worker URL after validating HTTPS and URL shape. Protected OAuth writes are HMAC-signed with method/path/timestamp/nonce/body. The public Worker verifies admission and the `GoogleOAuthVault` independently verifies the write and records the nonce durably. Authorization-code exchange additionally requires `X-Requested-With: XmlHttpRequest` and exact request-origin/redirect-origin equality.

A mutation confirmation is time-bounded application authority, not an OAuth grant. Google scopes do not bypass the shared confirmation policy. Confirmation freshness is rechecked around delayed OAuth or grouped-approval flows. External provider reads taint later model continuations; mutations proposed after that taint receive an `untrustedContext` warning, start unselected, and cannot be approved until the human explicitly selects them. Tainted content also cannot recursively widen private Workspace reads. Automatic relevant/proactive memory recall is treated as ambient context for the user's fresh-turn request: it elevates later mutations but does not permanently suppress an explicit Workspace read on every new turn; explicit mid-turn `memory.lookup`/`memory.recall` results do taint subsequent private reads. Public YouTube discovery remains repeatable, while the only reviewed private-read continuation is a Drive download whose file ID was surfaced by a same-turn Drive search and whose bytes remain outside model context. Multi-action batches likewise start unselected and expose no approve-all shortcut. Confirmation review payloads are schema-validated and bounded at 1,250,000 characters; if a valid confirmation request cannot be constructed, the mutation fails closed rather than falling through to another execution path. The human-facing watchdog does not display raw JSON argument objects, dotted implementation tool IDs, grant revisions, cryptographic hashes, or RPC/schema envelopes. Full validated mutation detail is projected into plain-language provider/action labels and field/value review text, while exact security bindings and validated arguments remain internal authorities. Large reviews may expand the presentation surface, but this changes no approval authority: the heading and decision controls remain outside the scrolling review region. Attachment previews are independently bounded and are produced only for explicit text-readable MIME types from the same immutable pre-approval Blob; binary content is not opportunistically decoded. Human/provider-controlled review text is rendered through `textContent`, never HTML, and receives bidi plaintext isolation so Unicode direction controls cannot visually reorder surrounding approval chrome. Android Playwright geometry checks keep the expanded dialog and decision controls inside the canonical 412×915 viewport, while the remote visual-evidence fixture records base/head screenshots and confirms hostile markup remains inert text.

The optional Worker's Gemini/transcription provider routes require the deployment installation bearer credential on every request; CORS is an additional browser boundary, never authentication. Originless or spoofed-origin HTTP clients cannot consume the deployment's Gemini credential without the installation token. The Worker CORS allowlist is deployment-owned configuration. A fork must configure its own exact PWA origin; it must not rely on another deployment's allowlist.

Cross-tab session state is part of the credential boundary. A protected Lockbox lock, idle timeout, or credential change clears the current tab's plaintext session and writes only an opaque revocation nonce to a dedicated Web Storage key; sibling tabs consume that signal and clear their own in-memory Gemini and YouTube plaintext. No credential, derived key, or protection metadata is carried through Web Storage.

Browser Google OAuth access tokens remain tab-memory-only. Any sibling-tab change to the shared authorization record invalidates the local token, and the authorization record revision is rechecked immediately before each Google API egress. Silent token recovery must prove continuity with the previously known Google account; ambiguity or mismatch requires explicit reauthorization.

The optional Worker Gemini endpoint authenticates before body processing, reads JSON through a finite byte budget, and relays provider SSE through finite event, text, thought, and byte budgets. Authentication is never treated as permission for unbounded resource consumption.

## 8. Verification

Primary checks are `npm run security:check`, `npm run verify:gates`, unit/Worker/E2E tests and `npm run reliability:check`.

Google durable-auth verification covers encrypted-at-rest persistence, refresh without browser interaction, signed admission, durable replay rejection, popup CSRF, origin mismatch, CORS, disconnect/revocation and proof that browser persistence contains no access/refresh/installation credential material. ClickUp verification covers encrypted OAuth/personal-token persistence, one-time OAuth state, signed-write replay rejection, redirect/origin binding, proof that personal-token activation sends no token from the browser, binding-internal provider admission, adaptive rate-limit suppression, provider-credential invalidation and proof that browser persistence contains only non-secret metadata.

Existing Lockbox/adversarial tests continue to cover corrupt ciphertext, stale protection stamps, rotation/orphan prevention and locked-session write refusal. Autonomy credential tests continue to require a fail-closed empty read from corrupt sealed material.

## 9. Known boundary

A repository cannot externally protect its own workflow/ruleset configuration from an actor authorized to rewrite every guard simultaneously; CI/supply-chain/ruleset hardening remains a separate layer.

The existence of durable Google or ClickUp credentials is not permission for autonomous provider execution. Future orchestration and model-visible ClickUp MCP tools must add explicit tool/execution authority and preserve the existing confirmation boundary rather than treating credential availability as consent.
