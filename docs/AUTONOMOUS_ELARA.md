# Autonomous Elara — Setup & Operation Guide

This is the operator's guide for Elara's autonomy system. The architecture and
design decisions live in [`AUTONOMOUS_ELARA_DESIGN.md`](./AUTONOMOUS_ELARA_DESIGN.md)
(the design-of-record); this document tells you what to do, what to expect, and
— honestly — what does not exist yet.

> **Phase status (2026-09): Phase C — cloud execution (C0–C2).**
> Cloud-native routines can run in your worker (memory only). Google-backed
> routines stay on the device. Stale generations are rejected at admission.
> See [What is actually implemented](#what-is-actually-implemented).

---

## What Autonomy is

Elara can act on your behalf on a schedule: wake at the right time, review
what you allowed her to see, and leave results in your Autonomy Inbox. It is
**off by default** and every part of it is explicit:

- A **routine** is a saved instruction with a schedule, read-only permissions,
  and delivery policy. Structured permissions — not the instruction text —
  are the only authority.
- The **master switch** (Settings ▸ Autonomy) turns all autonomous work off
  and on. Off means off: no scheduled wake acts on anything.
- **Nothing autonomous ever writes to your Google account.** Routine runs use
  Elara's read-only tool surface. Writes remain interactive-only, confirmed
  by you in the chat.

## The two execution loci (why some routines say "device")

| | Cloud routine | Device routine |
|---|---|---|
| Tools | Memory-pack tools only (no web, no Google) | Your granted Google read tools + local memory |
| Credentials | Worker secrets only — never your Google tokens | Your browser Google authorization — unchanged |
| Runs when | The worker executes the frozen envelope | The scheduler records it as due; device catch-up arrives in a later phase |
| Rule | No Google permissions granted | One or more Google read permissions granted |

Google-backed routines stay **device-native**: your worker never receives
Google credentials of any kind. The cloud only ever knows the schedule.

## Cloudflare setup (self-hosting, honest cost)

Autonomy uses your own Cloudflare account. The Free tier is enough: **one
Worker, one hourly cron trigger, one Durable Object per installation.** No
per-routine triggers, no queues, no busy polling.

1. **Deploy the worker** from this repository (`worker/` — `wrangler deploy`).
   The configuration is already in `worker/wrangler.toml`: the cron trigger
   (`0 * * * *`), the `AUTONOMY` Durable Object binding, and its SQLite
   migration.
2. **Set the secrets:**
   - `GEMINI_API_KEY` — your Gemini key (existing requirement for the worker).
   - `ELARA_INSTALLATION_TOKEN` — the autonomy installation secret. Generate
     one (any long random string) and keep it: the app pairs with it.
     `wrangler secret put ELARA_INSTALLATION_TOKEN`
3. **Pair the app:** Settings ▸ Autonomy ▸ *Cloud scheduler* → paste the
   worker URL and the installation token → **Verify & pair**. Pairing proves
   token possession and checks version compatibility; it never sends the
   token anywhere except to your own worker.

What this costs you on the Free tier: the hourly heartbeat is 24 cron
invocations a day (sub-millisecond CPU), the Durable Object's SQLite storage
holds your bounded mirror (kilobytes), and each due occurrence is one DO
request. Effectively zero; no paid plan is required for Phase B.

### Development and testing without Cloudflare

- `npm run worker:dev` runs the worker locally (`wrangler dev`); add
  `--test-scheduled` to exercise the cron handler locally.
- `npm run test:workers` runs the real-Durable-Object test suite (real
  alarms, real SQLite storage) locally in workerd — no Cloudflare account
  needed.
- `AUTONOMY_WORKER_URL=… ELARA_INSTALLATION_TOKEN=… node scripts/verify-autonomy-worker.mjs`
  smoke-verifies a *deployed* worker end to end (health, pairing, context
  round-trip, scheduler observability — safe: no autonomous action, no Google
  credentials).

## What actually leaves your device

| Data | Direction | Consent |
|---|---|---|
| Routine definitions (name, schedule, timezone, instruction, permissions, policy) | app → worker | Pairing + each routine save. The worker's copy is a **disposable mirror**; the app stays the source of truth. |
| Autonomy settings (master switch, event budget) | app → worker | Pairing. Carries a **generation counter** so an older configuration can never overwrite a newer one. |

### Phase C2 — generation model (stale-run protection)

1. **Authoritative generation:** installation-wide `configGeneration` (Durable Object `meta`). There is no per-routine generation; a config sync invalidates every in-flight cloud claim.
2. **Where stored:** DO `meta.configGeneration`. `stateGeneration` is a separate journal/context snapshot and **is not** a stale trigger (context-only sync must not kill runs).
3. **When captured:** `freezeEnvelope` at claim copies live `configGeneration` and `stateGeneration` onto the frozen envelope.
4. **Where checked:** `AutonomyStore.completeCloudAdmission`, inside the same SQLite transaction as event insert / run terminalization. The Workflow does not compare generations.
5. **When stale** (`frozen.configGeneration !== live configGeneration`): no event, no schedule advance at admission, terminal `STALE_GENERATION`, HTTP `status: stale`. Dispatch-time schedule advances are not rewound.
6. **Live gates (separate from generation):** master-off, routine disable, routine delete → `cancelled-admission`, also no event and no schedule advance at that admission. When a real config sync turns the master off it also bumps `configGeneration`, so those in-flight claims fail as stale (still fail-closed).
7. **Equal generation:** accepted only as an idempotent replay of the same payload hash. A different body at the same generation is `409 config-conflict`. The app adopts the worker generation and does not replay the rejected payload.
8. **Recovery:** `recoverInFlight` must not dispatch or advance a claim whose frozen generation or live gates no longer match; it terminalizes instead. After Workflow `create()` yields, gates are re-read. Schedule advance uses the **frozen** routine and only while the claim is still current. Admission advances idempotently (`scheduleAdvanced`).
9. **Signed writes:** HMAC covers `method`, `path`, `timestamp`, `nonce`, and `body`. The DO nonce ledger still rejects replays.
| **Autonomy Context** — a bounded, read-only memory projection | app → worker | **A separate opt-in flag per memory** (`autonomyContext`, default off). ≤ 200 records, ≤ 100 KB, only active, non-expired, established (CORE/CONTEXTUAL/EPISODIC) memories you explicitly ticked. |
| Scheduler observations (run records) | worker → app | Implied — pulled into your local run history on app open. |

**What never leaves:** your Google OAuth tokens, the Gemini Lockbox key,
full conversation transcripts, memory records you did not tick, relationship
graphs, folder metadata, artifact blobs, and any Google-originated data.

Delete the worker deployment at any time: you lose cloud scheduling, **not
your data**. Unpairing in Settings removes the local pairing (the token is a
client credential stored only in your browser, local-only); the worker keeps
its disposable mirror until you pair again — use **Clear** on the Autonomy
Context card (or redeploy the worker) to wipe what it holds.

## The Autonomy Context

Settings ▸ Autonomy ▸ *Autonomy Context* shows exactly what would travel:

- **Inspect** lists every record in the current projection (title, kind,
  size) and every *eligible* memory you have not included. Ticking a memory
  includes it; unticking removes it at the next sync. Nothing is ever
  included automatically.
- **Refresh** rebuilds the projection from your local memories and syncs it
  **only if its content hash changed** — a pure function of your local data,
  deterministically ranked (importance/confidence/recency), truncated to the
  budgets.
- **Clear** wipes the worker-side pack immediately.
- The pack is **replaced atomically** — the worker never keeps old versions,
  and a memory you deleted locally is gone from the cloud at the next
  replacement.
- The worker re-validates every pack it receives (shape, kinds, count, size,
  content hash) and fails closed on anything malformed. It never echoes the
  content back — only counts, sizes, and hashes.
- If the pack is older than 14 days the UI shows a **stale** warning. A
  memory-dependent routine never *fails* because the pack is empty — it runs
  degraded ("autonomy context unavailable").

## Run records you will see

Cloud-native routines execute in the worker. Device-locus routines are still
recorded as due, not auto-executed:

| Record | Meaning |
|---|---|
| `completed` / `no-op` / `cannot_act` | A cloud-locus routine ran. Outcomes follow the C1 admission policy. |
| `failed · STALE_GENERATION` | Config generation changed before admission; no event was written. |
| `skipped · SCHEDULER_DEVICE_DUE` | A Google-backed routine came due. The worker never executes these. |
| `missed · SCHEDULER_MISSED` | An occurrence's grace window passed without processing. |
| `skipped · SCHEDULER_BUDGET_EXCEEDED` | The routine's "Max scheduled runs per day" budget was used. |

The scheduler's own decisions (registrations, cancellations, repairs,
heartbeats, overlap refusals) are visible in the *Scheduler decisions*
section of the cloud card, and the hourly heartbeat repairs anything the
exact alarm missed (deploys, evictions, control-plane blips).

