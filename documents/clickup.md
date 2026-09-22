---
id: SYS-CLICKUP
status: active
verified_commit: 6f71fb5f9bf9cbb06987a43648d132e3a07909ba
scope: first-party ClickUp REST, OAuth, MCP, indexed search and artifact contracts
paths: [src/clickup, worker/src/clickup]
keywords: [clickup, mcp, oauth, task, comment, assignee, custom-field, attachment, webhook]
---

# First-party ClickUp integration

## 1. Authority and runtime boundary

Elara owns its normal ClickUp integration. ClickUp work does not depend on ClickUp's vendor-hosted MCP.

The interactive execution chain is:

```text
Gemini
-> existing Elara model-tool registry/executor
-> existing confirmation authority for mutations
-> browser ClickUp MCP client
-> authenticated Elara Worker MCP endpoint
-> semantic ClickUp service
-> installation-scoped ClickUpOAuthVault Durable Object
-> typed ClickUp REST adapter
-> ClickUp Public API
```

This subsystem extends existing Elara authorities. It does not create a second model registry, confirmation broker, chat provider or arbitrary HTTP authority. The historically Google-named registry/executor remains Elara's shared executable model-tool authority.

ClickUp-derived content is untrusted external data. Provider authorization permits access to ClickUp; it does not authorize Elara to perform a model-initiated mutation.

## 2. Source map

| Concern | Authority |
| --- | --- |
| Semantic tool schemas / risk | `src/clickup/tool-schema.ts` |
| Gemini registration | `src/google/tools/registry.ts`, `src/google/tools/gemini-declarations.ts` |
| Existing execution / confirmation | `src/google/tools/executor.ts`, `src/gemini/google-tool-loop.ts` |
| Browser MCP client | `src/clickup/mcp-client.ts` |
| Browser OAuth authority | `src/clickup/oauth/*` |
| Settings connection / identity surface | `src/app/components/ClickUpOAuthSettings.tsx` |
| Immutable artifact approval | `src/clickup/attachment-authority.ts` |
| Same-live-turn ClickUp mutation replay fence | `src/clickup/mutation-replay.ts` |
| Browser artifact transport | `src/clickup/attachment-upload.ts` |
| Reviewed REST operation map | `src/clickup/rest-contract.ts` |
| Worker MCP server | `worker/src/clickup/mcp-route.ts` |
| Semantic Worker service | `worker/src/clickup/tool-service.ts` |
| Provider serialization / egress | `worker/src/clickup/provider.ts` |
| Encrypted credential / grant / rate / webhook authority | `worker/src/clickup/oauth-vault.ts` |
| Public OAuth admission | `worker/src/clickup/oauth-routes.ts` |
| Artifact ingress | `worker/src/clickup/attachment-route.ts` |
| Webhook ingress | `worker/src/clickup/webhook-route.ts` |
| Durable task index | `worker/src/clickup/task-index.ts` |
| Worker composition | `worker/src/entry.ts`, `worker/wrangler.toml` |

## 3. Canonical semantic tools

`src/clickup/tool-schema.ts` is the single model-facing schema authority. Zod performs runtime validation and generates the JSON Schema consumed by both Gemini declarations and MCP `tools/list`.

Current surface:

```text
clickup.searchTasks
clickup.getTask
clickup.getTaskContext
clickup.getTaskComments
clickup.resolveAssignees
clickup.listHierarchy
clickup.createTask
clickup.updateTask
clickup.createTaskComment
clickup.replyToComment
clickup.setCustomField
clickup.attachArtifact
```

The surface is intentionally semantic and compact. There is no `rawRequest`, URL fetcher, arbitrary endpoint/method/header authority or permanent-delete tool.

Numeric ClickUp identifiers are semantic decimal strings where the provider documents numeric IDs. Opaque task/List/Folder/field identifiers remain bounded strings. The REST adapter performs only documented representation changes and rejects unsafe integer conversion rather than silently losing precision. Custom Field values also have an aggregate serialized-byte ceiling so combinatorial nested values fail at semantic validation before MCP transport.

