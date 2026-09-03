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

Calendar is the first implemented Workspace capability. The preferred initial read capability is `calendar.events.readonly` for event-reading operations. Write-capable Calendar operations must request an explicit write scope and must also pass application write-confirmation policy before mutation.

Future Tasks, Docs, and Chat entries will be added to this same registry rather than creating service-specific OAuth registries.

## Verification and least privilege

Google's current documentation recommends the narrowest practical scopes and explains that sensitive/restricted scopes can trigger verification requirements. Scope choice must therefore follow the exact feature operation rather than requesting broad Calendar or Drive-like access up front. citeturn616269search0turn616269search1turn616269search8

## Non-goals

This document does not implement token storage, OAuth redirect handling, consent UI, or individual Workspace API clients. Those remain owned by the OAuth authority and feature-specific service boundaries.
