# Google Scope Registry

Prompt 38 defines one authoritative registry for Google OAuth scopes.

## Ownership

Only the OAuth authority owns grant state, token handling, and scope authorization. Feature modules request named capabilities from this registry; they do not hard-code ad-hoc consent flows.

## Registry rules

- Every scope has a stable application capability key, provider scope string, access level, data sensitivity classification, and owning feature.
- Features request the narrowest scope that satisfies the operation.
- Read-only and write-capable scopes remain distinct whenever Google exposes distinct scopes.
- Registry entries are reviewable configuration, not user-controlled strings.
- Unknown scope keys are rejected before authorization.
- Tool schemas never contain OAuth scope strings or tokens.
- A granted scope is not treated as proof that a feature is currently available; current account state, token validity, service availability, and per-operation authorization remain separate checks.

## Initial Workspace capabilities

Calendar is the first implemented Workspace capability. Calendar event reads are isolated from Calendar writes. Tasks and Gmail have now been brought forward as first-class orchestration dependencies; Docs remains a focused document boundary. Future Chat entries continue using this same registry.

The current application capability keys are:

- `calendar.events.read` / `calendar.events.write`
- `calendar.list.read` / `calendar.settings.read`
- `tasks.read` / `tasks.write`
- `docs.read` / `docs.write`
- `chat.read` / `chat.write`
- `gmail.read` / `gmail.modify` / `gmail.send`

The registry deliberately uses application-owned capability names so the rest of the code does not depend on provider scope strings. Gmail's current Google scope catalog includes separate read-only, modify, send, labels, metadata, and settings scopes; the exact provider mapping should be narrowed further when each Gmail operation is promoted to a production capability. citeturn757480search0turn757480search1

## Verification and least privilege

Google's current documentation recommends the narrowest practical scopes and explains that sensitive/restricted scopes can trigger verification requirements. Scope choice must therefore follow the exact feature operation rather than requesting broad Calendar, Gmail, or Drive-like access up front. citeturn616269search0turn616269search1turn616269search8turn757480search0

## Non-goals

This document does not implement token storage, OAuth redirect handling, consent UI, or individual Workspace API clients. Those remain owned by the OAuth authority and feature-specific service boundaries.
