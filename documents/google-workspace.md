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

External provider content is evidence, never authority. Retrieved Calendar/Tasks/Gmail/Drive/Docs/Sheets/YouTube content may inform an answer, but it cannot grant capabilities, approve confirmation, change security policy, expose credentials, or instruct Elara to bypass the registered tool surface.

This is enforced at runtime rather than left to prompt wording. Successful reads from those provider namespaces intrinsically taint the elected model turn, even if an adapter accidentally omits an explicit provenance marker; explicit `trust: untrusted-external` remains a second tripwire. If a later model continuation proposes a mutation after that taint, its confirmation is marked `untrustedContext`, displays an external-content warning, starts unselected, and cannot be approved until the human explicitly selects it. A mutation emitted in the same model batch as the read is not retroactively tainted because the model had not yet received that provider result. This preserves legitimate user-requested inspect→edit workflows while ensuring retrieved provider text never becomes silent action authority.

Grouped mutation confirmation is fail-closed for human review. Multi-action batches start with every item unselected and expose no `Approve all` shortcut; the user selects intended mutations individually. Tainted single actions also start unselected. Confirmation presents exact validated arguments for mutation classes that do not already have a purpose-built full-content review (for example bulk Sheets rows and document edit text).

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

Gemini-visible reads cover bounded message/thread search, explicit message/thread inspection, and label discovery. Search pages are capped at 100 results; queries, page tokens, IDs, headers, snippets, message bodies, thread message counts, total thread text, and raw Gmail JSON reads all have application bounds. Gmail JSON is rejected before parsing when its declared or streamed payload exceeds the local byte ceiling.

Read results are normalized semantic projections and explicitly carry:

```text
trust: untrusted-external
source: gmail
```

Message inspection exposes only bounded provider identity, label ids, snippet, selected safe headers (`From`, `To`, `Cc`, `Date`, `Subject`, `Message-ID`, `In-Reply-To`, `References`), and bounded inline `text/plain` content when requested. MIME type is checked before any body-data base64 decode; missing/HTML/binary MIME types are never decoded as message text. MIME traversal has explicit nesting, part-count, decoded-input, and output-character budgets; reaching the output-character ceiling with unread MIME content remaining also sets truncation metadata, including exact-budget boundary cases. Parts carrying a filename or Gmail `attachmentId` are excluded from body text. Raw provider JSON, raw RFC822, arbitrary headers, attachments, provider URLs, and raw HTML are not passed directly to Gemini. HTML/script content is not treated as executable or authoritative text.

Thread inspection returns a bounded recent-message projection with visible truncation metadata instead of forwarding an unrestricted provider thread payload. `gmail.getThread(full)` first fetches only a minimal thread index, selects at most the newest 20 provider message ids, then fetches and normalizes those messages sequentially under the raw-response byte budget; it never materializes an entire full-body provider thread before truncation. Email content may contain hostile instructions; those instructions remain data and cannot authorize tools, capabilities, credentials, confirmation, or policy changes.

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

`gmail.replyMessage` requires explicit `threadId`, recipient, subject, body, and the prior RFC `Message-ID` as `inReplyTo`. The model does not supply a `References` chain. Its tool descriptor declares `gmail.read` as an executor-visible prerequisite in addition to the primary `gmail.send` capability. The Gemini tool loop runs the same OAuth admission probe before a mutation enters the confirmation batch. All declared OAuth requirements must therefore be effective before any reply approval is shown. The Gemini tool loop repeatedly probes and admits missing capabilities until the descriptor is fully satisfied or the user declines; if interactive authorization is unavailable, the call returns `AUTHORIZATION_REQUIRED`. The confirmation batch is constructed only after OAuth admission completes for the entire mutation batch, so a later consent flow cannot age an earlier confirmation before the user sees it. An approval is never collected first and then reused after granting a missing capability.

