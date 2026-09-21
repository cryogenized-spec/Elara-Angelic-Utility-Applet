---
id: SYS-CLICKUP
status: active
verified_commit: cf33c88b6924e666cb6e186f95e04953e48e5ddd
scope: first-party ClickUp REST, OAuth and MCP contracts
paths: [src/clickup, worker/src/clickup]
keywords: [clickup, mcp, oauth, task, comment, assignee, custom-field, attachment]
---

# First-party ClickUp integration

## 1. Purpose and boundary

Elara owns its ClickUp integration. Normal ClickUp work is designed to execute through Elara's own Worker and ClickUp's REST API rather than depending on ClickUp's vendor-hosted MCP.

The intended runtime chain is:

```text
Gemini
-> existing Elara model-tool registry/executor
-> existing mutation confirmation authority
-> browser ClickUp MCP client
-> authenticated Elara Worker MCP endpoint
-> ClickUpOAuthVault internal provider command boundary
-> typed ClickUp REST adapter
-> ClickUp Public API
```

The first-party ClickUp subsystem does not create a second model registry, confirmation broker, chat provider or arbitrary HTTP tool. `src/google/tools/*` remains the generic executable model-tool authority despite its historical name.

Current implementation covers canonical semantic schemas, the typed REST adapter, paired-Worker OAuth, encrypted access-token persistence, provider error normalization, pagination primitives and durable adaptive rate-limit state. MCP transport and Gemini registration are not active yet.

## 2. Source map

| Concern | Authority |
| --- | --- |
| Semantic tool names/runtime schemas | `src/clickup/tool-schema.ts` |
| Browser OAuth client/status metadata | `src/clickup/oauth/authority.ts`, `src/clickup/oauth/contracts.ts` |
| Reviewed REST operation map | `src/clickup/rest-contract.ts` |
| Worker ClickUp REST serialization | `worker/src/clickup/provider.ts` |
| Encrypted ClickUp credential/rate authority | `worker/src/clickup/oauth-vault.ts` |
| Public OAuth route admission/CORS | `worker/src/clickup/oauth-routes.ts` |
| Worker composition and binding | `worker/src/entry.ts`, `worker/wrangler.toml` |
| Worker/provider tests | `worker/test/clickup-*.test.ts` |
| Browser OAuth tests | `src/clickup/oauth/authority.test.ts` |

The provider contract is based on the current ClickUp Public API v2/v3 OpenAPI and official REST/OAuth/rate-limit documentation. ClickUp remains mixed-version: core task/hierarchy/comment/Custom Field operations are currently v2 while some newer APIs, including general entity attachments, are v3.

## 3. OAuth and credential authority

ClickUp uses OAuth 2.0 Authorization Code. The official authorization endpoint is `https://app.clickup.com/api`; token exchange is `POST https://api.clickup.com/api/v2/oauth/token` with `client_id`, `client_secret` and `code`. OAuth API traffic uses `Authorization: Bearer {access_token}`.

Elara requires a paired self-hosted Worker for ClickUp. The browser never receives the ClickUp client secret or access token.

```text
user gesture
-> signed POST /clickup/oauth/start with exact HTTPS redirect URI
-> ClickUpOAuthVault creates durable one-time state (10-minute TTL)
-> browser opens official ClickUp authorization URL
-> ClickUp redirects to the registered Elara URI with code + state
-> browser signed POST /clickup/oauth/exchange
-> Worker + vault independently verify installation admission/replay state
-> vault consumes one-time OAuth state
-> vault exchanges code with Worker-only client secret
-> GET /api/v2/user + GET /api/v2/team verify identity and authorized Workspaces
-> access token AES-GCM encrypted in ClickUpOAuthVault
-> browser receives only bounded account/Workspace metadata
```

The access token is encrypted using a key derived from deployment-owned `CLICKUP_OAUTH_VAULT_KEY` with provider-specific domain separation. Ciphertext, IV, authorized account identity, Workspace metadata and a monotonic grant revision are stored in the installation-scoped SQLite Durable Object.

ClickUp currently documents OAuth access tokens as non-expiring but reserves the right to change this. Elara therefore treats them as revocable/provider-invalidatable credentials. Provider 401 responses and documented token-not-found codes (`OAUTH_019`, `OAUTH_021`, `OAUTH_025`, `OAUTH_077`) delete the durable local grant.

Disconnect immediately deletes Elara's encrypted token, pending OAuth states and rate-limit state. ClickUp does not currently document a general OAuth-token revocation endpoint, so the disconnect response explicitly reports `providerRevoked: false` rather than claiming a provider-side revocation that did not happen.

Browser localStorage may hold only schema-validated non-secret connection metadata. It never contains the ClickUp access token, client secret, Worker installation token or OAuth authorization code.

## 4. Canonical tool and provider contracts

`src/clickup/tool-schema.ts` is the single semantic schema authority. Zod owns runtime validation and generates the JSON Schema projections used by both the planned MCP `tools/list` surface and Gemini function declarations.

Initial semantic surface:

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

No raw URL/method/header/request tool exists. Permanent task deletion is not exposed. `clickup.updateTask` may use ClickUp's reversible `archived` field.

ClickUp numeric identifiers are decimal strings at semantic/MCP boundaries to avoid JavaScript precision loss. The provider serializer converts only documented integer body fields, such as assignee and mention IDs, and rejects values outside JavaScript's safe integer range rather than silently corrupting them.

