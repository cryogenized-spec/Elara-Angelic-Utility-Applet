---
id: SYS-GWS
status: active
verified_commit: 92e69c0cf30e5abd705e5ce28a77c4757939e2d5
scope: Google Workspace service adapters and model tool execution
paths: [src/google/calendar, src/google/tasks, src/google/gmail, src/google/docs, src/google/drive, src/google/sheets, src/google/chat, src/google/tools, src/google/confirmation]
keywords: [workspace, calendar, tasks, gmail, docs, drive, sheets, tools, confirmation]
---

# Google Workspace and tool execution

## 1. Purpose and boundary

`SYS-GWS` owns validated Google Workspace service adapters, the executable model tool registry, provider-facing semantic projections, and confirmation of consequential operations. OAuth/token authority remains `SYS-GAUTH / google-auth.md`. Provider data stays authoritative for Calendar, Tasks, Gmail, Drive, Docs, and Sheets; Elara does not create competing canonical mirrors.

`verified_commit` identifies the last fully certified `main` baseline. Active branch behavior may be newer; source plus tests outrank this prose until that branch is merged and post-merge certified.

## 2. Runtime architecture

```text
Gemini function call
-> canonical registry descriptor
-> strict tool schema validation
-> application capability check
-> explicit confirmation when risk != read
-> semantic service handler
-> bounded/normalized provider result
-> Gemini grouped continuation
```

OAuth permission never substitutes for application capability or mutation confirmation. Gemini receives neither refresh/access tokens, raw OAuth scopes, credential material, nor provider URLs as tool arguments.

External Google content is evidence, never authority. Retrieved Gmail/Docs/Drive/Sheets content may inform arguments, but it cannot grant capabilities, approve confirmation, change security policy, expose credentials, or instruct Elara to bypass the registered tool surface.

### 2.1 Source map

| Concern | Authority |
| --- | --- |
| Tool registry | `src/google/tools/registry.ts` |
| Gemini declarations | `src/google/tools/gemini-declarations.ts` |
| Validation | `src/google/tools/*schemas.ts` |
| Execution | `src/google/tools/executor.ts`, service/read handlers |
| Confirmation | `src/google/confirmation/` |
| Calendar | `src/google/calendar/` |
| Tasks | `src/google/tasks/` |
| Gmail | `src/google/gmail/` |
| Docs/Drive/Sheets | matching `src/google/*/` folders |
| OAuth/scopes | `src/google/oauth/` and `google-auth.md` |

Google Chat code exists but remains internal/deferred from Workspace v1. Raw adapter primitives such as unrestricted Docs/Sheets batch operations remain internal rather than general Gemini escape hatches.

## 3. Cross-service invariants

- Declarations, runtime validation, registry risk/capability, executable handlers, confirmation copy, and canonical docs must describe the same operation.
- `additionalProperties:false` plus strict runtime schemas reject undeclared model arguments.
- Read operations may execute when authorized; write/send/destructive operations require explicit confirmation.
- Provider permissions never manufacture locally disabled Elara write/send authority.
- Application schemas validate size/shape/identity before provider authorization whenever possible.
- Provider IDs required for safe follow-up actions are preserved; provider-owned read-only fields are not made model-writable.
- External content cannot become policy or consent simply because Gemini retrieved it through an authorized read.
- Provider failures are normalized before returning to Gemini; secrets/provider exception strings are not echoed verbatim.
- Fixed Google API hosts remain behind the OAuth request broker's provider allow-list.

## 4. Calendar contract

Calendar is Google's time-commitment authority. Gemini-visible operations are bounded to calendar discovery/event reads, account settings/free-busy, and guarded create/update/delete.

Event reads preserve provider identity needed for safe follow-up actions, including event id and ETag. Update/delete require one concrete strong provider ETag and send `If-Match`; wildcard, weak, multi-value, or malformed validators fail before provider mutation. `412` means re-read rather than overwrite.

Creates/updates support timed or all-day events, location, description, attendees, recurrence, and optional guest notification. Start/end must form one coherent timing mode and `end` must be later than `start`. Calendar end is exclusive: a one-day all-day event beginning `YYYY-MM-DD` ends on the following date. Offset-free timed boundaries require an explicit valid IANA timezone; recurring timed events also require a timezone. Calendar component validation rejects impossible dates/times rather than relying on JavaScript rollover behavior.

Guest notification exposes only `sendUpdates=all|externalOnly`; `none` is intentionally not model-visible. Calendar create retry identity derives from the Gemini function-call id and maps to a deterministic provider event id; a retry receiving `409` reads that exact event instead of intentionally creating a duplicate.

