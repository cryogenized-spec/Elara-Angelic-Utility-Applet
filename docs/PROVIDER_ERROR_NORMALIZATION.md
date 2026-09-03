# Provider Error Normalization

## Purpose

Convert Gemini, Worker, network, timeout, cancellation, and validation failures into one safe application error model.

## Rules

A user-facing state must never depend on parsing raw SDK exception text in the UI. Provider errors are normalized once at the provider boundary and then consumed by chat/diagnostics.

Each normalized error contains:

- stable category
- stable code
- human-safe message
- retryability
- cancellation status
- provider status when known
- request/interaction identifier when safe
- elapsed time
- original cause retained only in non-user diagnostic scope

## Categories

`validation`, `authentication`, `authorization`, `rate_limit`, `timeout`, `cancelled`, `network`, `provider`, `unsupported`, `configuration`, and `unknown`.

## HTTP mapping

The normalizer recognizes the documented Gemini failure families including 429 rate/quota limits, 499 client cancellation, 500 server errors, 501 unsupported operations, 503 service unavailable, and 504 deadline exceeded. The application may additionally normalize 400/401/403/404/408/409/413/415/422 and related gateway/network failures at the Worker boundary.

The UI receives the category/code rather than raw upstream text or credentials.

## Retryability

Retryability is explicit. A transient service-unavailable or deadline failure may be retryable; validation, permission, unsupported-capability, and cancellation errors are not automatically retried.

## Security

Never expose API keys, OAuth tokens, request bodies, user message content, full authorization headers, or raw provider payloads through user-facing errors or diagnostics.

## Architecture

```text
Gemini/HTTP/Network exception
          ↓
canonical provider normalizer
          ↓
NormalizedProviderError
       ↙         ↘
 chat state     diagnostics
```

## Current upstream verification

Google's current API error guidance documents `429`, `499`, `500`, `501`, `503`, and `504` failure classes and distinguishes retryable service/quota conditions from cancellation and unsupported operations. citeturn901754search2
