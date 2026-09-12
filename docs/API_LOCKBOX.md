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

The `gemini-api-key` record is the security authority. It alone carries the security metadata: the mode (`off`, `password`, `pin`, `passkey`), the failed-attempt counter, and the lockout deadline. Secondary records are encrypted with the same unlock credential, so one unlock opens every credential in the Lockbox.

The authority's mode is the only one that governs access. A secondary record stores a copy of that mode, but the copy is treated as advisory: read paths resolve the *effective* mode from the Gemini record. This matters because a stored copy goes stale whenever the authority changes through a path the secondary was not migrated by, and honouring the copy — as an earlier revision did — left a secondary stamped `off` (sealed with a device-local key, therefore readable with no credential at all) readable indefinitely after the Lockbox had been re-armed with a PIN.

A secondary write must prove the caller holds the authority's actual current credential: the store decrypts the Gemini record with the supplied secret and fails closed otherwise. Verifying is only permitted from an already-unlocked session, so this path cannot become a credential-guessing oracle beside the primary's backoff. A secondary also cannot be created while the Gemini record is absent — with no authority there is nothing to inherit protection from, and the record would report itself usable while being impossible to re-arm. Previously the store accepted any non-empty string, which made the Settings screen the only thing between a mistyped credential and a permanently unreadable key.

Because a secondary record can still exist from legacy or damaged storage under a credential that no longer matches, an unlock decrypts the primary first — with full backoff accounting — and then decrypts secondaries best effort. A secondary that fails to open is recorded and surfaced as its own `mismatch` status instead of failing the unlock. The user is told to save it again under the current credential; the undecryptable value is never displayed or echoed.

Three invariants follow from the shared authority and are covered by tests:

- Changing the Lockbox credential re-seals every secondary record, not just the Gemini key — on PIN rotation, on password re-save, and on security re-arm. Otherwise a rotation permanently orphans them. This includes a secondary whose protection class has gone stale, which is migrated rather than skipped.
- Security mode transitions move every secondary the store can open onto the new protection, in both directions. A secondary it cannot open is left sealed under its existing credential and reported as `mismatch`; it is never weakened to match the authority.
- Clearing the Lockbox removes every credential record. An orphaned secondary would report itself unlocked while being impossible to decrypt.

A credential added while security mode is `off` is encrypted with a device-local key generated for that purpose; it is not stored in plaintext, and it remains readable only while the *authority* stays `off`.

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