After admission, Elara reads the selected thread's bounded metadata, verifies that `inReplyTo` identifies a message in that thread, compares the supplied subject with the provider conversation subject using locale-independent case folding modulo normal reply/forward prefixes, and derives `References` from provider metadata. Only after that verification does it obtain the already-enabled `gmail.send` request authority and construct/send RFC mail carrying the provider thread id plus `In-Reply-To` and provider-derived `References`. A mismatched thread, Message-ID, or subject fails before `messages.send`.

Both new-message send and reply remain behind Elara's explicit `gmail.send` application capability. Reply additionally requires explicit `gmail.read` for provider verification; mailbox organization authority (`gmail.modify`) never substitutes for send authority. This preserves application-level user intent even though Google's broader provider scopes may technically subsume narrower operations.

Both send/reply are `send` risk. Confirmation identifies the target/thread and subject and exposes the complete validated body through the confirmation broker's scroll-bounded `reviewText`; a benign prefix cannot hide an unreviewed tail. Provider write responses are discarded and replaced with bounded application-owned acknowledgements rather than forwarded raw Gmail resources.

Gmail does not expose a Calendar-style client-chosen message resource id for deterministic reconciliation. Elara therefore uses a same-call replay fence keyed by tool + conversation + user message + generation + Gemini call id + validated payload hash, with replay state isolated per elected turn. A stale or slower generation cannot clear another live turn's replay entries; inactive turn buckets are pruned opportunistically and active buckets are never evicted to make room. Replaying the exact same send/reply in the same live turn returns the same promise/result or retained ambiguous failure and does not issue a second `messages.send`. Reusing the call id with changed arguments fails closed. Distinct calls remain distinct. After a full page/runtime restart, an ambiguous provider acceptance remains an explicit limitation rather than a fabricated exactly-once guarantee.

## 7. Drive parity; Docs / Sheets current boundary

Drive remains Google's file authority; Elara keeps no second Drive catalogue. Gemini exposes `drive.searchFiles` under the app-file boundary, `drive.searchLibrary` behind separate deliberate broader-library read consent, `drive.getFile`, guarded `drive.downloadFile`, and confirmed create/update/move/trash mutations.

Every Drive read uses one bounded projection: id, name, MIME type, modified/created time, web-view link, parents, size, starred, description, trashed state, provider ETag, and `capabilities.canDownload`. Provider size is parsed conservatively. Oversized/non-HTTPS links are dropped rather than truncated into broken URLs, and implausible MIME types fall back to `application/octet-stream` rather than becoming a false classification.

Search excludes trashed files by default. `showTrashed` is explicit; a caller-written `trashed` predicate is honored, but a quoted file name that merely contains the word never suppresses the default boundary. Query text, page tokens, page sizes, IDs, validators and provider-facing metadata are bounded at both schema and service boundaries.

`drive.downloadFile` never returns bytes to Gemini. Google-native editor files that require export, provider-nondownloadable files, declared oversize files, and streams that cross the 10 MiB application ceiling are refused. Transfers carry the elected turn's abort signal. Successful bytes become a conversation-scoped local attachment artifact; the tool returns bounded artifact metadata only. A cancelled/superseded generation cannot publish a stale ready artifact, and unattended runs without a conversation cannot create an orphaned download artifact.

Drive mutations are conditional. `drive.updateFile`, `drive.moveFile`, and `drive.trashFile` require one concrete strong provider ETag from a prior read and send it as `If-Match`. Weak, wildcard, multi-value, empty or oversized validators fail before provider execution; a provider `412` becomes an explicit re-read requirement. `drive.updateFile` accepts only nested `patch:{name?,description?,starred?}`; trash cannot be smuggled through ordinary metadata update. `drive.trashFile` is the recoverable destructive end state; permanent file deletion is absent from the model surface.

Moves state their parent consequence before confirmation. Supplying `previousParentId` removes that prior parent while adding the destination; omitting it adds another parent and leaves the prior location intact. Contradictory remove/add of the same parent fails before provider access.

