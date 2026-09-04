# Google Tool Execution Boundary

Pass 6 adds the centralized application-side execution gate for registered Google tools.

## Execution order

Every tool call must pass through this sequence:

`validated tool call → argument validation → registered descriptor → current OAuth capability state → risk/confirmation policy → focused service handler → normalized result`

The executor is `src/google/tools/executor.ts`.

## Authorization

The executor checks current normalized OAuth state before a handler is called. An operation whose required application capability is not currently granted returns `AUTHORIZATION_REQUIRED` and does not execute the handler.

The focused service adapter remains responsible for obtaining the authorized request through the single OAuth authority when it performs the provider call. The executor must never hold or expose Google access/refresh tokens.

## Confirmation

Read tools execute without confirmation.

Write, destructive, and send tools produce an explicit confirmation request. Confirmation includes the registered tool name, risk class, a non-secret operation description, and an ISO timestamp. Confirmation is considered valid only while inside the configured freshness window.

A missing confirmation callback returns `CONFIRMATION_REQUIRED`; a declined or stale approval returns `USER_DECLINED`.

## Diagnostics

Provider and authorization errors are normalized through `src/google/tools/diagnostics.ts`.

Returned diagnostics deliberately omit raw provider exception messages, access tokens, authorization headers, client secrets, and private Workspace payloads. Correlation IDs are generated for each execution attempt so higher layers can associate failures without exposing sensitive data.

## Drive and Sheets argument validation

Drive and Sheets calls use the explicit Zod contracts in `src/google/tools/drive-sheets-schemas.ts`. Unknown fields, empty identifiers, empty write payloads, and oversized batches are rejected before any service handler runs.

## Handler architecture

The executor accepts an application-owned handler map. This keeps tool policy separate from Google service implementations and permits each service adapter to remain independently testable.

No universal Google HTTP request tool is permitted. Handlers must be registered, capability-bound, and backed by a focused service adapter.

## Production prerequisite

The executor is an application-side policy boundary. It does not replace the protected Cloudflare OAuth authority. Full production execution still depends on the server-side authority being available and correctly issuing authorized requests.
