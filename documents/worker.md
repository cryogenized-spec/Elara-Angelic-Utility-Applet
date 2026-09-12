---
id: SYS-WORKER
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: Cloudflare Worker, cloud Gemini and autonomy runtime
paths: [worker/src, worker/wrangler.toml]
keywords: [worker, cloudflare, gemini-endpoint, autonomy, health]
---

# Cloud Worker runtime

## 1. Purpose and boundary

`SYS-WORKER` owns Elara's Cloudflare execution plane: protected cloud endpoints, Worker-side Gemini credential use and the Durable Object/Workflow autonomy runtime. It is **not** the normal interactive browser Gemini provider and does not own browser Google OAuth.

## 2. Runtime architecture

```text
HTTP/cron
-> worker/src/index.ts route boundary
-> authentication/schema validation
-> health / cloud Gemini / transcription / autonomy route
-> Worker GEMINI_API_KEY or autonomy bindings
-> normalized response/outcome
```

Autonomy routes delegate to `worker/src/autonomy/`, where installation-scoped state, scheduling/execution and workflow behavior live. Browser chat continues to call `src/gemini/provider.ts` directly.

## 3. Source map

| Concern | Authority |
| --- | --- |
| HTTP entry/routes | `worker/src/index.ts` |
| Worker bindings/types | `worker/src/cloudflare.d.ts`, `worker/wrangler.toml` |
| Autonomy ports/state | `worker/src/autonomy/` |
| Worker tests | `worker/test/`, `vitest.workers.config.ts` |
| Client cloud protocol | `src/autonomy/cloud/`, `src/autonomy/protocol.ts` |

## 4. Data and contracts

The Worker owns its server-side `GEMINI_API_KEY`; browser Lockbox credentials never transit merely because a cloud routine runs. Model tool declarations are filtered by execution plane, so browser-only capabilities such as YouTube search are not advertised where the Worker cannot execute them.

Autonomy uses installation identity/token, configuration generation and bounded context/outcome envelopes. Durable Object/Workflow state is separate from browser IndexedDB and is synchronized only through explicit protocol messages.

## 5. Invariants

- Browser interactive chat does not route through this Worker.
- Worker secrets never enter browser bundles, tool schemas or client persistence.
- Worker execution advertises only tools it can actually execute.
- Autonomy installation state is isolated and versioned through explicit protocol contracts.
- Cloud execution must not gain Google Workspace authority from browser-side OAuth state.
- Health endpoints report service state without disclosing secrets.

## 6. Security and failure semantics

Protected routes authenticate before execution and validate request payloads. Provider/tool failures become bounded HTTP/protocol failures rather than raw exception dumps. Stale autonomy configuration and incompatible protocol versions fail closed. CORS/origin/auth behavior belongs at this boundary, not inside UI components.

## 7. Verification and tests

Run `npm run typecheck:worker`, `npm run test:workers`, `npm run verify:worker`, Worker autonomy HTTP/engine tests and relevant cloud E2E. `wrangler` configuration changes should be validated against the deployed Cloudflare environment before release claims.

## 8. Known gaps

The Worker is intentionally narrower than the browser app. Server-side Google OAuth, broader web tools or new long-running cloud capabilities require explicit contracts and security review; they must not be inferred from the presence of a generic Gemini endpoint.