## Retention

- Autonomous events: 90 days / 500 records (local and worker-side).
- Run history: 30 days / 1 000 records (local and worker-side).
- Scheduler journal: last 200 decisions.
- Nonce ledger (replay protection): only the last 10 minutes.

## How to disable everything

1. **Master switch off** (Settings ▸ Autonomy) — the worker mirror is updated
   and all schedules are cancelled; nothing fires.
2. **Unpair** — the app stops talking to the worker entirely.
3. **Delete the worker deployment** (Cloudflare dashboard) — cloud scheduling
   ends; your local data is untouched.
4. Chat is never affected by any of these.

## Troubleshooting

- **"Sync failed (…)"** — the worker URL must be reachable from the browser;
  check the URL and that the deployment exists. Network errors never touch
  local data.
- **Pairing 401** — the token must equal the worker's
  `ELARA_INSTALLATION_TOKEN` secret exactly. Rotate it with
  `wrangler secret put` and re-pair.
- **Version mismatch on pairing** — the worker's autonomy schema version and
  the app's must match; update one of them.
- **"stale config rejected"** — another device/browser synced a newer
  configuration. The app adopts the newer generation automatically; your next
  change supersedes it.
- **A routine never fires** — check: master switch on, routine enabled,
  timezone correct, and the worker's cron trigger deployed
  (`wrangler deploy` shows triggers). The cloud card shows the next scheduled
  wake per routine.
- **Duplicate-looking history rows** — cloud observations are pulled into the
  local history idempotently by occurrence identity; a repeat pull never
  duplicates a record.

## What is NOT implemented yet (honest list)

- **Phase C** (C0–C2) has landed for cloud-native routines. Do not treat this as Phase D.
- **Phase D — notifications:** no Web Push, no quiet hours. The Autonomy
  Inbox is the only delivery channel.
- **Phase E — web tools:** no web search/fetch for routines.
- **Phase F — device catch-up execution:** due *device* routines are recorded
  (SCHEDULER_DEVICE_DUE) but not yet auto-executed at app open.
- **Phase G/H — evidence intelligence and server-side Google OAuth:** not
  started; server-side Google credentials are explicitly deferred to a
  separate security project.
- The per-memory consent UI currently lives in the Autonomy Context card
  (Inspect), not yet in the Memory Bank with bulk actions.

For the engineering view of what landed and what deviates from the design,
see the *Implementation status* entries in
[`AUTONOMOUS_ELARA_DESIGN.md`](./AUTONOMOUS_ELARA_DESIGN.md) §16.