`worker/src/clickup/provider.ts` is the REST serialization boundary. It owns provider field spellings and representations including:

- `markdownContent -> markdown_content`;
- ISO date/date-time -> millisecond `start_date`/`due_date` plus `*_time`;
- semantic assignee removal -> provider `assignees.rem`;
- genuine comment mentions -> structured `{type:"tag", user:{id}}` segments;
- Custom Field set -> `{value: ...}`;
- task attachment -> multipart `attachment[0]`.

Provider responses are capped before JSON parsing and provider error messages/codes are normalized. External ClickUp content remains untrusted data.

## 5. Provider execution and rate limiting

The browser does not receive a generic ClickUp REST proxy. Provider execution is reachable only through the ClickUp Durable Object's binding-internal `POST /internal/clickup/command` path.

That path requires the installation-derived internal marker and accepts only a closed command union covering reviewed hierarchy/task/comment/Custom Field primitives. It does not accept arbitrary URLs, HTTP methods, headers or hosts. Semantic mutation payloads are revalidated with the canonical ClickUp Zod schemas before provider serialization.

The access token is decrypted only inside `ClickUpOAuthVault`, immediately before the reviewed provider request.

ClickUp rate limits are per token and Workspace plan. Current documented limits are:

| Plan | Requests/minute/token |
| --- | ---: |
| Free Forever / Unlimited / Business | 100 |
| Business Plus | 1,000 |
| Enterprise / Enterprise Plus | 10,000 |

The adapter reads `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. The Durable Object stores that snapshot. When the current window is known exhausted it rejects the next internal provider command locally with `429 rate_limited` and the provider reset time instead of dispatching another ClickUp request.

A new OAuth grant, disconnect or provider-revoked credential clears the previous token's rate state. The limiter does not hard-code 100.

Provider read retries may later honor the reset boundary conservatively. Mutations must never be blindly replayed after an ambiguous network outcome because the reviewed task/comment write endpoints do not provide a general idempotency key.

## 6. Pagination, hierarchy and operational primitives

ClickUp uses several pagination mechanisms:

- filtered Workspace tasks: zero-based `page`, maximum 100 tasks per page;
- task comments: both `start` (last comment date in milliseconds) and `start_id` are required for the next older page;
- newer v3 APIs may use opaque cursors.

The typed provider adapter implements the Workspace-task and comment pagination primitives directly. The future MCP layer will normalize provider-specific continuations into bounded opaque Elara cursors so Gemini never assembles provider query strings.

Current reviewed provider primitives cover:

- authorized user and authorized Workspaces/members;
- Spaces, Folders, nested Folder retrieval, Folder Lists and folderless Lists;
- Workspace-wide filtered task enumeration;
- single task reads with Markdown description/subtask options;
- task create/update/archive;
- task comments and threaded replies;
- List Custom Field definitions;
- Custom Field set/clear;
- task attachment multipart upload.

The filtered Workspace task endpoint is filter-oriented rather than a broad semantic text-search API. `clickup.searchTasks` therefore must use a bounded Elara-side task index/cache in the later operational-parity phase instead of pretending REST offers the vendor MCP's global text search.

`clickup.getTaskContext` is intentionally composite and will use these primitives server-side to return one bounded task + comment + metadata result rather than forcing the model to orchestrate many calls.

## 7. Security and confirmation invariants

- ClickUp client secret and access token are Worker-only.
- The token never appears in browser persistence, MCP arguments, Gemini context, URLs, diagnostics or conversation state.
- Public OAuth reads require the installation bearer credential; OAuth writes are HMAC-signed with timestamp + nonce + body.
- The Durable Object independently verifies signed writes and keeps a durable replay ledger.
- OAuth `state` is cryptographically random, stored durably, bound to the exact redirect URI, expires after 10 minutes and is consumed exactly once.
- Redirect URIs must be HTTPS and match the allowed calling origin.
- Binding-internal provider execution requires the installation-derived internal marker.
- ClickUp-derived task/comment/field/file content is untrusted external data.
- Provider authorization is not model mutation permission.
- Every future model-initiated ClickUp write must pass Elara's existing confirmation broker and untrusted-context rules.
- No model-visible permanent-delete or arbitrary REST authority is permitted.

Attachment bytes are intentionally not accepted by the model schema. `clickup.attachArtifact` carries only an Elara artifact reference. The authenticated bounded artifact-staging path that transfers those bytes into the Worker is still deferred and must not create arbitrary URL-fetch/upload authority.

## 8. Verification and current gap

Current focused tests pin:

- MCP/Gemini schema parity from one Zod authority;
- absence of raw HTTP and permanent-delete semantic tools;
- documented REST path/content-type contracts;
- task create/update provider wire conversion;
- genuine structured ClickUp mentions;
- browser signed OAuth requests and non-secret persistence;
- OAuth state replay rejection;
- signed-write replay rejection;
- encrypted access-token storage;
- binding-internal provider admission;
- adaptive local rate-limit blocking;
- revoked-token durable cleanup;
- truthful local-only disconnect semantics.

The complete repository gate remains `AGENTS.md` authority. CI has not yet been run for this feature branch because repository CI is pull-request/main triggered and the project plan reserves the integration PR for final certification.

The remaining runtime gap is deliberate: the first-party MCP HTTP server/client, Gemini registration, bounded normalized model outputs, shared confirmation integration and artifact staging are not connected yet. Those changes belong to the next implementation phase and must consume the authorities defined here rather than creating parallel ones.
