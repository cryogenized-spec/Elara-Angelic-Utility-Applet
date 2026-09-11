# Prompt 12 — API Lockbox

## Status

Accepted.

The Lockbox is the central ownership boundary for protected secrets and sensitive configuration. It is deliberately a narrow boundary, not a generic secret manager exposed to the whole application.

## Protected material

Classify as protected: application-owned Gemini API credentials, Google OAuth tokens/client secrets where applicable, Worker bindings, webhook secrets, signing material, and credential-bearing configuration.

Classify as safe public configuration: model IDs, feature flags, non-secret UI configuration, public API base URLs where appropriate, and display metadata.

## Access model

Consumers receive the minimum capability required for an operation. No component receives a general-purpose `getSecret()` API. Secrets never enter React context, ordinary state stores, conversation records, analytics, diagnostic exports, or log payloads.

## Credential records

The Lockbox stores a keyed set of encrypted credential records rather than a single key. Each record has a fixed, compile-time identity — currently `gemini-api-key` and `youtube-api-key` — and is read and written only through that credential's own named accessors. There is no runtime lookup by arbitrary identifier, so generalizing the store does not weaken the access model above.

The `gemini-api-key` record is the security authority. It alone carries the security metadata: the mode (`off`, `password`, `pin`, `passkey`), the failed-attempt counter, and the lockout deadline. Secondary records inherit the mode from it and are encrypted with the same unlock credential, so one unlock opens every credential in the Lockbox.

Because a secondary record can have been written under a credential that no longer matches the primary, an unlock decrypts the primary first — with full backoff accounting — and then decrypts secondaries best effort. A secondary that fails to open is recorded and surfaced as its own `mismatch` status instead of failing the unlock. The user is told to save it again under the current credential; the undecryptable value is never displayed or echoed.

Two invariants follow from the shared authority and are covered by tests:

- Changing the Lockbox PIN re-encrypts every secondary record, not just the Gemini key. Otherwise a rotation would permanently orphan them.
- Clearing the Lockbox removes every credential record. An orphaned secondary inherits its mode from the primary, so with the primary gone it would report itself unlocked while being impossible to decrypt.

A credential added while security mode is `off` is encrypted with a device-local key generated for that purpose; it is not stored in plaintext, and it remains readable while security stays off.

The stored value of any credential is write-only. The Settings surface reports a credential as configured, locked, or mismatched, and never renders the saved value back into the page.

## Gemini

Although `@google/genai` supports browser initialization, production Elara must not bundle an application-owned Gemini secret into the client. The protected credential is supplied at the approved Worker/security boundary.

## Cloudflare Worker health

The Settings Lockbox includes a safe health surface for the deployed Cloudflare Gemini Worker. The browser calls `GET /health`, which is non-generative and therefore does not consume a Gemini model request merely to test service liveness.

The health response exposes only non-secret state: service identity, healthy/degraded status, whether the protected Gemini credential is configured, whether an origin policy is configured, and an API marker. The UI maps those results to **Healthy** (green), **Alert** (yellow), or **Failure / offline** (red), while retaining a neutral not-checked state and a transient checking state.

The health panel remains presentational. It does not access `GEMINI_API_KEY`, OAuth tokens, system instructions, conversation content, or raw provider errors.

## Google Workspace

OAuth access material remains under one authorization authority. Calendar, Tasks, Docs, and Chat services receive narrow authenticated capabilities rather than raw tokens. Later tool calls cannot bypass scope enforcement.

## Tool calling

Model-visible tool schemas are safe declarations of permitted capability. They are not credentials and do not grant direct execution access. A requested tool call is validated and executed by the responsible application service. Side-effecting Workspace tools additionally require the later write-confirmation policy.

## Character system prompt

The character master system instruction is protected as application behavior/configuration rather than ordinary user content. It is supplied through a controlled prompt-building boundary and kept separate from tool schemas and conversation history. Prompt 27 will define its production content.

## Memory/notes

Future durable memory notes are application data, not secrets, but remain separate from the Lockbox and conversation state. They must never be allowed to become a path for credentials or authorization material.

## Forbidden flows

No API key in source control; no application-owned Gemini key in browser bundle; no token in diagnostics/analytics; no secret in conversation text; no arbitrary model-supplied function name executed without registry validation; no Workspace service bypassing the shared OAuth authority.

## Ownership

The Lockbox owns classification and access to protected configuration. It does not own chat state, persistence schema, tool execution, prompt composition, or provider lifecycle.