## 4. MCP contract

The browser owns the MCP client but not ClickUp credentials.

Normal execution performs:

```text
resolve exact paired Worker + installation identity
-> server/discover
-> fresh tools/list validation against canonical Elara schemas
-> tools/call with admitted ClickUp grant revision + tool-catalog fingerprint
```

Every actual tool execution revalidates `tools/list`; the advertised TTL is used for browsing/listing but is not trusted for execution. This prevents a same-URL Worker rollback from reusing a previously validated catalog.

The Worker verifies:

- installation bearer;
- allowed browser origin;
- MCP protocol header and metadata revision;
- `Mcp-Method` / JSON-RPC method agreement;
- `Mcp-Name` / requested tool agreement;
- admitted ClickUp grant revision;
- browser catalog fingerprint against the live Worker catalog;
- bounded request bytes.

Structured MCP results have an aggregate Worker-side byte ceiling in addition to bounded semantic projections. The browser independently caps MCP response bytes and cancels oversized streams.

## 5. OAuth and credential authority

ClickUp uses OAuth 2.0 Authorization Code. Elara requires a paired self-hosted Worker for ClickUp because the client secret and durable access token are Worker-only.

```text
user gesture
-> signed POST /clickup/oauth/start
-> durable one-time OAuth state
-> official ClickUp authorization page
-> callback code + state
-> signed POST /clickup/oauth/exchange
-> state consumed exactly once
-> Worker exchanges code using deployment-owned client secret
-> GET /user + GET /team establish account and admitted Workspaces
-> token AES-GCM encrypted in installation-scoped Durable Object
-> browser receives bounded account / Workspace metadata only
```

Durable state contains ciphertext/IV, bounded account metadata, admitted Workspace metadata and a monotonic grant revision. The access token is decrypted only inside `ClickUpOAuthVault` immediately before reviewed provider work.

### 5.1 Account identity and Settings surface

ClickUp authorization is independent from Elara's Google Workspace authorization. Elara must never infer that the Google identity used for Gmail, Drive, Calendar or other Workspace tools is also the identity used to sign into ClickUp, and it must never reuse a Google Workspace access token for ClickUp.

If a customer's ClickUp account uses Google's sign-in option, account selection happens inside ClickUp's official authorization/sign-in flow. Elara does not manufacture or force a Google account chooser on ClickUp's behalf. The Settings surface explains this boundary before authorization and then displays the bounded ClickUp account metadata returned by ClickUp so the customer can verify which identity was admitted.

The ClickUp Settings surface is intentionally connection-oriented rather than a second task-management client. It shows:

- connected/disconnected state;
- the admitted ClickUp account identity when available;
- authorized Workspace names;
- whether Elara's first-party ClickUp MCP path is active;
- refresh, disconnect and explicit **Switch ClickUp account** actions.

Switching accounts is an explicit replacement operation. The browser creates the OAuth popup synchronously under the user's Switch gesture before awaiting disconnect or Worker state, then disconnects the old local ClickUp grant and begins a new official ClickUp OAuth flow. If replacement authorization fails, Settings re-reads the current authority instead of continuing to display stale account metadata.


Public OAuth bodies are streamed under a byte ceiling before signature verification/forwarding. Signed writes use timestamp + nonce + body and have durable replay protection. OAuth state is random, redirect-bound, short-lived and single-use. A new Connect gesture replaces older pending states and advances the connection epoch, so an older popup or already-in-flight exchange cannot later overwrite the newer authorization.

Connect/disconnect/reconnect use a connection epoch. A late exchange cannot resurrect a grant after disconnect. Credential replacement, local webhook/delivery removal, rate-budget removal and ClickUp task-index purge commit in one SQLite transaction, so a new account can never coexist with provider data cached under the previous grant. Provider requests retain the credential revision that issued them; a late response or 401 from an obsolete token cannot mutate the replacement grant or replacement rate budget.

ClickUp currently documents OAuth access tokens as non-expiring, but Elara treats them as revocable. Provider authorization failure removes only the credential revision that actually produced that failure.