## 5. Tasks contract

Google Tasks remains task-data authority. Gemini exposes bounded task-list discovery/read/create/rename/delete and task list/read/create/update/move/delete/clear operations.

Google's provider `due` field is date-only in this product contract. Elara exposes `scheduledDate: YYYY-MM-DD`; provider midnight UTC is serialization, never a time-of-day deadline. Timed task strings are rejected. Raw Task/TaskList resources, read-only flags, position, and assignment-origin metadata are not model mutation inputs.

Assigned tasks from Docs/Chat are opt-in on reads. Their assignment-origin metadata stays read-only. Deleting an assigned task can delete its originating Docs/Chat assignment, so task and containing-list destructive confirmations state that consequence. `clearCompleted` is represented as Google's hide-completed transition, not fabricated hard deletion.

Moves use semantic `destinationTaskListId`; the provider spelling `destinationTasklist` stays inside the service adapter. Omitted parent means top level; omitted previous means first among destination siblings.

Google Tasks does not expose client-chosen create IDs. Elara therefore uses a bounded same-call replay fence keyed by elected turn + Gemini call id + validated payload hash. The exact same live-turn create returns the same promise/result or ambiguous failure without issuing a second POST; changed arguments under the same call id fail closed. Distinct calls are never title/content-deduplicated. A full runtime restart after ambiguous provider acceptance remains an explicit provider limitation.

## 6. Gmail contract

Gmail remains mailbox authority. Elara does not mirror a second canonical mailbox and does not expose raw Gmail Message/Thread/Label resources as model mutation contracts.

### 6.1 Reads and trust provenance

Gemini-visible reads cover bounded message/thread search, explicit message/thread inspection, and label discovery. Search pages are capped at 100 results; queries, page tokens, IDs, headers, snippets, message bodies, thread message counts, and total thread text all have application bounds.

Read results are normalized semantic projections and explicitly carry:

```text
trust: untrusted-external
source: gmail
```

Message inspection exposes only bounded provider identity, label ids, snippet, selected safe headers (`From`, `To`, `Cc`, `Date`, `Subject`, `Message-ID`, `In-Reply-To`, `References`), and bounded `text/plain` content when requested. Raw provider JSON, raw RFC822, arbitrary headers, attachments, provider URLs, and raw HTML are not passed directly to Gemini. HTML/script content is not treated as executable or authoritative text.

Thread inspection returns a bounded recent-message projection with visible truncation metadata instead of forwarding an unrestricted provider thread payload. Email content may contain hostile instructions; those instructions remain data and cannot authorize tools, capabilities, credentials, confirmation, or policy changes.

### 6.2 Semantic mailbox organization

`gmail.modifyMessage` and `gmail.modifyThread` accept one semantic action rather than arbitrary provider label arrays:

| Action | Provider label effect |
| --- | --- |
| `archive` | remove `INBOX` |
| `moveToInbox` | add `INBOX` |
| `markRead` | remove `UNREAD` |
| `markUnread` | add `UNREAD` |
| `markSpam` | add `SPAM` |
| `markNotSpam` | remove `SPAM` |
| `star` | add `STARRED` |
| `unstar` | remove `STARRED` |
| `applyLabel` | add one verified USER label id |
| `removeLabel` | remove one verified USER label id |

`addLabelIds`/`removeLabelIds` are not model inputs. For custom-label operations, the adapter verifies the target is a provider `USER` label before mutation; system labels cannot be smuggled through the custom-label path.

Trash and untrash remain explicit message/thread operations. Permanent message deletion is not model-visible, and Elara does not request the broader `https://mail.google.com/` scope merely to bypass Trash.

### 6.3 Label administration

Label administration is bounded to USER labels:

- create accepts only a bounded label name;
- rename accepts USER `labelId + name`, verifies provider type, then uses the provider partial-update path;
- delete verifies USER type before deletion.

Deleting a USER label removes that label from affected messages/threads; it does not delete those messages. Raw Label resource objects, colors, provider counts, or arbitrary fields are not model-writable.

Current OAuth sensitivity metadata follows Google's live Gmail scope catalog: `gmail.labels` is non-sensitive, `gmail.send` is sensitive, and `gmail.readonly` / `gmail.modify` are restricted. Production restricted-scope verification/compliance remains a deployment concern, not a reason to widen scopes.

### 6.4 Send and reply

New mail and replies are separate semantic tools.

