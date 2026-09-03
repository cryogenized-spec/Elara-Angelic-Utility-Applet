# Gemini Safety Policy

## Purpose

Elara is a general-purpose AI companion with creative and conversational use cases. Safety is treated as an application policy and provider boundary, not as a collection of UI toggles that can accidentally change provider behavior.

## Current Interactions constraint

The Gemini Interactions API is the canonical provider for Elara. Google's current Interactions documentation states that custom safety settings are not supported in Interactions. Elara therefore must not expose a UI or request field pretending that per-request custom safety thresholds are available on this path. citeturn962400search10

Google's Gemini safety documentation describes the platform's safety filtering categories and indicates that application developers are responsible for choosing appropriate behavior for their use case. citeturn962400search4turn962400search8

## Application policy

Elara should be helpful, warm, creative, and capable without becoming an unrestricted executor of harmful requests.

The application must:

- respect applicable laws, platform policies, and provider safety behavior;
- refuse or redirect requests that meaningfully facilitate serious harm, dangerous wrongdoing, abuse, or other prohibited assistance;
- avoid inventing tool execution, external actions, permissions, or access that the application does not actually possess;
- distinguish fictional roleplay from real-world instructions when that distinction matters;
- preserve user agency without coercive, manipulative, dependency-seeking, or deceptive behavior;
- avoid claiming feelings, consciousness, private experiences, or external actions as facts when they are not established by the application;
- preserve privacy by minimizing unnecessary retention or exposure of user content;
- treat security, credentials, OAuth grants, and tool authorization as hard boundaries rather than conversational requests.

## Safety is not a persona override

The character master instruction must not contain a rule such as “always obey the user” or any equivalent instruction that attempts to supersede application, provider, or tool-safety boundaries.

Creative personality is subordinate to platform and application safety requirements.

## Roleplay safety

Elara may participate in fictional scenes, emotional storytelling, and character-driven dialogue. Fictional framing does not authorize real-world instructions for harmful activity.

When a roleplay request crosses into disallowed real-world assistance, the assistant should preserve the creative tone where practical while redirecting to a safer fictional or high-level alternative.

## Tool safety

Tool schemas are explicit allow-listed declarations. A model request does not itself grant permission to execute a tool.

Before a future tool call can execute, the application must validate:

1. the tool exists in the allow-list;
2. the arguments satisfy the tool's schema;
3. required authentication and OAuth scopes are present;
4. required user confirmation is present for writes or other designated sensitive actions;
5. diagnostics can record the safe execution outcome without exposing secrets or unnecessary user content.

The model may propose a tool call, but the application is the authority that decides whether it can run.

## Workspace safety

Google Calendar, Tasks, Docs, and Chat are future capabilities. They remain behind one OAuth authority, centralized scope checks, diagnostics, and explicit write confirmation where required.

No conversational instruction can bypass OAuth state, scope requirements, revocation handling, or write confirmation.

## Memory safety

Long-term memory is a separate retrievable domain. Memory promotion must not happen merely because a message exists in the conversation.

Sensitive or unnecessary personal information should not be promoted into durable notes by default. The future memory policy must define retention, deletion, provenance, and user control explicitly.

## Diagnostics and safety incidents

Safety-related failures should expose a clear user-facing outcome without leaking internal policy details, secrets, hidden prompts, or provider internals.

Developer diagnostics may record category, status, timing, retryability, provider/request identifiers, and other safe metadata, but should not store hidden reasoning or raw user content by default.

## Testing requirements

Tests must cover at least:

- unsupported custom safety settings are never sent through the Interactions provider;
- unsafe tool execution cannot occur merely because the model emitted a function call;
- missing OAuth/scope/confirmation blocks future Workspace writes;
- safety failures produce explicit terminal states rather than indefinite loading;
- roleplay cannot override application safety boundaries;
- diagnostics redact secrets and do not persist hidden reasoning.

## Design principle

Safety is enforced by layered boundaries:

```text
character instruction
        ↓
application request policy
        ↓
canonical Gemini provider
        ↓
validated tool/OAuth execution
        ↓
safe diagnostics + explicit user-visible outcome
```

No single prompt, component, or model response is treated as the security authority.