Disconnect deletes the local encrypted grant. ClickUp does not document a general OAuth token revocation endpoint, so Elara does not claim provider-side revocation.

## 6. Confirmation and exact-grant binding

Every ClickUp mutation reuses Elara's existing confirmation authority.

For a model mutation Elara captures the ClickUp execution grant before confirmation:

```text
account identity
+ admitted Workspace set
+ Worker installation / authority binding
+ grant revision
```

After approval the executor verifies the same grant again. The admitted revision and Worker binding then travel through the browser handler, MCP/attachment transport and Durable Object. The vault checks the revision again immediately before REST egress.

If the account, Workspace grant, credential revision or paired Worker changes while confirmation is open, the mutation fails closed instead of executing as the replacement identity.

### 6.1 Human approval presentation

ClickUp mutations use the shared Elara watchdog rather than a ClickUp-specific confirmation UI. The human surface intentionally does not expose MCP/JSON-RPC envelopes, raw tool identifiers such as `clickup.createTaskComment`, JSON argument objects, schema keys, grant revisions, hashes or other debug-oriented implementation details.

The same validated mutation remains authoritative underneath. The watchdog projects it into human-readable provider/action labels and readable field/value review text. Examples include **ClickUp · Post comment**, **ClickUp · Update task**, and **ClickUp · Attach file**. Comment/reply bodies are shown directly. Attachment review shows the approved filename/type/size and destination while the SHA-256 binding remains internal to the immutable artifact authority.

Review sizing is adaptive. Short actions retain a compact watchdog. Substantial text expands into a viewport-aware review sheet; heading and decision controls remain outside the scrolling content surface so the user can inspect much more of an essay, long comment or document edit without losing Approve/Decline. On narrow mobile viewports expanded mode respects safe-area insets.

External provider content still elevates confirmation. The warning is phrased for the human rather than as security/debug terminology, and the action remains unselected until the user explicitly selects it. Grouped mutations likewise remain individually selectable with no approve-all shortcut.


## 7. Workspace-scoped resource authority

Model-supplied provider IDs are not accepted as ownership proof.

Direct-ID task, Folder, List, comment, Custom Field and attachment paths are bound back to the locally admitted Workspace before content is returned or a mutation leaves the vault.

The vault verifies, as applicable:

- Workspace is present in the durable grant;
- task `team_id` or Space ancestry belongs to that Workspace;
- Folder/List ancestry resolves through an admitted Space;
- comments belong to the admitted task;
- Custom Fields belong to the admitted task's List and are applicable to the task type;
- People Custom Field add/remove IDs belong to current admitted Workspace members;
- Task-relationship Custom Field add/remove IDs independently pass the same task Workspace proof as direct task reads;
- assignee and mention user IDs belong to the admitted Workspace.

Subtask creation additionally proves the requested parent task belongs to the same target List required by ClickUp's Create Task contract.

Cross-Workspace, missing and otherwise-unverifiable direct resources return a generic scope denial. Task/Folder/List denial paths use fixed ancestry probes where necessary so existence is not exposed through response body, status, timing or rate-budget shape.

A provider 403 on the admitted Workspace task feed removes that Workspace from durable grant metadata and purges its cached tasks before results can be served.

## 8. Search and task context

ClickUp's filtered Workspace task endpoint is filter-oriented; it is not treated as equivalent to vendor-MCP broad text search.

`clickup.searchTasks` therefore uses an installation-scoped SQLite task index inside the ClickUp Durable Object.

Behavior:

- a cold search progressively warms bounded provider pages;
- repeated searches use the local index and consume no additional ClickUp request while fresh;
- query/list/folder/space/status and assignee filters are applied before the bounded SQL candidate limit so older valid matches are not hidden by newer unrelated rows;
- incremental refresh uses `date_updated_gt` with a small overlap;
- multi-page incremental refresh persists its original low-water mark and next page until all pages are consumed;
- the durable provider watermark advances only after the incremental result set completes;
- periodic full reconciliation removes tasks missed by webhook delivery or incremental deletion semantics;
- provider mutations that can change indexed task evidence invalidate the affected cached evidence before REST egress, preventing a post-provider-commit crash from leaving the pre-write snapshot current;
- reconnect/revocation clears affected index state.

