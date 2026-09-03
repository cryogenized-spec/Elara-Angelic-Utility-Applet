# Prompt 12 — API Lockbox

## Status

Accepted.

The Lockbox is the central ownership boundary for protected secrets and sensitive configuration. It is deliberately a narrow boundary, not a generic secret manager exposed to the whole application.

## Protected material

Classify as protected: application-owned Gemini API credentials, Google OAuth tokens/client secrets where applicable, Worker bindings, webhook secrets, signing material, and credential-bearing configuration.

Classify as safe public configuration: model IDs, feature flags, non-secret UI configuration, public API base URLs where appropriate, and display metadata.

## Access model

Consumers receive the minimum capability required for an operation. No component receives a general-purpose `getSecret()` API. Secrets never enter React context, ordinary state stores, conversation records, analytics, diagnostic exports, or log payloads.

## Gemini

Although `@google/genai` supports browser initialization, production Elara must not bundle an application-owned Gemini secret into the client. The protected credential is supplied at the approved Worker/security boundary.

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