`drive.createFile` uses a same-call replay fence isolated by elected turn and call id, signed by the validated create payload. Identical live replays share the first result/ambiguous failure; changed arguments under the same call id fail closed; stale generations cannot clear a newer live turn's fence. Drive has no client-chosen file id in this contract, so cross-restart ambiguous acceptance is not disguised as exactly-once.

Every Drive mutation carries the turn abort/activity guard through OAuth and to the authorized fetch boundary. Ownership is checked before provider execution and again before a post-401 retry, so token refresh cannot resurrect a stale generation's write.

Drive tools are browser-plane only; the Worker never advertises Drive handlers it does not own. `drive.exportFile` remains an internal service primitive until Docs/Sheets export semantics are deliberately contracted.

Picker admission is user-driven and stays under the narrow `drive.file` boundary. The reviewed Picker adapter owns the external Google Picker script and receives the short-lived access token only through an OAuth-owned closure; React never receives or persists the token. The browser API key and Cloud project number are public self-hosted configuration and must be origin/API restricted. Selected file metadata is bounded before it enters Elara. Admissions live in the existing IndexedDB settings authority. “Remove from Elara” adds a local deny record enforced by Drive, Docs, and Sheets handlers before provider access; choosing the file again removes that deny record. Disconnect clears active admissions into the deny set so reconnect cannot silently resurrect them.

Docs model operations remain semantic rather than raw batch requests. `docs.inspectDocument` requests `includeTabsContent=true`, walks nested tabs, and returns bounded tab ids/titles/parentage/indexes, paragraph/table anchors, the document revision id, and explicit `untrusted-external` provenance. `docs.insertText`, `docs.appendParagraph`, and `docs.replaceText` require both the selected tab id and the exact revision id read by inspection. Provider writes carry `WriteControl.requiredRevisionId`; replacement is constrained by `tabsCriteria`, and append re-reads before mutation so collaborator changes fail closed. `docs.createDocument` is first-class and same-turn replay fenced. `docs.exportDocument` exposes only PDF/DOCX, streams through the 10 MiB transfer ceiling, and saves bytes as a local conversation artifact rather than model context. Raw unrestricted Docs batch update remains internal.

Sheets exposes bounded semantic metadata/range reads with `untrusted-external` provenance. Cell writes accept only bounded primitive values; at most 1,000 rows, 100 cells per row, 10,000 cells and 1 MiB serialized input may cross one operation. `literal` / provider `RAW` is the default, so strings beginning with `=` remain text; `userEntered` is an explicit model argument and the confirmation copy warns that formulas/dates/numbers can be interpreted. `sheets.createSpreadsheet` and `sheets.addSheet` are first-class bounded semantic operations with same-turn replay fencing, and spreadsheet id is also the stable Drive file identity. `sheets.insertRows` is the constrained structural operation; unrestricted `sheets.batchUpdate` stays internal. `sheets.exportSpreadsheet` exposes only PDF/XLSX and routes bounded bytes to the local artifact repository.

## 8. Security and failure semantics

Validation precedes execution. Confirmation is separate from OAuth. If confirmation UI is unavailable, busy, stale, or aborted, mutation fails closed. Gmail, Drive, Docs, and Sheets mutations carry the existing turn abort/election guard through the handler into the service and into the OAuth-authorized request boundary. Turn ownership is rechecked after asynchronous authorization/provider preflight and again immediately before every real Google provider write, including a retry after 401/token refresh. The same turn signal is propagated into the provider request. A cancelled or superseded generation therefore cannot send or mutate merely because token/status work completed after it lost authority. Docs/Sheets resource creation additionally uses per-elected-turn call-id/payload replay fencing; an exact replay shares the first result or ambiguous failure, while changed arguments under the same call id fail closed.