Each persisted task is normalized into a bounded projection. Nested provider objects are reduced to reviewed fields and `task_json` has a hard per-task ceiling with a minimal identity/location fallback.

`clickup.getTaskContext` is composite: it returns bounded task data plus requested comment/metadata context so routine inspection does not require many model tool calls.

## 9. Webhook freshness

ClickUp webhooks are an optimization/freshness signal, not a second task-data ingestion authority.

On successful OAuth exchange Elara may register task-related webhooks for admitted Workspaces. Each returned webhook secret is encrypted in the same installation-scoped Durable Object.

Ingress:

```text
POST /clickup/webhook
-> bounded JSON body
-> webhook_id lookup
-> HMAC-SHA256 X-Signature verification
-> delivery dedupe
-> cache invalidation / task deletion signal only
```

Webhook content never directly becomes trusted indexed task state or Gemini context. The next task read/search still uses the reviewed REST/index path.

The documented `webhook_id:history_item_id` identity is used for replay dedupe when history items are present; body hash is the fallback dedupe identity. Dedupe persistence and the corresponding tombstone/cache-invalidation effect commit in the same SQLite transaction so a crash cannot mark a delivery processed while losing its index mutation.

Reconnect/disconnect lifecycle is epoch/revision guarded. A failed reconnect leaves the previous valid webhook state intact. A webhook created by a superseded exchange is not persisted and is best-effort deleted at ClickUp. Locally unknown/orphaned webhook IDs are acknowledged and ignored so stale provider registrations cannot create a retry storm.

## 10. Artifact attachment authority

The model sees only an Elara `artifactId`; it never supplies arbitrary bytes, filesystem paths or URLs.

Before confirmation Elara resolves the local ready artifact and captures an immutable approval snapshot:

- artifact ID/name;
- requested upload filename;
- MIME type;
- metadata size and Blob size;
- SHA-256 digest;
- exact Blob object;
- when the MIME type is explicitly text-readable, a bounded preview derived from the beginning of that exact Blob.

The human confirmation receives only safe attachment presentation fields: filename, upload name, MIME type, size and the optional bounded text preview. Binary formats such as PDF are not opportunistically decoded, OCRed or rendered as fake text previews. A truncated preview is labelled as such and never changes what is approved: approval remains bound to the complete immutable Blob and SHA-256 digest.

Immediately before transport, Elara re-reads and hashes the mutable repository entry. If bytes or relevant metadata changed under the same artifact ID, upload fails with `artifact-changed` and sends nothing.

The uploaded multipart file is the original approved Blob, not the second repository read.

The browser attachment route requires installation bearer + admitted grant revision. Multipart bytes are counted under a hard request ceiling without trusting `Content-Length` before the Durable Object performs `formData()`. The vault rechecks task Workspace ownership before provider attachment upload.

## 11. Provider serialization, errors and rate limits

`worker/src/clickup/provider.ts` is the only ClickUp Public API egress authority. Requests are HTTPS to the fixed ClickUp API origin and use `Authorization: Bearer <server-side token>`.

Reviewed representations include:

- `markdownContent -> markdown_content`;
- ISO date/time -> documented millisecond fields;
- assignee add/remove structures;
- structured comment user mentions;
- Custom Field `{value: ...}` with Workspace-bound People/Task relationship references;
- subtask `parent` only after same-List validation;
- task attachment multipart `attachment[0]`.

Provider response streams are byte-counted and canceled above the ceiling before JSON parsing. Arbitrary provider error prose is never projected into MCP/Gemini-visible error messages.

Current documented rate limits are per token:

| Workspace plan | Requests / minute |
| --- | ---: |
| Free Forever / Unlimited / Business | 100 |
| Business Plus | 1,000 |
| Enterprise / Enterprise Plus | 10,000 |