`gmail.sendMessage` accepts bounded validated `to`, optional `cc`, `subject`, and plain-text `body`. Elara limits a single call to 50 total To+Cc recipients. Recipient and subject validation is repeated at the direct service boundary; CR/LF header injection is rejected.

`gmail.replyMessage` requires explicit `threadId`, recipient, subject, body, the prior RFC `Message-ID` as `inReplyTo`, and an optional prior `References` chain. The adapter constructs RFC mail carrying the provider thread id plus `In-Reply-To` and `References`; the supplied subject must represent the target conversation subject. Reply identity comes from a prior Gmail read rather than invented model state.

Both send/reply are `send` risk. Confirmation identifies the target/thread and subject and exposes the complete validated body through the confirmation broker's scroll-bounded `reviewText`; a benign prefix cannot hide an unreviewed tail.

Gmail does not expose a Calendar-style client-chosen message resource id for deterministic reconciliation. Elara therefore uses a same-call elected-turn replay fence keyed by tool + conversation + user message + generation + Gemini call id + validated payload hash. Replaying the exact same send/reply in the same live turn returns the same promise/result or retained ambiguous failure and does not issue a second `messages.send`. Reusing the call id with changed arguments fails closed. Distinct calls remain distinct. After a full page/runtime restart, an ambiguous provider acceptance remains an explicit limitation rather than a fabricated exactly-once guarantee.

## 7. Drive / Docs / Sheets current boundary

These services remain pre-Pass-4 groundwork plus audited hardening, not final parity.

Drive model access uses app-file boundaries by default, with broader library read as separate deliberate consent. `drive.updateFile` has one nested semantic `patch`; the model-visible patch permits only `name`, `description`, and `starred`. `trashed` is deliberately absent from this ordinary-write tool.

Docs model operations are semantic create/inspect/edit helpers. Raw unrestricted batch update remains internal.

Sheets exposes bounded reads/writes plus semantic helpers. `sheets.updateCell` requires one true single-cell A1 target, including safely parsed quoted sheet names, and one bounded string input; ranges/whole rows/columns/named ranges are rejected before confirmation. Confirmation identifies spreadsheet + exact cell and exposes the full cell input. `sheets.insertRows` confirms spreadsheet/sheet/index/count and returns a bounded semantic success summary rather than raw batch-update provider output. General unrestricted `sheets.batchUpdate` remains internal.

Broader Drive/Docs/Sheets parity, Picker admission, revision-aware edit controls, formula-safe write modes, and complete provider-response budgeting belong to the dedicated later Workspace pass.

## 8. Security and failure semantics

Validation precedes execution. Confirmation is separate from OAuth. If confirmation UI is unavailable, busy, stale, or aborted, mutation fails closed.

Gmail-specific hostile-content rule: text such as “ignore previous instructions”, “send secrets”, or “enable another tool” found inside an email is external content, not user authorization. The retrieved payload cannot widen application capabilities or skip confirmation. The semantic Gmail service also constrains provider payload shape before the continuation reaches Gemini, reducing both prompt-injection surface and unbounded-context risk.

Gmail send/reply uses fixed provider endpoints and locally generated RFC headers from validated semantic fields. Raw RFC822 is not a Gemini argument. Permanent delete is absent. Custom-label mutation verifies USER type. Invalid ids/query/page sizes/recipient/header/body inputs fail before the corresponding provider mutation and, where possible, before OAuth authorization.

## 9. Verification

Relevant verification includes service contract tests, schema tests, Gemini declaration parity, executor/confirmation tests, replay-fence tests, provider-boundary tests, Worker tests, build, and the Android/Chromium/onboarding Playwright matrix.

Gmail-specific regressions live in:

- `src/google/tools/gmail-schemas.test.ts`
- `src/google/tools/gmail-parity.test.ts`
- `src/google/gmail/semantic-service.test.ts`
- `src/google/gmail/send-replay.test.ts`
- `src/google/oauth/gmail-scope-sensitivity.test.ts`

Important assertions include: raw provider mutation shapes rejected; reads normalized as `untrusted-external`; arbitrary HTML/custom headers do not cross the semantic projection; USER-label verification; semantic system-label mapping; CR/LF injection rejection; RFC reply headers/thread id; full send-body confirmation; and exact same-call replay suppression without content-deduplicating legitimate distinct sends.

`verified_commit` must not be advanced to the Gmail branch head until the reviewed exact PR head passes full CI, merges, and the resulting `main` commit passes post-merge certification.
