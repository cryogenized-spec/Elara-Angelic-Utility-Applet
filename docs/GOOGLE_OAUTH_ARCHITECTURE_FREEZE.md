# Google / OAuth Architecture Freeze

This is the authoritative contract for Google Workspace authorization and tool policy.
Implementation follows it; later features must not reopen it.

## Invariants

1. Gemini supplies intent.
2. The tool registry supplies a named capability and a risk class.
3. The authorization layer supplies authority.
4. The confirmation layer supplies mutation consent.
5. The service adapter supplies Google execution.
6. The model may name a registered capability. The model may never grant capability, start GIS, or see tokens, scopes, client secrets, or provider URLs.

A **provider scope is not an application capability**. A capability may be satisfied by one or more provider grants. One provider grant may satisfy multiple application capabilities. Application policy remains authoritative even when Google already considers the underlying scope granted.

Authorization state must represent this chain, in this order:

```
application capability
        ↓
required provider scope(s)
        ↓
actual provider scopes granted
        ↓
effective capabilities
```

The provider grant establishes technical possibility. The Elara capability grant establishes application authority.

**Never infer an application write capability merely because the provider scope is sufficient.**

Example: Google scope `drive.file` is technically sufficient for Docs/Sheets/Drive app-file reads *and* writes. Elara still requires an explicit write capability:

```
Google scope:
  drive.file

Elara capabilities:
  docs.read         ✓  (inferred sibling read, if a drive.file capability is already enabled)
  sheets.read       ✓
  drive.files.app.read ✓
  docs.write        ✗  (never inferred)
  sheets.write      ✗
  drive.files.app.write ✗
```

## Credential transports

Interactive (current): GIS token client → short-lived access token in memory.

Durable (later, separate subsystem — not the Gemini Worker): authorization code + PKCE → protected refresh-capable authority.

The capability model is independent of transport.

> Note (2026-09-12): account identity in the interactive transport is real but best-effort. The GIS token client exposes no signed-in account object, so `authority.ts` requests `userinfo.email openid` alongside every capability scope and fetches a userinfo endpoint with the access token to populate the stored `account` (email, displayName). If userinfo is unavailable, authorization still succeeds and the record simply carries no account rather than an invented one; a silent `prompt: 'none'` refresh keeps the previous account on userinfo failure, while an interactive failure clears a stale account so the UI never shows a wrong email. No field is fabricated to fill this gap.

## Risk policy (v1)

```
READ         → execute when an authorizing capability is effective
WRITE        → capability + confirmation
SEND         → capability + confirmation
DESTRUCTIVE  → capability + explicit confirmation
BATCH/OPAQUE → not Gemini-visible
```

OAuth answers “may Elara use this capability?”
Confirmation answers “may Elara perform this mutation now?”

No write auto-approval in v1.

## v1 Workspace surface

In: Calendar, Tasks, Gmail, Drive, Docs, Sheets.
Out: Google Chat (deferred; must not appear in Settings, default Gemini tools, or `connected`).

## Drive composition

```
drive.files.app.read / drive.files.app.write  →  drive.file   (app-file boundary)
drive.library.read                            →  drive.readonly (corpus discovery)
```

A Docs/Sheets/Drive **read** is authorized if either:

1. the matching app-file read capability is effective, or
2. `drive.library.read` is effective and the operation is a read.

Library grant never authorizes writes. There is no `drive.library.write` in v1.

## Semantic Gemini tools

Gemini does not receive `docs.batchUpdate`, `sheets.batchUpdate`, raw Calendar event bodies, raw Chat message objects, or raw RFC822 send. Those remain adapter primitives.

## Tasks vs Calendar

Tasks are obligations. Calendar is allocated time. Only an explicit scheduling operation may link them. Task writes must not create calendar events.

## Authorization UX

Settings is canonical. Conversation may render an app-owned capability-request card from `AUTHORIZATION_REQUIRED`. GIS starts only from application UI → the OAuth authority.