Elara learns `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` instead of hard-coding 100.

Within one provider window, concurrent/late responses may only merge remaining downward, and a response from an older reset window is ignored after a newer window is established. A small reset-horizon change is treated as same-window jitter and cannot replenish the local budget. A genuine minute-scale reset advance may update the reset horizon and future limit, but it may not raise immediately available local quota because other provider calls can already hold reservations. When the stored reset expires, the vault opens a provisional next-minute budget in place and consumes the current reservation atomically instead of deleting rate state; if the previous limit is unknown, only one request is admitted until fresh provider headers arrive. OAuth credential replacement commits the already-known merged `/user` + `/team` rate snapshot in the same transaction as the new grant, and OAuth-time webhook registration reserves from that same budget before egress. When the known current window is exhausted, the vault rejects the next provider call locally with 429 and the reset time.

Writes are not blindly replayed after ambiguous network failure because the reviewed ClickUp write endpoints do not expose a general idempotency key.

For duplicate-prone POST-style mutations (`clickup.createTask`, `clickup.createTaskComment`, `clickup.replyToComment` and `clickup.attachArtifact`), Elara also applies the existing live-turn replay pattern used by other provider creates/sends: the exact same elected conversation/message/generation + Gemini `callId` + admitted Worker/grant revision + validated payload shares the first promise/result or ambiguous failure instead of issuing a second provider mutation. Reusing the same call ID with changed arguments fails closed; distinct call IDs remain distinct intentional actions. Attachment replay identity additionally binds the approved artifact digest and upload metadata.

This fence is deliberately not provider-level exactly-once delivery. A full browser/runtime restart after ClickUp may have accepted an ambiguous write cannot be reconciled deterministically from a client idempotency key, so Elara must not claim that such a retry is safe without checking provider state or obtaining a fresh user decision.

## 12. Pagination and bounded results

Provider pagination is normalized behind semantic tools:

- filtered Workspace tasks: zero-based provider page, up to 100/provider page;
- task comments: `start` + `start_id`;
- newer cursor APIs remain provider-specific until exposed semantically.

Model-facing results are bounded. The model never assembles provider query strings or chooses arbitrary continuation URLs.

## 13. Deployment contract

A ClickUp-enabled self-hosted Worker requires deployment-owned configuration for:

- `CLICKUP_OAUTH_CLIENT_ID`;
- `CLICKUP_OAUTH_CLIENT_SECRET`;
- `CLICKUP_OAUTH_VAULT_KEY`;
- the `CLICKUP_OAUTH` Durable Object binding/migration;
- the existing Elara installation credential used by the paired browser/Worker authority.

Secrets are never browser build variables.

The ClickUp OAuth callback/redirect URI must be registered in the ClickUp app and must match the HTTPS Pages/deployment origin used by that installation.

## 14. Verification contract

Focused tests cover:

- one Zod authority feeding Gemini + MCP schemas;
- stale/rolled-back Worker catalog rejection before `tools/call`;
- MCP header/body routing agreement;
- exact grant/pairing confirmation binding;
- OAuth state + signed-write replay protection;
- disconnect/exchange and old-token/new-token races;
- encrypted token storage and revision-guarded revocation;
- adaptive/monotonic rate state and genuine-window rollover;
- provider response byte cancellation;
- cross-Workspace task/Folder/List/comment/field/attachment denial;
- assignee/mention Workspace membership;
- denial side-channel equalization;
- durable indexed-search continuation and periodic reconciliation;
- signed webhook replay/lifecycle races;
- immutable artifact TOCTOU/substitution rejection;
- chunked multipart byte ceilings;
- aggregate MCP result ceilings;
- hostile/malformed provider payload handling;
- same-live-turn duplicate suppression for ClickUp create/comment/reply/attachment calls, including changed-argument and changed-artifact replay rejection.

The complete release gate remains `AGENTS.md` authority. Because this subsystem changes authentication, authorization, confirmation and credential boundaries, final PR certification also requires the repository PR-review skill, current-main synchronization, exact-head CI and human sign-off.