Gmail-specific hostile-content rule: text such as “ignore previous instructions”, “send secrets”, or “enable another tool” found inside an email is external content, not user authorization. The retrieved payload cannot widen application capabilities or skip confirmation. The semantic Gmail service also constrains provider payload shape before the continuation reaches Gemini, reducing both prompt-injection surface and unbounded-context risk.

Gmail send/reply uses fixed provider endpoints and locally generated RFC headers from validated semantic fields. Raw RFC822 is not a Gemini argument. Permanent delete is absent. Custom-label mutation verifies USER type. Invalid ids/query/page sizes/recipient/header/body inputs fail before the corresponding provider mutation and, where possible, before OAuth authorization.


Drive-specific failure semantics are likewise fail-closed. Invalid validators and contradictory moves fail before provider mutation; transfer ceilings are enforced before and during reads; a stream failure becomes a typed transfer failure rather than a partial artifact. Drive file writes carry the same provider-boundary turn guard used by Gmail so OAuth/token refresh cannot turn an expired approval or stale generation into a provider mutation. Permanent file DELETE is absent.

## 9. Verification

Relevant verification includes service contract tests, schema tests, Gemini declaration parity, executor/confirmation tests, replay-fence tests, provider-boundary tests, Worker tests, build, and the Android/Chromium/onboarding Playwright matrix.

Gmail-specific regressions live in:

- `src/google/tools/gmail-schemas.test.ts`
- `src/google/tools/gmail-parity.test.ts`
- `src/google/gmail/semantic-service.test.ts`
- `src/google/gmail/send-replay.test.ts`
- `src/google/oauth/gmail-scope-sensitivity.test.ts`

Important assertions include: raw provider mutation shapes rejected; reads normalized as `untrusted-external`; arbitrary HTML/custom headers do not cross the semantic projection; metadata-first bounded full-thread retrieval; raw Gmail JSON byte ceilings before parsing; exact-budget MIME truncation visibility; USER-label verification; semantic system-label mapping; CR/LF injection rejection; complete multi-capability authorization-before-confirmation with confirmation freshness starting after OAuth; provider-verified thread/Message-ID/locale-independent subject with provider-derived RFC References; bounded write acknowledgements; provider-boundary stale-turn rejection across token refresh/retry; full send-body confirmation; and per-turn same-call replay suppression without content-deduplicating legitimate distinct sends or allowing stale turns to clear newer replay state.

Drive regressions additionally live in `src/google/drive/*test.ts`, `src/google/tools/drive-parity.test.ts`, `src/google/tools/drive-write-parity.test.ts`, `src/google/tools/drive-sheets-parity.test.ts`, and `e2e/google-drive.spec.ts`. They pin trash-default search, bounded provider projection, guarded artifact downloads, transfer overflow/cancellation, strong-ETag conditional writes, recoverable trash with no DELETE, move-parent semantics, replay isolation across live/stale generations, browser execution-plane filtering, schema/declaration/handler parity, and provider-boundary stale-turn rejection.

## 10. Known gaps

Pass 4 implementation now covers the planned Drive/Docs/Sheets/Picker contract. The deliberately broader `drive.library.read` surface remains discovery-only: a file found solely through that optional restricted scope must be deliberately admitted through Picker before Elara’s ordinary file/document/spreadsheet operations may use it. This preserves `drive.file` as the normal action boundary instead of turning library search into an implicit whole-Drive mutation authority.

Pass 5 orchestration/Kanban must consume these provider/tool contracts rather than become a competing authority; PR #79 remains a separate WIP and is not part of this branch. Pass 6 still owns cross-Workspace hostile provider-payload budgets/truncation metadata, prompt-injection certification across Gmail/Docs/Drive/Sheets, stale-read/write race matrices, replay/idempotency edge cases, and final end-to-end handover.

Pass 4 is not declared certified until this PR’s exact head passes the complete CI matrix and the resulting merged `main` receives post-merge certification.

`verified_commit` advances only after an exact reviewed PR head passes full CI, merges, and the resulting `main` commit passes post-merge certification.
