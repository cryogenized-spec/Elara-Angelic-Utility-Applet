# Autonomous Elara — Architecture / Research / Forensic Design Report

> **Status:** Design-phase deliverable. No production code was modified. Nothing is merged.
> **Prepared:** 2026-09-08, against `main` at `4f01e89` (post–PR #11).
> **Revised:** 2026-09-08 (owner review reconciliation — three mandatory gates resolved: see §7.4,
> §8.4.1, §8.5. Q1/Q3/Q4/Q6 resolved; implementation-readiness updated in §22).
> **Companion:** This document is the design report. The eventual user-facing setup guide is
> reserved for `docs/AUTONOMOUS_ELARA.md`, which the Settings UI will link to once implementation begins.

---

## 1. Executive verdict

The proposed direction — a user-controlled autonomous subsystem in which Elara wakes on a schedule,
observes permitted sources, decides whether anything is worth acting on, and communicates useful
results — is **architecturally sound and achievable on the Cloudflare free tier**, and it aligns
with boundaries the repository has already drawn (the Worker-as-narrow-boundary rule, the
`future-implementation/README.md` reservation of Cron for scheduled agent work, and the OAuth
handoff's explicit anticipation of "durable server-side offline execution while the user is absent").

However, the forensic review surfaced **one structural correction** that reshapes the plan:

> **Autonomy is not one system. It is two execution loci sharing one routine model.**
>
> 1. **Cloud-native routines** (web + bounded memory context) — executed entirely in a
>    user-deployed Cloudflare Worker. No Google credentials required.
> 2. **Device-native routines** (Google-backed: Tasks, Calendar, Gmail, …) — the cloud provides
>    the clock and a due nudge; execution happens **on the device at app-open catch-up**, using
>    the existing browser OAuth authority unchanged.

The reason is the credential boundary, not the scheduler. The current Google OAuth authority is
browser-native GIS implicit flow: short-lived access tokens held only in memory, **no refresh
tokens, and refresh tokens are impossible in that flow**. Cloud-executing a "review my Google
Tasks at 13:00 while my phone is closed" routine requires a *new, separately-consented*
authorization-code authority with server-held refresh tokens — a major security-surface decision
the repository has explicitly deferred, and which this design declines to smuggle in.

The two-loci model delivers the flagship cloud experiences (morning news briefing, topic watch,
weather) with zero credential changes, gives Google-backed routines an immediately useful
"due nudge + catch-up" behavior, and leaves a clean, explicitly-gated path to full cloud execution
later. Everything else in the proposal — Routine as the user-facing concept, cron as clock not
brain, structured permissions, no-op as a successful outcome, anti-stalker policy, evidence-based
proactivity — survives review and is reinforced below.

**Verdict: DESIGN READY** — suitable for implementation after resolving the open questions in
§18, of which four are true gates (Q1–Q4).

> **Post-review addendum (2026-09-08).** The project owner endorsed the two-loci split (Q1),
> the elimination of the public wake endpoint, the hybrid cron-heartbeat + DO-alarm scheduling
> model with Workflows subordinate to the scheduler (Q4), and required three gates to be
> resolved before greenlight: a hard comparison of hand-rolled DO scheduling vs the Cloudflare
> Agents SDK (resolved in §7.4), an exact specification of the local/cloud data boundary —
> the **Autonomy Context** (resolved in §8.5), and an explicit Google credential decision
> record (resolved in §8.4.1). The owner's framing is adopted as canonical vocabulary:
> **Cron = town clock · DO alarm = appointment · Routine = the appointment's meaning ·
> Workflow = the work performed.**

---

## 2. What the current repository already gives us

Forensic findings from `main` @ `4f01e89`. Do not assume older architectural discussion; several
things have moved (notably: the Worker OAuth boundary was **retired**, and interactive chat
currently runs **direct browser → Gemini with the local Lockbox key**, with the Worker as the
alternative protected boundary).

### 2.1 Worker infrastructure (current state)

- One Worker: `worker/` → `elara-gemini`, `wrangler.toml` with `workers_dev = true`,
  `compatibility_date = "2026-09-03"`, one var (`ALLOWED_ORIGINS`, pinned to the Pages origin)
  and one secret (`GEMINI_API_KEY`).
- Routes: `GET /health` (public, non-secret status), `POST /api/gemini` (SSE streaming with
  server-side tool-call extraction), `POST /api/transcribe` (VTT). CORS origin allowlist is the
  only inbound auth; there is **no token, no HMAC, no per-user identity**.
- **No `scheduled` handler, no `[triggers]`, no Cron. No KV / D1 / R2 / Queues / Durable
  Objects / Workflows bindings. No wake endpoint.** The Worker is a stateless request/response
  mediator.
- The Worker imports pure app modules (`src/google/tools/contracts.ts`,
  `gemini-declarations.ts`) — **sharing repo-owned pure code between app and Worker is already
  established practice.**
- `scripts/verify-gemini-worker.mjs` performs live health + preflight verification against the
  deployed worker (`elara-gemini.cryogenized.workers.dev`); `npm run worker:dev`, `worker:types`,
  `verify:worker` exist. Deployment is manual (wrangler), not in CI.
- The OAuth handoff (`docs/oauth/README.md`) records that a **Worker-based Google OAuth boundary
  was built and then deliberately retired**; the Worker "must not regain Google OAuth/session/
  token responsibilities." It also explicitly states the authorization-code model is "the correct
  foundation when Elara needs durable server-side offline execution while the user is absent" —
  i.e., this exact project was anticipated and deferred, not forbidden.

### 2.2 Application architecture (current state)

- **Boot/topology:** Vite + React 19 PWA (`vite-plugin-pwa`, `registerType: 'autoUpdate'`),
  deployed to GitHub Pages. All state is local: Dexie/IndexedDB (`elara-angelic-utility-applet`,
  schema v7) + localStorage. No server-side app state exists anywhere.
- **Settings architecture:** `SettingsScreen` sections: appearance, character, memory, typography,
  model, google, chat, roleplay, security. Section idiom: left nav list + right detail panel,
  mobile-first. Preferences live in `src/domain/preferences.ts` (localStorage-backed).
- **Capability system:** `googleToolRegistry` — 60+ named tools with `risk` (read/write/
  destructive/send), `capability`, `exposure` (`gemini` | `internal`). Model-visible surface is
  an explicit allow-list (`googleGeminiFunctionDeclarations`).
- **OAuth authority:** `src/google/oauth/` — one authority (`authority.ts`) over GIS implicit
  token client (`gis.ts`). Access tokens live **only in a module-level session variable**
  (~1 h lifetime, 60 s refresh skew); localStorage stores only non-secret capability evidence
  (v3 format with scope manifest; legacy v2 migration honored strictly). Silent `prompt: 'none'`
  reacquisition, one 401 recovery, revocation, structured diagnostics. **No refresh tokens.**
- **Semantic tool executor:** `src/google/tools/executor.ts` — zod-validated arguments,
  capability authorization check, risk-classified **write confirmation** (interactive UI broker,
  5-minute freshness), handler dispatch, normalized failure classification. Runs **in the
  browser**.
- **Agent loop:** `src/gemini/google-tool-loop.ts` — `streamGoogleToolLoop` is a transparent
  async-generator over the provider port: streams events, collects tool calls, enforces
  `maxToolCalls` (default 8, hard cap 20), parks mutations on the confirmation broker with a
  heartbeat, and already supports a **`readOnly: true` mode** that rejects any non-read tool.
  This loop is the single most reusable asset for autonomy.
- **Gemini provider boundary:** `src/gemini/provider.ts` — canonical Interactions contract
  (request schema, normalized `GeminiStreamEvent`s, tool-result continuation). The browser path
  currently constructs `GoogleGenAI` directly with the Lockbox key; the Worker path implements
  the same contract server-side with SSE-safe event mapping (`toSafeEvent`). Two runtimes, one
  canonical contract — the "one path" rule is about the contract, not the process.
- **Background execution:** `src/gemini/background/contracts.ts` defines
  `BackgroundInteractionRef` + `GeminiBackgroundExecutor` (start/get/cancel). **Contracts only —
  no runtime wiring exists.** Gemini Interactions background execution (create → poll/reconnect/
  cancel) is available upstream when needed.
- **Generation arbitration:** `GenerationArbiter` (single active generation id per UI session),
  turn watchdog (45 s idle stall / 15 min absolute), `generation-sync` one-assistant-message
  invariant, `turn-lineage` response variants/regeneration with snapshot-based retry bases.
  All **in-memory and UI-session-scoped** — conceptually inapplicable to headless runs.
- **Memory subsystem:** Dexie `memories` table; ranked retrieval (lexical + importance +
  confidence + reinforcement + recency + lifecycle, hard item/character budget); folder-scoped
  retrieval composed into the system instruction as *context, not instruction*; `memory`
  capability with permission checks and provenance (`user`/`elara`/`import`/`migration`);
  observations are `MICRO_OBSERVATION` records consolidated explicitly (support/conflict/related);
  lifecycle active/dormant/archived; `expiresAt`; recall bookkeeping; Memory Bank inspection UI.
- **Persistence:** Dexie v7 with migrations; tables: messages, threads, settings,
  workspaceShortcuts, folders, folderAssignments, memories, artifactMetadata, artifactBlobs.
  localStorage keys for OAuth evidence, folders cache, active thread, ui prefs.
- **Artifacts:** first-class domain objects (attachment/generated/derived), metadata + blob
  tables, provenance, `operationId` guards for race-safe status transitions, `remoteRef` for
  Gemini Files, PDF generation via BusyTeX, size limits in `ARTIFACT_LIMITS`.
- **Message model:** `ChatMessage` with roles, response groups/variants, execution summaries,
  `providerTurn` metadata (model, interactionId, generationId, usage). Threads with titles.
- **Error model:** `normalizeGeminiError` → structured errors (code/category/retryable/debug);
  `ArtifactError`; OAuth diagnostics classifications; provider errors never become strings until
  presentation.
- **Notifications:** **none.** No Push API code, no service-worker push handler, no VAPID keys.
  The workbox SW is generated only.
- **Scheduling abstractions:** none in-app. `docs/future-implementation/README.md` reserves Cron
  for scheduled agent work "through a durable job/orchestration boundary," explicitly requiring
  server-side cron config, retry policy, idempotency, execution records, and user authorization.

### 2.3 Tests (current conventions)

- **Unit:** Vitest, jsdom, `fake-indexeddb` for IndexedDB-backed stores; pure-function tests
  dominate; async-generator tool-loop tests with mocked provider ports; zod contract tests.
- **Worker tests:** `worker/src/*.test.ts` invoke `worker.fetch(request, env)` **directly** with a
  mocked `@google/genai` — the Worker is tested as a unit without miniflare. No scheduled-handler
  testing exists (there is no handler).
- **E2E:** Playwright (`e2e/*.spec.ts`) — onboarding, lockbox, oauth settings, threads, folders,
  mobile reliability, VTT, roleplay, shortcuts, smoke.
- **Auth mocking conventions:** OAuth status injected via fake authorities; confirmation broker
  stubbed; provider errors simulated at the port boundary.
- **CI:** lint + typecheck (app and worker tsconfigs) + vitest + build + Playwright +
  `reliability-gate.mjs` (architecture invariants: forbidden imports, single-provider rules,
  doc existence).

### 2.4 Forensic conclusions

1. The repo is **maximally positioned** for this feature: allow-listed tool surface, risk
   classes, capability registry, read-only loop mode, structured events, race-safe persistence,
   and a Worker that already shares pure modules with the app.
2. The two genuine gaps are **(a) notification infrastructure (absent entirely)** and
   **(b) server-side execution state (absent entirely — no DO/Queue/Workflow/KV/D1/R2)**.
3. The credential architecture makes "cloud executes Google reads" a **separate, explicit
   project**, not an implementation detail.

---

## 3. Cloudflare findings (researched 2026-09-05/08)

Sources: official Cloudflare docs (limits, cron triggers, scheduled handler, DO limits, Queues
limits, pricing, Workflows changelog) plus current third-party references. Numbers below are the
ones that matter to this design.

### 3.1 Cron Triggers

- **Limits:** 5 Cron Triggers **per account** on Free; 250 on Paid
  ([Limits](https://developers.cloudflare.com/workers/platform/limits/)). (Some third-party
  posts claim per-Worker caps of 3–5; the official docs table says per account — plan against
  the official number, but note a single-Worker design is immune either way.)
- **Semantics:** UTC only; 5-field cron with Quartz-like extensions (`L`, `W`, `#`); 1-minute
  minimum granularity; each trigger invokes the same `scheduled()` handler; `controller.cron`
  identifies which one fired; `controller.scheduledTime` gives the intended time
  ([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)).
- **Execution:** wall-clock max **15 minutes per scheduled invocation**; CPU per Cron Trigger:
  **10 ms (Free)**, 30 s (< 1 h interval) / 15 min (≥ 1 h interval) (Paid)
  ([Limits](https://developers.cloudflare.com/workers/platform/limits/);
  [DO wall-time table](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **Retries/failures:** no contractual retry or failure alerting; the scheduled-handler API
  exposes `controller.noRetry()`, implying the runtime *may* re-attempt failed handlers —
  semantics are not documented as a guarantee. **Design rule: treat cron as possibly-at-least-once,
  possibly-at-most-once; be correct under both.** Execution history (last 100 invocations) is
  visible in the dashboard.
- **Overlap:** each tick is a fresh invocation; overlapping invocations of the same cron are
  possible if a handler runs long. Idempotency must be designed in.

**Practical read:** a single hourly (or 15-minute) cron that does nothing but wake a Durable
Object fits Free trivially (24–96 invocations/day of the 100 k/day budget, sub-millisecond CPU).

### 3.2 Workers

- Free: 100 k requests/day; **10 ms CPU/invocation**; 128 MB memory; **50 external subrequests**
  (plus a separate 1 000-subrequest allowance to Cloudflare services); 6 simultaneous outgoing
  connections; 64 env vars; 64 MiB script size; 100 Workers/account.
- Paid ($5/mo): no request cap; 5 min CPU max (default 30 s); 10 k subrequests (configurable to
  10 M); 128 MB memory.
- ([Limits](https://developers.cloudflare.com/workers/platform/limits/);
  [subrequest changelog](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)).

**Practical read:** the 10 ms Free CPU ceiling is the binding constraint — an agent loop that
parses large SSE payloads can plausibly exceed it. Therefore **no agent reasoning belongs in a
plain Worker request/cron invocation on Free**; heavy work must run in Durable Objects or
Workflows (see below), which have their own generous CPU allowances.

### 3.3 Queues

- Available on **both Free and Paid**. Free: **10 000 operations/day** (a < 64 KB message costs
  ~3 ops: write+read+delete), 24 h retention (non-configurable). Paid: 1 M ops/month, then
  $0.40/M; retention up to 14 days
  ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
- Limits: 128 KB messages; consumer batch ≤ 100; consumer wall time **15 min**; consumer CPU
  configurable to 5 min; at-least-once delivery; ≤ 100 retries; `delaySeconds` ≤ 24 h
  ([Queues limits](https://developers.cloudflare.com/queues/platform/limits/)).
- **Assessment:** useful for fan-out isolation, bounded retries, and smoothing bursts. For a
  single-installation v1 with a handful of routines/day, **not required** — DO serialization
  plus Workflow retries cover it. Defer; revisit if multi-routine concurrency or delivery
  retries need isolation.

### 3.4 Workflows

- Available on **both Free and Paid**. Free: **3 000 steps/day**, 1 GB-month storage, 3-day
  retention. Paid: 500 k steps/month (then $0.80/100 k), 1 GB-month then $0.20/GB-month, 30-day
  retention; step+storage billing active since 2026-08-10
  ([changelog](https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/)).
- Semantics: durable execution; each step has **unlimited wall time** and the configured CPU
  limit; built-in per-step retries with backoff; `sleep()`/event waits count as steps; instances
  are keyed by ID (creating with an existing ID returns the existing instance).

**Assessment:** a routine run is almost exactly a Workflow shape (load config → execute → gate →
persist → notify → record) and **instanceId = runKey gives platform-level idempotency for
free**. A run costs roughly 8–20 steps; at the proposed default caps (≤ 24 runs/day, ≤ 50 with
headroom) that is ≤ ~1 000 steps/day — comfortably inside Free, with a documented Paid cliff.
**Recommendation: use Workflows for routine execution.**

### 3.5 Durable Objects

- Available on **Free** (SQLite-backed only): 100 classes/account, **5 GB storage**, 10 GB per
  object; SQLite rows read/written meter like D1 on Free (5 M reads/day, 100 k writes/day);
  100 k requests/day + 13 000 GB-s/day compute on Free.
- Single-threaded per object (natural mutex — no read-modify-write races); hibernate at zero
  cost; wake on request/WebSocket/alarm/RPC.
- **Alarms:** one alarm per object; alarm handlers get **15 min wall time**, 30 s default CPU,
  and **automatic retries (up to 6, exponential backoff)** — the only Cloudflare scheduling
  primitive with documented retry semantics
  ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- The **Agents SDK** (`agents` package) builds exactly the "durable agent" pattern on DOs:
  `this.schedule()` accepting cron strings/`Date`/delay, `scheduleEvery()`, schedules persisted
  in SQLite and multiplexed through the single alarm, wake-on-alarm for hibernated agents
  ([Agents docs — long-running agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/)).

**Assessment:** DOs are the natural home for per-installation autonomy state: routine mirror,
run records, events, delivery/cooldown ledger, push subscriptions, budget counters. The alarm
mechanism is the *exact-schedule* layer that the coarse cron heartbeat lacks. Either adopt the
Agents SDK (convenience, but brings framework gravity and a dependency) or implement a minimal
schedule table + single-alarm multiplexer ourselves (~100–150 lines, fully testable). Open
question Q3.

### 3.6 KV / D1 / R2

| Service | Could help with | Actually solves? | Verdict |
|---|---|---|---|
| **KV** | Config mirror, cheap reads | No — eventually consistent (stale reads up to ~60 s), 1 k writes/day on Free, no queries. Autonomy state needs transactional correctness. | **Defer.** DO SQLite is strictly better here. |
| **D1** | Relational store across installations | No — one installation = one user; DO SQLite already gives per-installation relational storage with stronger consistency. | **Defer.** Revisit only if a shared multi-tenant service ever exists (not recommended anyway). |
| **R2** | Large generated artifacts (PDFs) | Partially — but autonomous artifacts in v1 are text/markdown payloads (≤ 2 MB) that fit event records and sync to the local artifact store on app open. | **Defer.** Add only when cloud-generated binary artifacts exceed event payload budgets. |

No Cloudflare product is added "because it exists." The recommended stack is: **1 Cron Trigger +
1 Durable Object class + 1 Workflow + (later, optional) 1 Queue.**

---

## 4. Recommended architecture

### 4.1 Topology

The infrastructure principle is preserved and strengthened: **Cloudflare is the clock, not the
brain** — and in the recommended topology there is **no public wake endpoint at all**, because
the cron and the execution runtime live in the same Worker and communicate via bindings. There
is nothing on the public internet to replay or forge. The only public surface is the
app↔worker API (pairing, config sync, event pull, push registration), which is authenticated.

```text
                        USER'S CLOUDFLARE ACCOUNT (free tier)
┌──────────────────────────────────────────────────────────────────────────┐
│  Worker: elara (extends the existing elara-gemini worker)                │
│                                                                          │
│  Cron Trigger "0 * * * *"  ──►  scheduled()  ──►  env.AUTONOMY          │
│        (the clock: does                  │            .heartbeat()      │
│         nothing else; <1 ms CPU)         ▼                                │
│                              ┌─────────────────────────┐                 │
│                              │  Durable Object          │                 │
│ │  AutonomyEngine (per installationId)  │                 │
│                              │  • routines mirror        │                 │
│                              │  • run records (runKey)   │                 │
│                              │  • events + delivery      │                 │
│                              │    ledger + cooldowns     │                 │
│                              │  • memory pack (RO)       │                 │
│                              │  • push subscriptions     │                 │
│                              │  • budget counters        │                 │
│                              │  • config generation      │                 │
│                              │  • alarm() = exact firing │                 │
│                              │  • heartbeat() = sweep    │                 │
│                              └───────┬───────────────────┘                 │
│                                      │ due run (runKey =                   │
│                                      │   routineId:scheduledFor)           │
│                                      ▼                                    │
│                        Workflow: RoutineRun (instanceId=runKey)          │
│                          step: load config snapshot (generation check)   │
│                          step: budget/policy pre-check                    │
│                          step: execute agent loop (web + memory tools)    │
│                          step: action gate (deterministic policy)        │
│                          step: persist event + deliveries                 │
│                          step: record run summary                         │
│                                                                          │
│  Routes: /health · /api/gemini · /api/transcribe (unchanged)              │
│          /autonomy/health · /autonomy/pair · /autonomy/config            │
│          /autonomy/events · /autonomy/push-subscription  (authenticated) │
└──────────────────────────────────────────────────────────────────────────┘
          ▲ pairing / config sync / event pull / push registration
          │ (bearer token + HMAC-signed writes + origin allowlist)
┌─────────┴────────────────────────────────────────────────────────────────┐
│  PWA (GitHub Pages) — authoring, consent, persistence, device execution   │
│  • Settings ▸ Autonomy (state machine, master switch, routines)          │
│  • Dexie: routines, autonomous events, run-history mirror, inbox         │
│  • Device-native routine executor (app-open catch-up + run-now)          │
│  • Service worker: push handler (notification click → inbox)             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 The two execution loci (the central proposal-challenge)

| | Cloud-native routine | Device-native routine |
|---|---|---|
| **Tools** | `web.search`, `web.fetch`, `memory.search` (pack), memory-pack context block | Full existing read-only Google tool surface + memory + conversation context |
| **Credentials** | Worker secrets only (Gemini key, web provider key) | Existing browser OAuth authority — unchanged |
| **Runs when** | At exact scheduled time, app closed | Cloud pushes a **due nudge** at scheduled time; execution at app-open catch-up (or live if app open, or manual "Run now") |
| **Flagship examples** | Morning news briefing; topic watch; weather threshold | Task follow-up review; calendar pre-meeting awareness |
| **Data leaving device** | Routine config + bounded memory pack (opt-in) | Schedule metadata + nudge text only (no Google data in cloud) |
| **Derivation rule** | `permissions.google` empty → cloud | `permissions.google` non-empty → device (until autonomy grants exist, §8.4) |

Both loci share: the routine model, due-evaluation, the event/inbox model, the anti-stalker
policy, run history, and the settings UI. The user sees one coherent feature; the credential
boundary is expressed as an explicit, UI-visible property of each routine ("Runs in your
Cloudflare worker while you're away" vs "Runs on this device when you open Elara; Elara's
worker only reminds you it's due").

### 4.3 Why not wake-the-browser instead?

A push-triggered service worker executing the routine in the background was considered and
rejected as the primary mechanism: Android doze and Chrome background-SW lifetimes are
unreliable for multi-second LLM loops, and **iOS forbids silent push for PWAs entirely** (push
requires home-screen install and must show a visible notification). The cloud nudge +
app-open catch-up model degrades gracefully on every platform and never depends on background
execution. (Local *live* execution when the app happens to be open at due time is still allowed
as a fast path.)

### 4.4 Scheduler portability: WakeSource and SchedulerPort (architectural invariant)

Cloudflare's limits and semantics have changed before (the Cron Trigger cap was reported
differently by multiple current sources before the official docs settled it) and will change
again. The autonomy model must therefore never be coupled to a raw scheduling primitive.
The durable abstraction is:

```text
Wake source  →  Scheduler  →  Routine  →  Workflow(runKey)
(any timer)     (domain)     (meaning)    (the work)
```

```ts
/** worker/src/autonomy/ports.ts — the only code that knows what a wake IS. */
interface WakeSource {
  /** Register interest in the next coarse wake. Today: the cron trigger in wrangler.toml.
   *  Tomorrow (if ever): an external timer, a Workflow sleep loop, an Agents SDK schedule. */
  readonly kind: 'cron-trigger' | 'external-http' | 'workflow-sleep' | 'agents-sdk';
}

/** The only consumer of wake events. All due-time TRUTH lives behind this port. */
interface SchedulerPort {
  ensureScheduled(routineId: string, dueAt: number): Promise<void>; // idempotent
  cancel(routineId: string): Promise<void>;
  dueWithin(fromMs: number, toMs: number): Promise<Array<{ routineId: string; dueAt: number }>>;
}
```

- **Due-time computation is pure domain code** (`computeNextDue(schedule, timezone, from)`,
  DST/catch-up/grace rules from §7.3), shared between app and worker exactly like the existing
  `googleToolNameSchema` sharing pattern — unit-tested with timezone fixtures, no framework.
- **The cron trigger, the DO alarm, and any future Agents SDK `schedule()` are all
  interchangeable *implementations* behind `WakeSource`/`SchedulerPort`.** Swapping cron →
  DO-alarm-only, or hand-rolled → SDK, rewrites one module, never the autonomy model.
- The DO alarm is the *firing* mechanism (exact due moment); the cron heartbeat is the *repair*
  sweep. Neither is load-bearing alone — see §7.4 for why this matters to the Agents SDK
  question.

---

## 5. Routine model (recommended smallest strong model)

```ts
type RoutineSchedule =
  | { kind: 'daily'; time: 'HH:mm'; days: 'every' | 'weekdays' | 'weekends' | number[] } // 0=Sun
  | { kind: 'interval'; everyMinutes: number; between?: { start: 'HH:mm'; end: 'HH:mm' } };

type RoutineImportance = 1 | 2 | 3; // low | medium | high

interface RoutinePermissions {
  web: boolean;                 // web.search + web.fetch (cloud routines)
  memoryPack: boolean;          // read-only synced memory projection (cloud routines)
  google: GoogleCapabilityKey[];// device routines until autonomy grants exist
  conversationSummaries: boolean; // OFF by default; device routines only
}

interface RoutineDelivery {
  inbox: boolean;               // events always land in the inbox by default
  push: boolean;
  minImportanceForPush: RoutineImportance;
}

interface RoutinePolicy {
  maxRunsPerDay: number;        // default 4, hard cap 12
  maxToolCalls: number;         // default 8, hard cap 20 (matches interactive loop)
  cooldownHours: number;        // same-topic suppression window, default 24
  quietHours?: { start: 'HH:mm'; end: 'HH:mm' };
  catchUp: 'never' | 'if-late-under-6h';
}

interface ElaraRoutine {
  id: string;
  name: string;
  enabled: boolean;
  instruction: string;             // natural-language intent (user-authored)
  schedule: RoutineSchedule;
  timezone: string;                // IANA; captured from the app at authoring
  permissions: RoutinePermissions;
  delivery: RoutineDelivery;
  policy: RoutinePolicy;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;              // computed, not stored-authoritatively
  lastResult?: RoutineRunSummary;
}
```

**A1 as-implemented schema note:** the landed `RoutinePermissions` is
`{ memory: boolean; google: RoutineGoogleCapability[] }` — `web`, `memoryPack`
(→ §8.5 Autonomy Context), and `conversationSummaries` are NOT implemented
(Phase B+); `policy.quietHours` and `policy.catchUp` are not implemented
(quiet hours arrive with delivery/Phase D, catch-up with the Phase B
scheduler); `delivery.push` is stored but has no delivery channel yet (inbox
only). The schema above is the design target, not the current state.

**Deliberately included / excluded (with reasons):**

- **Timezone:** yes, per routine (people travel; the app knows the device tz at authoring and
  can offer to update on change). DST-safe evaluation in §7.
- **Weekday restrictions:** yes (`days`). **Quiet hours:** yes (delivery-time policy).
- **Min importance:** yes, as a *delivery* threshold, not an execution threshold.
- **Cooldown / max frequency:** yes — both are anti-stalker controls, non-negotiable.
- **Retry policy:** no field — owned by the Workflow step configuration, uniform across
  routines; a per-routine override invites foot-guns.
- **Expiration / temporary suspension:** `enabled` covers suspension; expiration is YAGNI. The
  *system* may set a `paused-needs-consent` flag on a routine after repeated
  authorization-needed failures (not user-editable state, derived).
- **Thread/conversation association:** no. Autonomous events go to a dedicated Autonomy inbox
  (§9.3), never into ordinary threads.
- **Priority / concurrency / dependencies / grouping:** **no** (§46 answer). The model stays
  flat; budgets are per-routine + global. Nothing in the schema prevents adding priorities
  later (runs are independent records).
- **Idempotency:** not on the routine — on the **run** (`runKey`).
- **Run history / evidence / confidence:** on the run record and event, not the routine
  (beyond a `lastResult` summary for the UI).

**Run record (worker DO SQLite; mirrored summary to app):**

```ts
interface RoutineRunRecord {
  runKey: string;            // `${routineId}:${scheduledForEpoch}` — idempotency key
  routineId: string;
  scheduledFor: number;      // epoch ms of intended firing
  state: 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'cancelled' | 'missed';
  outcome?: 'no-op' | 'event' | 'error';
  startedAt?: number; completedAt?: number;
  itemsExamined?: number;
  noveltyFingerprint?: string;
  toolCalls?: number; durationMs?: number;
  eventId?: string; errorCode?: string;
  evidenceRefs?: string[];
}
```

**Autonomous event:**

```ts
interface AutonomousEvent {
  id: string;
  routineId: string;
  runKey: string;
  title: string;
  summary: string;             // structured reasoning summary; NEVER chain-of-thought
  importance: RoutineImportance;
  confidence: RoutineImportance; // 1–3 scale keeps the model honest and the UI simple
  noveltyFingerprint: string;    // stable content hash for dedup
  evidence: EvidenceRef[];       // { kind: 'memory' | 'web' | 'tool'; ref: string; note?: string }
  createdAt: number;
  deliveries: DeliveryRecord[];  // { channel: 'inbox' | 'push'; state; at?; errorCode? }
}
```

The event abstraction is **retained** — it cleanly decouples "Elara reasoned and found
something" from "how and whether the user hears about it," and it makes dedup, cooldown, and
multi-channel delivery tractable as pure functions over event records.

---

## 6. Autonomy / authority model

### 6.1 The authority ladder (unchanged in spirit, extended to autonomy)

```text
SYSTEM POLICY            hard-coded: tool registry, risk classes, action gate, budgets,
     ▼                   prompt-injection framing, notification caps. NOT editable anywhere.
USER ROUTINE             user-authored instruction + structured permissions.
     ▼                   Semi-trusted: can express intent, never expand authority.
USER-AUTHORIZED CONTEXT  memory pack, conversation summaries — data about the user,
     ▼                   retrieved under explicit permission flags.
EXTERNAL DATA            web pages, search results, (later) email/task/calendar content.
                         EVIDENCE, NEVER AUTHORITY. Cannot grant tools, cannot change
                         policy, cannot address the user as if instructed.
```

Enforcement is **deterministic code**, exactly as the proposal demands:

1. **Tool authorization** happens before any model involvement: the routine's structured
   `permissions` select the tool set; the server loop physically cannot dispatch an
   unlisted tool (same pattern as the existing executor).
2. **The action gate** is a post-model, pre-effect checkpoint: the agent's terminal output must
   parse as a structured `RoutineOutcome` (zod) — either `no-op` (with an optional one-line
   reason for run history) or an event proposal (title/summary/importance/confidence/evidence).
   Anything else is a run failure, not a fallback action.
3. **Delivery policy** (importance threshold, quiet hours, cooldown, novelty fingerprint,
   daily caps) is evaluated in code against the event record. The model can *propose*
   importance; it cannot force a notification.
4. **No write-class tools exist in the cloud surface in v1.** `web.fetch` is read-only
   GET with SSRF controls. Autonomous writes (§6.3) are a separate policy class and a separate
   future decision.

### 6.2 Read vs. generate vs. mutate

| Class | Cloud v1 | Device v1 | Policy |
|---|---|---|---|
| Reads (web, memory pack) | ✅ | ✅ (full Google read surface) | routine permission flags |
| Non-destructive generation (summaries, briefings, markdown/PDF artifacts) | ✅ | ✅ | normal action gate; artifacts are attached to events |
| Google reads | ❌ (no credentials) | ✅ | existing capability checks |
| Google writes / sends | ❌ | ❌ for autonomous runs — **autonomous device runs use `readOnly: true` loop mode** (the existing enforcement point) | existing confirmation model remains interactive-only |
| External mutations / communications | ❌ | ❌ | not in the autonomous surface at all |

**On reusing the confirmation model:** the interactive write-confirmation broker is a *human in
the loop* mechanism (UI modal, 5-minute freshness). Autonomous runs have no human present, so
the honest options are (a) no writes at all, or (b) a distinct policy class (e.g., pre-authorized
whitelisted mutations with per-run budgets and after-the-fact receipts). v1 chooses (a); (b) is
Phase H and must not silently weaken the interactive model.

### 6.3 "Should I act?" as a first-class decision

A wake producing **no user-visible action is a successful, expected outcome** — recorded as
`completed / no-op` with items-examined counts, not as a failure. The decision inputs
(relevance, importance, confidence, urgency, recency, novelty, notification cost) are **proposed
by the model as the structured 1–3 importance/confidence fields plus evidence refs, and decided
by code** (thresholds, cooldowns, fingerprint dedup). This split keeps hallucination-prone
judgment away from the trigger and keeps every suppression explainable ("suppressed: below
importance threshold", "suppressed: duplicate of event sent 6 h ago").

### 6.4 Evidence-based proactivity (the cat-food test)

```text
Evidence (memory pack: "user bought cat food ~1 week ago",
          "cat food lasts ~1 week", no newer purchase observation)
   ▼
Observed facts (tool results, attributed, timestamped)
   ▼
Inference (model proposes: "cat food may be running out", confidence 2)
   ▼
Confidence + importance gate (code): passes only if routine permissions include
   the relevant memory scope AND policy thresholds are met
   ▼
Action: one event in the inbox (and one push only if thresholds allow)
```

The inference never becomes a durable "fact": it lives in the event and its evidence refs. If
the user confirms it, the *user's* reply (in the normal memory flow) creates the durable
record. Autonomous runs may additionally propose `MICRO_OBSERVATION` records (see §11) —
explicitly labeled observations, never promotions.

---

## 7. Scheduling model

### 7.1 Recommendation: hybrid heartbeat + Durable Object alarms

- **One Cron Trigger** (`0 * * * *`, hourly — or `*/15 * * * *` if sub-hour intervals matter)
  acts as the **heartbeat/repair sweep**: `scheduled()` does nothing but call
  `AUTONOMY_ENGINE.heartbeat()`. Sub-millisecond CPU; 24–96 invocations/day.
- **The DO computes exact due times** for all routines (in each routine's timezone) and sets its
  single alarm to the next due moment. `alarm()` fires the due run(s), then re-arms.
- The hourly heartbeat **repairs** anything the alarm missed (failed deploys, evicted state,
  alarm bugs): it recomputes dues, marks `missed` (or catch-up-runs per policy), and re-arms the
  alarm. This dual mechanism covers both "exact schedule" and "self-healing."

### 7.2 Why this beats the alternatives

| Option | Verdict |
|---|---|
| One frequent heartbeat + due-check only (no alarms) | Workable, but minute-precision requires 1-minute crons (1 440 invocations/day — still fine, yet coarser semantics) and correctness depends entirely on the sweep. **Alarms give precision + built-in 6-attempt retry for free.** |
| Multiple infrastructure crons (morning/afternoon/evening) | Burns the 5-trigger Free budget, hard-codes user timezones into infrastructure (cron is UTC-only), and still can't express "weekdays 13:00 in Europe/Berlin" without per-user triggers. **Rejected.** |
| Queue-driven scheduling | Queues don't schedule; they deliver. Useful later for execution isolation; not a scheduler. |
| DO-only exact scheduling (no cron) | Fragile to missed alarms with no repair sweep; the cron heartbeat is nearly free insurance. |
| **Hybrid (recommended)** | One trigger, exact firing, self-healing, free-tier trivial. |

### 7.3 Schedule semantics (precise definitions)

- **`daily` schedules are wall-clock** in the routine's IANA timezone. Evaluation: compute the
  next local wall-clock occurrence, convert to UTC via `Intl`-based offset computation
  (no third-party cron parser needed — our schedule kinds are `daily` and `interval` only).
  - DST spring-forward gap (e.g., 02:30 nonexistent): fire at the first valid local time after
    the gap (03:00).
  - DST fall-back ambiguity: fire at the **first** occurrence.
- **`interval` schedules are elapsed-time** anchored at routine creation (and re-anchored on
  each run): "every 3 h" is 3 h of real time, DST-independent. Optional `between` window
  suppresses firings outside local waking hours.
- **Due window:** a routine is due when `now ≥ nextRunAt`. Grace window for *catch-up* =
  `min(half the interval, 6 h)` for intervals; for daily = until the next scheduled occurrence.
  Beyond grace → record `missed` (or run per `catchUp` policy if within 6 h).
- **Overlap:** while a run for routine R is `pending`/`running`, a new due for R records
  `skipped-overlap` (the DO's single-threaded execution makes the check-and-set atomic; the
  Workflow instance-per-runKey makes duplicate starts impossible).
- **Timezone source of truth:** the app captures the device timezone at authoring; the worker
  evaluates against it. A "timezone updated" hint in the UI if the device tz diverges.

### 7.4 Gate resolution: hand-rolled DO scheduler vs the Cloudflare Agents SDK

This resolves open question Q3, which the owner correctly identified as the most important
architectural question in the report. The comparison below is based on the current official
Agents SDK documentation, the `agents` package manifest (v0.22.0), the Agents SDK repository,
and the Durable Objects alarms documentation — not on priors.

#### What the Agents SDK actually is (2026-09 evidence)

- **Layer stack:** `DurableObject` → `Server` (partyserver) → `Agent`. The `Agent` class adds:
  automatic state persistence + client sync (`cf_agents_state`), WebSocket RPC via `@callable()`
  decorators, a built-in task queue (`cf_agents_queues`), **the scheduling machinery
  (`cf_agents_schedules`: delayed / `Date` / cron / `scheduleEvery` interval modes, persisted to
  SQLite and multiplexed through the DO's single alarm)**, a multi-server MCP client, inbound
  email handling, sub-agents, sessions/lifecycle capabilities, and AI-scheduling prompt helpers.
- **Scheduling semantics (genuinely good):** schedules survive eviction; cron and interval
  registration are idempotent (same expression + callback + payload ⇒ same schedule, safe to
  call in `onStart()`); interval mode has built-in overlap-skip; `listSchedules()` filters by
  type/time-range; `cancelSchedule()`; one-shot schedules self-delete; cron schedules
  self-reschedule; `destroy()` is safe from callbacks.
- **Runtime dependency footprint (from the package manifest):** `esbuild`,
  `@babel/plugin-proposal-decorators`, `@rolldown/plugin-babel`, `capnweb` (Cap'n Proto WS RPC),
  `cron-schedule`, `mimetext` (email), `nanoid`, `partysocket`, `yaml`, `@cfworker/json-schema`.
  Optional peer dependencies reach further (AI SDKs, React, Vite plugin, `agents/tsconfig`).
- **Maturity:** v0.22.0, **647 published versions**, pre-1.0 with no semver stability contract;
  active restructuring in the current release window (sessions → lifecycle capability;
  `McpAgent` already deprecated/feature-frozen); the SDK's center of gravity is visibly the
  AI-agent *harness* space (Think, Code Mode, payments, voice), not minimalist scheduling
  infrastructure. No minimal leaf scheduling package exists in the monorepo.
- **Testing:** the official story is Vitest + `@cloudflare/vitest-plugin` — **identical tooling
  to what hand-rolled DO testing requires.** Testing is a wash.

#### The decisive observation

The SDK can do more scheduling semantics than we need — but adopting the whole Agent runtime
does not buy us enough to justify making it Elara's scheduling or domain abstraction. The base
`Agent`'s cron mode evaluates in **UTC** (the SDK README's own example annotates
`this.schedule("0 9 * * *", …)` as "Daily at 9am UTC"); the tz-aware scheduled-task DSL lives in
the **Think harness** (`getScheduledTasks()`), a full opinionated chat-agent framework, and
Workflow creation from schedules sits on top of that same runtime. Whichever layer we touched,
per-routine IANA-timezone wall-clock semantics, DST gap/ambiguity rules, grace windows,
catch-up policy, missed-run repair, and `runKey` idempotency remain **domain logic we must own
in both designs** — an SDK scheduler would sit *underneath* Elara's scheduling truth, not
replace it. Our due-time computation produces exact `Date` instances — at which point the SDK's
cron parser, interval machinery, and idempotent-cron registration are all unused, and what
remains is a durable one-shot-timer store with list/cancel.

#### Benchmark

| Criterion | Hand-rolled (`SchedulerPort` over raw DO) | Agents SDK (`Agent` subclass) |
|---|---|---|
| Covers our hard part (tz wall-clock, DST, catch-up, missed-run repair, runKey idempotency) | ✅ ours either way | ❌ ours either way |
| Durable one-shot `Date` scheduling + alarm multiplexing | ~150 lines; Cloudflare's alarms doc publishes the canonical pattern | ✅ provided, battle-tested |
| Idempotent schedule registration | ~10 lines (natural key `routineId`) | ✅ built in (cron/interval modes) |
| Execution dispatch model | Scheduler → **Workflow(runKey)** separation is native (owner's "keep Workflows subordinate" requirement) | Schedules dispatch **Agent methods by name + payload** — execution entry becomes a framework class method; the workflow separation must be bridged around the SDK's dispatch |
| Persistence schema ownership | One schema, one owner: our SQLite tables, our migrations, no external table (`cf_agents_schedules`) living beside our domain tables with its own upgrade lifecycle | SDK owns its internal tables; 0.x upgrades may migrate them; autonomy state inherits framework-upgrade risk |
| Dependency surface | **zero new runtime dependencies** (repo currently has 8, deliberately chosen) | ~10 runtime deps incl. esbuild, Babel plugins, Cap'n Proto RPC, email, YAML — used for ~5% of the package's surface; would become the heaviest dependency in the project |
| Version churn exposure | none | 647 versions, pre-1.0, restructuring in flight; version pinning + upgrade review become a standing maintenance task |
| Repo rule conformance | ✅ "Worker must not become a second application runtime"; "no framework-specific architecture solely to satisfy a tool"; no `Manager`-style gravity | ⚠️ The SDK *wants to be* the agent runtime (state sync, WS RPC, queue, MCP, email). Elara already has an agent runtime — the Gemini tool loop and the authority architecture. Unused Agent surface is inert but is standing temptation + dependency weight |
| Blast radius if wrong | We own ~150 lines of bugs (mitigated: CF's canonical pattern, alarm at-least-once semantics, dedicated tests, hourly heartbeat repair sweep — which we must build in *both* designs, since the SDK provides no repair sweep) | Cloudflare owns the bugs — but also the breaking changes |
| Live WS state sync into Settings UI (future maybe) | not included (could add later) | ✅ included (irrelevant to v1; the app polls events on open by design) |
| In-DO task queue with retries | not included (redundant: Workflows own execution durability — a second queue would compete with the Workflow engine) | ✅ `this.queue()` (redundant for us) |
| Bundle size | negligible | not a blocker (64 MiB limit) but unclean — build-tool packages in the worker dependency tree |
| Testing cost | contract tests for SchedulerPort (we write these in both designs for the sweep + dedup) | same tooling (`@cloudflare/vitest-plugin`) |
| Swap cost if we change our mind later | low — `SchedulerPort` interface (§4.4); SDK could implement the port internally | low — same port in reverse |

#### Verdict

**Hand-rolled `SchedulerPort` — adopt the SDK's proven *semantics*, not the package.** The
implementation copies the SDK's design (single-alarm multiplexer over a schedules table,
idempotent registration by natural key, one-shot delete-after-fire, overlap-skip), which is
itself the pattern Cloudflare's own DO alarms documentation publishes as canonical
([alarms docs](https://developers.cloudflare.com/durable-objects/api/alarms/) — "Scheduling
multiple events with a single alarm"). Combined with the platform guarantees — alarms are
**at-least-once with exponential backoff from 2 s and up to 6 automatic retries**, and only one
`alarm()` instance runs at a time per DO — the hand-rolled surface is ~150 lines with
platform-grade reliability underneath, while keeping our scheduling truth (timezone/DST/catch-up)
in pure shared code and our execution in Workflows.

The framework-gravity concern is real but is *not* the deciding factor (we are already
Cloudflare-committed via DO + Workflows + cron). The deciding factors are: (1) the SDK does not
cover the hard 60% of our scheduling problem, (2) its dispatch and persistence models fight the
owner's explicit "Workflows subordinate to the scheduler" requirement, and (3) a pre-1.0
package at 647 versions of churn would become our largest dependency for a wristwatch.

**Revisit triggers (concrete, not diplomatic):** adopt (or wrap) the Agents SDK behind
`SchedulerPort` if any of these occur — (a) Cloudflare ships a minimal standalone
scheduling/storage leaf package, or `agents` reaches 1.0 with a stable, dependency-light
scheduling module; (b) Elara wants live WebSocket state sync from the worker into the app UI
(a Settings "live run progress" surface); (c) a future MCP-client capability requirement makes
the SDK's surface relevant rather than incidental. None of these is on the v1 roadmap.

---

## 8. Data and credential boundary

### 8.1 What leaves the device (explicit, consented, minimal)

| Data | Direction | Consent | Notes |
|---|---|---|---|
| Routine definitions (name, schedule, tz, instruction, permissions, policy) | app → worker | autonomy activation + each routine save | the worker's copy is a **disposable mirror**; the app remains the source of truth |
| Autonomy config (master switch, defaults, notification prefs) | app → worker | autonomy activation | config carries a **generation counter**; mid-run disables are detected between workflow steps |
| **Memory pack** — formally the **Autonomy Context** (§8.5), a bounded read-only projection | app → worker | **separate opt-in per memory record** (explicit `autonomyContext` consent flag) | ≤ 100 KB / ≤ 200 records / only `active`-lifecycle, non-expired, non-observation memories the user explicitly marked; rebuilt on app open and on routine save; the user can inspect exactly what's in it before it syncs |
| Conversation summaries | app → worker | OFF by default | device routines use live local context instead; cloud routines only if explicitly enabled (future) |
| Push subscription (endpoint + keys) | app → worker | notification permission | standard Web Push data |
| Installation token | app (Lockbox/localStorage) ↔ worker (secret) | pairing | see §10 |
| Events, run records | worker → app | implied | pulled on app open / after push; mirrored into Dexie; worker retains bounded history (90 d / 500 events) |

**What never leaves:** full conversation transcripts, Google OAuth tokens of any kind, the
Gemini Lockbox key, artifact blobs, memory records outside the pack scope.

**Local-first invariant preserved:** deleting the worker deployment destroys only the mirror;
the app loses cloud scheduling, not data. The autonomy UI must state this plainly.

### 8.2 Where the worker gets what it needs

- **Routine config:** the synced mirror in DO SQLite (above).
- **Gemini credential:** the user's own `GEMINI_API_KEY` secret on their worker deployment.
- **Web provider credential:** worker secret (e.g., `EXA_API_KEY`), optional.
- **Google credentials:** **none in the cloud** (until §8.4, if ever).

### 8.3 Offline/browser-closed behavior

- Cloud routines: unaffected — that's the point.
- Device routines: due nudge pushes at schedule time ("Task review is due — open Elara");
  execution at next app open via **catch-up** (the app asks the worker "what device routines
  are due/unrun within grace?" and executes them locally, posting run records back). If the
  app is open at due time, it may execute live.

### 8.4 The autonomy-grant question (deferred, deliberately)

Full cloud execution of Google-backed routines requires an **authorization-code OAuth flow with
server-held refresh tokens** — a second, separately-consented authority. The GIS implicit flow
cannot issue refresh tokens at all. The repo's own handoff already names this the "correct
foundation … when Elara needs durable server-side offline execution while the user is absent,"
and equally already retired one attempt at a Worker OAuth boundary.

**Recommendation: do not build this now.** When it is eventually built it must be:
- a distinct consent surface ("Grant Elara's worker offline access to *these* capabilities"),
- narrowest scopes (read-only first), stored encrypted in the DO, revocable from both app and
  worker dashboard, with restricted-scope Gmail caveats (verification/security-assessment
  implications) documented. It is a Phase H project with its own design review.

#### 8.4.1 Decision record (gate 3 resolution, 2026-09-08)

**DECISION: Device-native Google routines now. Server-side offline Google OAuth (refresh-token
custody) is deferred to a separate security project with its own design review. It is not part
of any current phase.**

**Rationale:**
1. The GIS implicit flow *cannot* issue refresh tokens — cloud Google access is not a missing
   implementation detail but a fundamentally different authorization architecture.
2. Refresh-token custody materially changes the threat model: a long-lived server-side secret
   at rest in a Worker/DO whose exfiltration value far exceeds a 1-hour access token. It
   demands encryption-at-rest with keys unavailable to the request path, rotation, revocation
   UX, and an audit trail — a security project, not a feature.
3. Google release requirements compound this: restricted scopes (Gmail) can require
   verification and, for server-side restricted-data use, a security assessment (documented in
   `docs/oauth/README.md` §18).
4. The repository deliberately **retired** a Worker OAuth boundary once; re-introducing one
   must be a positive, reviewed decision — never a side effect of adding scheduling.
5. The two-loci model delivers the near-term product without it.

**Criteria that would trigger revisiting (any one):**
- usage shows the app-open catch-up pattern misses real user behavior (user rarely opens the
  app; nudges go unread);
- a flagship Google-backed *cloud* routine is demonstrably blocked by device-nativeness;
- the project is ready to own a second authorization authority as described above.

**Requirements when eventually built (Phase H+, own review):** authorization-code flow;
read-only scopes first; tokens encrypted at rest (key-management design is that review's
central question); a separate consent surface with per-capability grants mirroring the existing
registry; revocation paths from the app, the Cloudflare dashboard, *and* the Google account
page; an audit log of every server-side token use; restricted-scope caveats documented. The
existing browser authority remains untouched — server grants are additive capabilities, never
a replacement.

**Interim guard (enforced in code and CI, not by convention):** the worker receives no Google
credentials and no Google-sourced data; device-routine nudges carry only routine name and time;
`permissions.google` non-empty ⇒ `executionLocus === 'device'`.

### 8.5 Autonomy Context — full specification (gate 2 resolution)

The **Autonomy Context** is the single, explicit, user-curated answer to one question:

> *What has the user explicitly allowed Elara to know while she's away?*

It is deliberately **not** an attempt to replicate Elara's local memory in the cloud. The
distinction is the product feature: the user curates what travels; the worker reasons only
over that; everything else stays local. (This resolves the "autonomous memory isn't identical
to local memory anymore" tension by making the difference *the point*.)

#### Eligibility (all must hold — verified by a pure, shared, unit-tested projection)

- `lifecycle === 'active'` (dormant/archived never travel);
- `kind ∈ { CORE, CONTEXTUAL, EPISODIC }` — **`MICRO_OBSERVATION` is excluded**: unconsolidated
  observations are numerous, low-lifecycle evidence, and exporting them would let autonomous
  inference feed on unconfirmed inference (the §6.4 anti-hallucination rule applied to data
  movement);
- not expired (`expiresAt` null or future);
- **`autonomyContext === true`** — a new explicit per-memory consent flag (Dexie v8 schema
  addition). Default `false`. No automatic inference ever includes a memory. The Memory Bank
  UI offers bulk actions (include/exclude a whole folder or tag) for convenience, and the
  Autonomy Context surface may *suggest* candidates ("this looks like a recurring task —
  include it?") — suggestions never auto-include.

#### Projection

- Record shape (minimal, no relationship graphs, no folder metadata, no conversation ids):
  `{ id, kind, title, body, tags, importance, confidence, observedAt, updatedAt }`.
- Budgets: **≤ 200 records, ≤ 100 KB serialized**. When over budget, rank by the existing
  retrieval scorer (query-less: importance/confidence/recency) and truncate deterministically
  (stable sort by score then id) so the projection's `contentHash` is stable across rebuilds.
- Built by `buildAutonomyContext(memories)` — a pure function in shared code, exported so the
  worker re-validates on receipt (zod: shape, count, byte size) rather than trusting the client.

#### Sync lifecycle

| Event | Behavior |
|---|---|
| App open | rebuild; sync only if `contentHash` differs from the worker's stored pack |
| Routine save / autonomy settings change | rebuild + sync (a routine's permissions may change what's relevant) |
| Manual **[Refresh]** | rebuild + sync, report stats back to the UI |
| Manual **[Clear]** | authenticated call wipes the worker-side pack immediately |
| Memory edited/deleted locally | removed at the next sync (atomic replace-all; the worker never retains prior pack versions) |

- **Atomic swap:** the worker replaces the entire pack in one transaction and bumps the config
  generation (mid-run disables and pack swaps are both generation-checked between workflow
  steps).
- **Staleness:** the worker stores `syncedAt` + `contentHash`; every run record stores the pack
  `contentHash` it used, so every event can honestly say "based on context synced *N* hours
  ago." Beyond a staleness threshold (default 14 days), cloud routines that depend on memory
  show a stale-context banner in the UI — deliberately **not** a notification.
- **Degradation:** a routine with `memoryPack` permission running with a cleared/empty pack
  runs *degraded* (a note in the run record: "autonomy context unavailable") rather than
  failing.
- **Citations:** evidence refs retain `memoryId + title + ≤ 200-char excerpt` in the event
  record — the same property as an email you already received: deleting a memory removes it
  from *future* context; past events keep their bounded citations until the event itself is
  deleted. This is stated plainly in the UI.

#### Worker-side invariants (enforced in code)

The pack is **read-only input**: never written to logs or diagnostics; never echoed back to
the app (hash/stats only); never included in push payloads; `memory.search` results cite ids
that map to evidence refs; the worker never derives new pack content.

#### Settings UI (the owner's card, adopted verbatim in spirit)

```text
Autonomy Context

These memories may be available during scheduled execution:

  ✓ preferences        ✓ recurring tasks
  ✓ long-running projects   ✓ user-defined interests

  127 records · 41 KB of 100 KB
  Last synced: 14:02 · version a3f9c2

  [ Inspect ]  [ Refresh ]  [ Clear ]
```

Category groupings are a *display* projection over tags — not a second consent mechanism;
consent is the per-memory flag. [Inspect] shows the exact records (title, kind, size, last
updated) that would travel, before and after sync.

---

## 9. Notification model

### 9.1 Channel architecture

```text
AutonomousEvent ──► delivery policy (code) ──► adapters
                                                ├─ inbox   (always; events sync to app)
                                                ├─ push    (Web Push / VAPID)
                                                ├─ (future) telegram / discord / email / webhook
```

The core emits `deliver(event, channel)`; adapters own transport. **v1 ships inbox + Web Push
only.** Telegram/Discord are one-adapter additions later (each is a fetch in a workflow step)
but add external-mutation surface, so they wait.

### 9.2 Web Push findings (current platform reality)

- **Standards:** VAPID + Push API + service worker; payload limit **4 096 bytes** of encrypted
  payload body (~3 993 bytes plaintext) — enough for a notification envelope, not content
  ([web.dev push protocol](https://web.dev/articles/push-notifications-web-push-protocol);
  [RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291)).
- **Delivery semantics:** `404/410` from the push service = subscription gone → delete it, wait
  for the app to resubscribe; `429` = rate limit with `Retry-After`; TTL controls how long the
  service retains undelivered messages.
- **Android:** mature; installed PWAs (WebAPK) receive push with the app closed. Non-installed
  sites can receive push but install is the reliable path.
- **iOS 16.4+:** push works **only for home-screen-installed PWAs**; **no silent push** — every
  push must show a visible notification. Safari 18.4 adds Declarative Web Push. The design never
  depends on silent push, so iOS is degraded-but-correct (nudge + open-to-run).
- **Subscription persistence:** subscriptions are tied to the SW registration and can be
  expired/revoked by the browser or user; `pushsubscriptionchange` renewal is unreliable across
  browsers → the app re-registers on every open (idempotent upsert by endpoint), and the
  delivery ledger tolerates failed pushes (the inbox is the durable channel; push is a
  best-effort accelerator).
- **Sending from Workers:** feasible with Web Crypto (ECDH/ES256 JWT + AES128GCM per RFC 8291);
  Node's `web-push` library is not Worker-compatible as-is; either a small Worker-native
  implementation or a maintained Workers-compatible port. This is a known, bounded piece of work
  (one module + tests), not a risk.

**Payload policy (security):** push services are third parties. Push payloads carry **only** the
notification title, a short generic summary, and the event id — never memory content, never
credentials, never full event bodies. The app fetches the full event over the authenticated
API when opened.

### 9.3 Inbox: where autonomous messages live

A **dedicated Autonomy inbox surface** (sidebar entry with unread badge), not a chat thread:
events are cards (title, summary, importance, evidence expander, run link), tappable into a
detail view where the user can *reply in chat* if they want to act ("start a conversation about
this event" seeds a normal thread with an excerpt). This keeps autonomous output out of ordinary
conversations (no pollution) while preserving a natural path to interaction. The "dedicated
autonomous thread" alternative was considered and rejected as conflating two interaction models.

---

## 10. Authentication & security design

### 10.1 Wake-path authentication

**There is no public wake endpoint.** The cron trigger and the execution runtime share one
Worker and communicate through bindings (`scheduled()` → DO). Nothing outside the user's
Cloudflare account can trigger a wake. This is strictly stronger than an authenticated
`POST /wake` and eliminates replay concerns for the scheduling path entirely. (If a future split
ever introduces a network wake hop, it must be HMAC-SHA256 over method+path+timestamp+body with
a ±5 min window and a nonce ledger in the DO.)

### 10.2 App ↔ worker authentication (per-installation)

- **Pairing:** the user deploys the Worker and sets an installation secret
  (`wrangler secret put ELARA_INSTALLATION_TOKEN`, generated by the app and shown once during
  pairing, or generated by the user). The app proves possession via `POST /autonomy/pair`,
  which returns `installationId`, worker version, and a capability manifest (which tool
  families the deployment supports). The token is stored app-side behind the existing Lockbox
  pattern (or localStorage with the same care as other client-held credentials — it is a
  client credential by design, scoped to one worker deployment).
- **Reads:** `Authorization: Bearer <token>` + origin allowlist.
- **Writes (config sync, push registration):** HMAC-SHA256 signature over
  `method + path + timestamp + body` using the token, ±5-minute timestamp window; a nonce/
  last-seen-timestamp ledger in the DO provides strict replay rejection (cheap in DO SQLite).
- **Rotation:** the token is a normal Cloudflare secret — rotating it re-pairs the app;
  the design supports dual-token acceptance windows if rotation friction ever matters (v1: no).
- **Version compatibility:** `/autonomy/pair` returns a capability manifest + schema version;
  the app refuses to enable autonomy on version mismatch and says so plainly.

### 10.3 Multi-user / isolation model

One installation = one user = one Worker deployment = one DO namespace instance keyed by
`installationId`. Cross-user data access is structurally impossible in the self-hosted model
(no shared service exists). The DO is keyed by installation ID from day one so that even a
hypothetical shared deployment would isolate per installation. The alternative "shared central
backend" was rejected: privacy, cost, and security all point the wrong way for this project.

### 10.4 Threat review (adversarial pass)

| Threat | Vector | Mitigation |
|---|---|---|
| Unauthorized wake | public internet | no public wake endpoint exists (§10.1) |
| Replay of app↔worker writes | captured request | HMAC + timestamp window + nonce ledger |
| **Prompt injection from web content** | `web.fetch`/`web.search` results read by the autonomous agent | untrusted-content framing in the loop's context assembly (content is quoted data, never instructions); tool allow-list per routine is enforced in code so injection cannot expand authority; terminal output must parse as the structured `RoutineOutcome` — injected prose cannot become an action; **no comms/send tools exist in the cloud surface**; importance/confidence are re-gated by code; event summaries are rendered as data (existing Markdown boundary), and notifications carry only derived titles |
| Prompt injection from email/calendar/tasks (future) | device routines reading Google content | same ladder: external data is evidence; device runs are read-only; the interactive confirmation broker still guards every mutation |
| Malicious artifact content | generated artifacts | artifacts are inert payloads attached to events; rendered through the existing safe Markdown/PDF boundaries; never executed |
| SSRF via `web.fetch` | attacker-chosen URLs | https-only, DNS-resolved IP blocked for private/link-local ranges, response size cap, content-type allow-list, text extraction only, per-run fetch budget |
| Runaway agent (cost/loop) | model loops tool calls | hard `maxToolCalls` (20), workflow step caps, per-day run/tool/web budgets in DO counters, absolute run timeout |
| Notification abuse / spam | buggy or injected importance | deterministic caps + cooldowns + fingerprint dedup; push is best-effort; inbox retention bounded |
| Credential leakage | logs/diagnostics/events | existing diagnostics rules (no secrets/content) extended to run records; push payloads minimized; memory pack is read-only server-side and never echoed into logs |
| Cross-user access | — | structural isolation (§10.3) |
| Stale permissions | user revokes Google / disables autonomy | config generation checks between workflow steps; device runs re-check capabilities per call (existing executor behavior); repeated authorization-needed → routine `paused-needs-consent` |

---

## 11. Memory & evidence model

- **Routines read memory** via (a) the **Autonomy Context** (cloud routines): the bounded,
  explicitly consented, inspectable read-only projection specified in §8.5, synced to the DO;
  and (b) **live local retrieval** (device routines). *(A1 implements (b) as a DEDICATED path,
  `loadLocalRoutineMemoryContext` — not the chat thread's folder-scoped `loadMemoryContext`:
  routine runs retrieve global-scope durable memories only (no thread/folder scoping exists
  for a non-interactive run), ranked against the routine name+instruction, bounded to 8 items /
  6 000 characters, and only when the routine holds the memory permission. Retrieval also
  updates memory recall telemetry (`recallCount`/`lastRecalledAt`) as a side effect, like chat.
  Path (a) arrives with cloud execution: the worker receives the §8.5 payload via
  `RoutineRunOptions.memoryContext` and must never import or call the local memory store.)*
- **`memory.search`** is a read-only tool over the pack (ranked, budgeted) so the agent can
  cross-reference ("did the user already discuss this task?") rather than receiving one static
  context block. The static block (top-ranked, ~4 KB) is also provided as grounding.
- **Attribution:** pack entries carry their existing provenance; every memory used as evidence
  is referenced by id in the event's `evidence` array — the user can see *which memory*
  supported an inference. *(A1 status: `evidence` entries are **model-reported**, not
  independently verified — the runner keeps no execution ledger to cross-check citations, so a
  cited tool or memory may not have actually run or existed. Full provenance verification is a
  later-phase enhancement; until then the inbox presents evidence as "reported by Elara".)*
- **Autonomous observations:** a cloud run may propose at most a handful of `MICRO_OBSERVATION`
  records (provenance `source: 'elara'`, note: `autonomous`, linked to the runKey). They enter
  the existing observation lifecycle — **they are never auto-promoted to established memories**
  and they respect the existing memory permission architecture. Inferences do not become
  durable facts; only user-confirmed consolidation does (§6.4).
- **Decay/dedup interplay:** the novelty fingerprint uses recent event history (worker-side)
  plus, for device routines, the local event mirror — so "don't tell me what you told me
  yesterday" works across loci because both read the same synced event log.
- **Existing memory system is not modified** by this design beyond a new *producer* of
  observation proposals and a new *export* (the pack), both behind existing boundaries.

---

## 12. Failure & idempotency model

**Idempotency spine: `runKey = routineId:scheduledForEpoch`.**
- The DO creates at most one run record per runKey (single-threaded check-and-set).
- The Workflow instance id *is* the runKey: duplicate starts return the existing instance.
- Event ids are content-derived (fingerprint) + runKey-derived; the delivery ledger records
  per-channel delivery state, making redelivery decisions deterministic.
- Push sends are idempotent per (eventId, channel) via the ledger.

**Failure matrix:**

| Failure | Behavior |
|---|---|
| Cron wake fails / missed | next hourly heartbeat sweep recomputes; runs within grace execute (or `catchUp` policy), beyond grace record `missed`; DO alarms retry up to 6× automatically |
| Worker unreachable (deploy gap) | same as above once healthy; nothing is lost (state is durable) |
| Routine execution fails | workflow step retries (bounded, backoff); terminal failure → run record `failed` + structured errorCode; **no notification** for routine failures by default (a "routine keeps failing" event fires once after 3 consecutive failures, then silence) |
| Gemini fails | normalized provider error → run `failed` (same path); failure streak logic as above |
| Web provider fails | tool error returned to the loop; the run may still complete as `no-op` with a degraded-evidence note, or fail per error class |
| Notification fails | delivery record `failed`; inbox remains the durable channel; failed push subscriptions (404/410) are deleted; app re-registers on next open |
| Artifact creation fails (device runs) | event still delivered with inline text content; artifact is optional enrichment |
| Duplicate wake | runKey idempotency — nothing runs twice |
| Master switch off mid-run | config generation check between workflow steps → run `cancelled`; in-flight tool calls complete but no event is emitted |
| Google permission revoked | device runs return authorization-needed → routine flagged `paused-needs-consent` after repeated failures; a single inbox event tells the user |
| App unopened 30 days | cloud routines keep running; events accumulate within retention (90 d / 500); push subscription likely expired → inbox-only until next open; memory pack goes stale (staleness is shown in the UI) |
| Worker deleted | autonomy ends; app data intact (mirror is disposable) |

---

## 13. UI proposal

New Settings section **"Autonomy"** (between *Google* and *Chat*), mobile-first, following the
existing nav-list + detail-panel idiom. Progressive disclosure is enforced by the state machine:

**States:** `not-configured` → `configured-unverified` → `verified` → `active` ⇄ `disabled`;
plus `failed` (verification or runtime errors) with a specific reason.

**Before verification, only this is shown:**
- What this does (one honest paragraph: "Elara can wake on a schedule and work for you while
  the app is closed — searching the web, reviewing what you've allowed, and leaving results in
  your inbox. Everything runs in *your own* Cloudflare worker. Off by default.")
- Worker URL field + **[Verify]** button (calls `/autonomy/health` + `/autonomy/pair`)
- **[Open Cloudflare dashboard]** → deep link `https://dash.cloudflare.com/?to=/:account/workers-and-pages`
- **[Read the setup guide]** → `docs/AUTONOMOUS_ELARA.md`
- Real status (never a fake "connected"): worker reachable? pairing succeeded? version
  compatible? capability manifest?

**After verification, reveal:**
- **Autonomous Elara** master switch (what it means, in plain words: no autonomous work,
  notifications, or background reasoning while off; chat is unaffected)
- **Routines** list + create flow:
  - large NL editor ("What should Elara do?")
  - model-interpreted draft → **structured review card** (schedule chips, permission checkboxes
    — defaults drawn from the instruction, never silently granted; delivery; policy) → save
  - routine detail: schedule, permissions (with locus explanation), delivery, policy, history,
    **Run now** (manual test), pause/enable
- **Notifications**: inbox (always on), push enable (permission flow + install hint on iOS),
  quiet hours, importance threshold, daily cap
- **History**: recent runs across routines (state, outcome, duration, items examined) with a
  detail view showing the structured reasoning summary and evidence
- **Data & privacy**: exactly what syncs to the worker — the **Autonomy Context** card
  (§8.5: categories, record/size budget, last-synced version, [Inspect] [Refresh] [Clear]),
  retention numbers, "delete everything on the worker" action

Routine authoring never lets NL text silently expand permissions: the instruction is stored as
intent; the structured `permissions` object — reviewed by the user — is the only authority.

---

## 14. Documentation structure

- **`docs/AUTONOMOUS_ELARA.md`** — the authoritative document the Settings UI links to:
  what it is, architecture summary, Cloudflare setup (deploy, secrets, cron, pairing),
  data-movement table, security & privacy model, routine configuration guide, notification
  setup, limitations (iOS, free-tier cliffs), cost expectations, troubleshooting, and **how to
  disable everything**. One doc first, per repo convention; split into
  `docs/autonomy/{SETUP,SECURITY,DEVELOPER}.md` only when it exceeds comfortable length.
- Design-of-record: this document (`docs/AUTONOMOUS_ELARA_DESIGN.md`).
- `docs/future-implementation/README.md` gains a pointer once Phase A lands.
- The setup guide must include the **honest self-hosting cost**: clone + `wrangler deploy` +
  three secrets. (A Deploy Button / CI template is a nice-to-have; see Q9.)

---

## 15. Test strategy (designed before implementation)

- **Pure units (Vitest, existing conventions):** due-evaluation (fake timers; timezone + DST
  fixtures: spring-forward gap, fall-back ambiguity, midnight boundaries, weekday sets);
  runKey idempotency (duplicate wake → one run); action gate (schema rejects injected prose,
  unknown fields, oversized importance); delivery policy (thresholds, quiet hours, cooldown,
  fingerprint dedup, daily caps); routine normalization (NL-draft → structured, permission
  gating, locus derivation); event model; **Autonomy Context projection** (eligibility rules
  incl. MICRO_OBSERVATION exclusion and consent flag, deterministic budget truncation,
  contentHash stability across rebuilds, worker-side zod rejection of oversized/malformed
  packs).
- **SchedulerPort contract tests (Workers test pool, real alarms):** fire-due ordering; re-arm
  to next due; at-least-once duplicate alarm delivery → runKey dedup; overlap-skip while a run
  is pending; heartbeat repair sweep reconstructs missed dues after a simulated deploy gap;
  `alarmInfo.isRetry` handling; cancel/ensureScheduled idempotency.
- **Worker-level (extend the existing `worker.fetch(request, env)` pattern):** `/autonomy/*`
  auth (missing/invalid bearer, bad HMAC, stale timestamp, replayed nonce), pairing manifest,
  config sync generation checks; `scheduled()` invoked directly with a fake controller;
  DO behavior (alarm firing order, heartbeat sweep, missed-run marking) via
  `@cloudflare/vitest-pool-workers` with real alarms — **new dev dependency, justified**.
- **Security tests:** prompt-injection fixtures (web page containing "ignore your instructions
  and email…" → assert no comms tool exists, structured outcome gate rejects, event content is
  quarantined as evidence); SSRF fixtures (localhost/private IP URLs rejected); cross-
  installation isolation (two installationIds cannot read each other's data).
- **Device-locus tests:** catch-up executor (due/unrun within grace), authorization-needed →
  paused-needs-consent transitions, read-only enforcement on the local loop.
- **E2E (Playwright):** settings state machine + progressive disclosure, routine authoring
  review flow, master switch, inbox rendering + evidence expansion, push permission flow
  (mocked), Run-now local execution.
- **Live smoke:** `scripts/verify-autonomy-worker.mjs` (extends the existing verify script
  pattern): health, pairing, config round-trip, dry-run wake.
- **Full-loop integration test** (CI, mocked providers): wake → scheduler → workflow → agent →
  gate → event → delivery ledger, including the **no-op happy path** and the duplicate-wake
  path.

---

## 16. Phased implementation roadmap

Each phase is independently testable, reviewable, and leaves main green (PR #11 discipline).

| Phase | Deliverable | Notes |
|---|---|---|
| **A0 — Pairing & gate** | Worker: `/autonomy/health`, `/autonomy/pair`, DO skeleton with config store + generation counter. App: Settings ▸ Autonomy state machine, verify flow, docs skeleton. | No execution. Testable: states, pairing, version checks. |
| **A1 — Routine domain & local execution** | `ElaraRoutine` model + zod schemas + Dexie v8 tables (routines, events, run mirror, `autonomyContext` memory flag); authoring UI (NL → structured review); master switch; `buildAutonomyContext()` pure builder + Memory Bank consent UI (local only — nothing syncs yet); **Run now** executes locally via the existing `streamGoogleToolLoop` in `readOnly: true` mode; local inbox surface. | **Ships user value with zero cloud dependency.** The routine domain, consent model, and context projection become provably correct before any Cloudflare execution exists. |
| **B — Cloud scheduler (dry-run)** | Hand-rolled `SchedulerPort` per §7.4 (schedules table + single-alarm multiplexer + repair sweep) behind the `WakeSource` port of §4.4; cron trigger; heartbeat; run records; dry-run mode records `skipped-dry-run`; Autonomy Context sync (client push + worker validation). | Testable: due math, alarms, sweeps, missed runs, pack sync/validation — all observable in history. The Agents SDK is explicitly *not* adopted (§7.4, revisit triggers listed). |
| **C — Cloud execution engine** | Server agent loop (parameterized extraction of the existing loop); workflow-per-run with runKey instance ids; web tools + Autonomy Context; structured outcome gate; no-op semantics; event pull + inbox sync. | The full cloud loop, mocked providers in CI, live smoke optional. |
| **D — Notifications & anti-stalker policy** | Web Push (VAPID module, SW push handler, click-through), delivery ledger, quiet hours, cooldowns, caps, fingerprint dedup. | Inbox was already durable; push is the accelerator. |
| **E — Web capability hardening** | Exa adapter (primary) + Tavily adapter (documented alternative) behind `web.search`/`web.fetch`; SSRF controls; provider settings; optional exposure of web tools to interactive chat. | Can start in parallel with B/C (it benefits chat independently). |
| **F — Device-native routines** | Due-nudge push, app-open catch-up executor, authorization-needed semantics, `paused-needs-consent`. | Completes the two-loci story. |
| **G — Evidence & memory intelligence** | Memory-pack curation UI + inspector, autonomous observation proposals, evidence display polish. | |
| **H — (separate decision)** | Autonomy grants (server-side Google credentials via authorization code); autonomous write-class actions with a distinct policy class; MCP exposure of the capability surface. | Each requires its own design review; explicitly out of scope now. |

**Complexity estimate:** A0–D ≈ 5–7 PRs of moderate size (comparable individually to single
passes of PR #11, not the whole PR); E–G ≈ 3–4 more. The critical path (A0–D + F) delivers the
full two-loci product.

#### Implementation status — A0/A1 as landed (2026-09-09, PR #12)

The first implementation slice deliberately tightened the A0/A1 rows above (owner greenlight:
"zero-cloud product loop first"). What EXISTS today:

- The full local routine domain (`src/autonomy/contracts.ts`), tz/DST due-time computation
  (`schedule.ts`), deterministic admission policy (`policy.ts`), structured outcome gate
  (`outcome.ts`), authority gate (`authority.ts`), run instruction (`instruction.ts`), and the
  scheduler-agnostic run executor with atomic run admission (`runner.ts`).
- Persistence in a **dedicated `elara-autonomy` Dexie database** (the repo's per-concern DB
  convention, cf. the roleplay world store) — routines, events, run history with retention.
- Local **Run Now** (`executionMode: 'manual'`) through `streamGoogleToolLoop` in read-only,
  headless mode; the Autonomy Inbox and run history in Settings ▸ Autonomy; autonomy
  preferences (master switch, default OFF) in the preferences store.
- `scheduled`/`catch-up` exist as domain execution modes with occurrence-derived run identity
  (`routineRunKey`, `RoutineRunOptions.scheduledFor`) — **no scheduler exists yet**.

Hardening-pass invariants (2026-09-09, second commit): read-only tool admission is
registry-authoritative (descriptor `risk === 'read'` AND declared — checked at declaration and
call time; no namespace or handler-map conventions), and is composition-tested against
`routineToolSet` for every grantable capability; run admission handles at-least-once
redelivery (terminal duplicate → idempotent return, fresh running duplicate → refused, stale
crashed duplicate → abandoned with a `#abandoned-<id>` tombstone key and the occurrence
reclaimed); an admitted event and its terminal run record commit in ONE transaction. Known
local limitation: the rolling-24h event cap is checked per execution context (two
simultaneous local tabs can overshoot it by a small bound; it does not corrupt state and
cloud-phase serialization restores exactness). `STALE_RUN_MS` (15 min) assumes local run
budgets and must be scoped per execution locus when cloud runs exist.

What is deliberately NOT in this slice (all Phase B+ unless noted): no Cloudflare execution, no
Cron/DO/Workflow, no push, no server-side Google OAuth, no background execution of any kind;
the A1-row items `autonomyContext` memory consent flag, `buildAutonomyContext()` projection
builder, Memory Bank consent UI, and NL→structured authoring are deferred (the editor is
explicit structured forms; permissions are never inferred from free text); the A0-row
pairing/health endpoints were resolved as local-only (no execution to pair). Local runs read
memory via live local retrieval (§11(b)); cloud runs will receive the §8.5 Autonomy Context as
a bounded payload through `RoutineRunOptions.memoryContext` — the worker must never call
`retrieveMemories()`.

---

## 17. Major risks (and mitigations)

1. **Credential boundary for cloud Google access** — resolved by scoping (two loci), but the
   product temptation to "just add refresh tokens" will recur; the design keeps it a separate
   reviewed decision. *(Residual: medium, managed.)*
2. **Local-first erosion** — the memory pack is data leaving the device. Mitigated: opt-in,
   bounded, inspectable, disposable mirror, explicit docs. *(Residual: accepted-with-consent.)*
3. **Prompt injection into an autonomous actor** — mitigated by read-only surface, structured
   outcome gate, no comms tools, deterministic delivery policy. **Residual risk is nonzero and
   must be stated honestly** — the strongest control is blast-radius: a fully injected cloud
   run can at worst produce a bounded, deduped, capped notification containing attacker-
   influenced text. *(Residual: low impact, monitored.)*
4. **Free-tier cliffs** — 10 ms cron CPU (mitigated: cron does nothing), 3 000 workflow
   steps/day (default budgets keep ≪; documented cliff), Exa monthly credits (~46 searches/day
   equivalent; default web budget 20/day), push service rate limits. *(Managed by budgets +
   docs.)*
5. **"Second application runtime" rule erosion** — the autonomy worker must stay a narrow
   boundary sharing *pure modules* (contracts, schedulers, policy functions), never browser
   services. The reliability gate should gain invariants for this. *(Managed by CI.)*
6. **DO alarm edge cases** — single alarm per DO requires multiplexing; incorrect re-arming
   could stall scheduling. Mitigated by the hourly heartbeat repair sweep + dedicated tests. *
   (Managed.)*
7. **iOS push constraints** — no silent push, install required. Mitigated by design (nudge +
   open-to-run), documented. *(Accepted.)*
8. **Notification fatigue** — product risk. Defaults conservative: importance ≥ 2 for push,
   cooldown 24 h, cap 10 push/day, no-op is the expected common outcome. *(Managed by defaults.)*
9. **New test tooling** (`vitest-pool-workers`) — needed for DO/alarm tests; adds CI weight. *
   (Accepted cost.)*
10. **Self-hosting UX friction** — clone + wrangler + secrets is a real barrier for non-
    technical users. *(Open question Q9; does not block the architecture.)*

---

## 18. Open questions requiring consensus

**Gates — status after owner review (2026-09-08):**
- **Q1 — RESOLVED (owner endorsed).** Two-loci split: cloud-native (web + Autonomy Context)
  vs device-native (Google); server-side Google credentials deferred (§8.4.1 decision record).
- **Q2 — RESOLVED by default.** Exa primary, Tavily as the documented alternative behind the
  adapter, keys as worker secrets. (Owner raised no objection; contest before Phase E if
  desired.)
- **Q3 — RESOLVED (§7.4), pending owner concurrence with the verdict.** Hand-rolled
  `SchedulerPort`; the Agents SDK is not adopted, with concrete revisit triggers recorded.
- **Q4 — RESOLVED (owner endorsed).** Workflows from Phase C, subordinate to the scheduler:
  the DO decides what is due; the Workflow is the work.

**Resolve during phasing:**
- Q5. Push payload policy: notification-envelope-only (recommended) vs richer payloads.
- Q6 — RESOLVED by §8.5.** Autonomy Context: per-memory consent flag; ≤ 200 records /
  ≤ 100 KB; MICRO_OBSERVATION excluded; categories are display-only.
- Q7. Trust level of user-authored routine text: semi-trusted (recommended ladder position) —
  confirm it may never expand permissions, and confirm injection framing wording.
- Q8. Inbox placement: dedicated surface (recommended) vs dedicated thread.
- Q9. Self-hosting UX: is clone + wrangler acceptable for v1, or is a Deploy Button / CI
  template a Phase A requirement?
- Q10. Retention numbers: events 90 d / 500 records, runs 30 d / 1 000 records (proposed).
- Q11. Should `web.search`/`web.fetch` also become interactive-chat tools in Phase E, or stay
  autonomy-only until separately reviewed?
- Q12. Exa **Monitors** (hosted scheduled web tracking, $15/1k) as an alternative engine for
  pure watch-topics — rejected for v1 (evidence/dedup must stay in Elara), revisit if provider
  economics change?

---

## 19. Suggested improvements to the original proposal

1. **Split autonomy into two execution loci** (§4.2) instead of one cloud execution model —
   the single most consequential change; it dissolves the OAuth blocker without weakening
   anything and ships value earlier.
2. **Eliminate the public wake endpoint** (§10.1) — same-worker binding topology removes the
   entire wake attack/replay surface. The proposal's "authenticated wake request" was solving
   a problem the recommended topology doesn't have.
3. **Workflow instance id = runKey** (§12) — platform-provided idempotency instead of a
   hand-rolled duplicate-suppression layer.
4. **Run-now + local execution in Phase A1** — the routine domain, inbox, and policy become
   fully testable and *useful* before any Cloudflare execution exists; cloud then accelerates
   a proven system rather than pioneering it.
5. **Memory pack as an explicit bounded projection** (§8.1, §11) — consent boundary and
   local-first preservation, instead of any live/synced full-memory access.
6. **Novelty fingerprint + delivery ledger** (§5, §9) — content-hash dedup complements
   time-based cooldowns and makes "don't tell me twice" robust across channels and loci.
7. **Do-not-nag defaults as product policy** (§17.8) — conservative defaults, no-op as the
   expected outcome, failure notifications suppressed by default.
8. **Keep routine instructions semi-trusted** — NL describes intent; the structured
   permissions object reviewed in the UI is the only authority (as the proposal demanded,
   made structural).
9. **One Worker deployment, not two** — autonomy extends the existing worker codebase;
   the owner's shared chat deployment simply doesn't configure autonomy bindings
   (feature-detected via `/autonomy/health`).
10. **Deferred-by-design list made explicit** — Queues, KV, D1, R2, autonomous writes, MCP,
    Telegram/Discord, autonomy grants: each with the condition under which it earns its place.

---

## 20. Assumptions

- The project owner's Cloudflare account (or each user's) stays on the Workers Free plan for
  the foreseeable future; Paid ($5/mo) removes every cliff mentioned but is not assumed.
- One user per installation; no multi-tenant shared service will be introduced.
- GitHub Pages remains the app host; the user-deployed Worker is a separate, user-owned
  deployment (the current `VITE_GEMINI_WORKER_URL` pattern generalizes).
- Gemini Interactions API surface (including `previous_interaction_id` chaining and background
  execution contracts) remains as currently consumed by the repo.
- Web search providers require accounts/keys held by the deploying user; no anonymous search
  API is assumed viable (Google CSE is closed to new customers and discontinues 2027-01-01;
  Bing Search API is shut down; Brave's free tier is gone — see §21).
- Interactive chat behavior, the Lockbox, and the browser OAuth authority remain unchanged.

---

## 21. Web capability recommendation (summary; detailed in design)

**Recommended semantic interface (provider-agnostic, behind an adapter):**

```ts
interface WebSearchAdapter {
  search(query: string, opts: { maxResults?: number; freshness?: 'day'|'week'|'month' }): Promise<WebResult[]>;
  fetch(url: string, opts: { maxBytes?: number }): Promise<WebPageText>; // read-only GET, SSRF-guarded
}
// WebResult = { url, title, snippet, publishedAt? }
// WebPageText = { url, title, text (extracted, size-capped), fetchedAt }
```

- `web.extract` is folded into `fetch` (extraction is the adapter's job); three verbs were two
  too many.
- **Primary provider: Exa** — $20 signup + $10/month recurring credits (no card), Search
  $7/1k with contents for the first 10 results bundled, neural search quality, JS SDK +
  plain REST (Worker-compatible), SOC 2, MCP server available
  ([Exa pricing](https://exa.ai/pricing)). $10/month ≈ 1 400 searches ≈ 46/day — comfortably
  above the proposed 20/day default budget.
- **Documented alternative: Tavily** — 1 000 free credits/month, AI-optimized results,
  extract endpoint; $30/mo beyond. Keep the adapter interface so this is a config choice.
- **Rejected:** Google Custom Search JSON API (closed to new customers; discontinues
  2027-01-01), Bing Search API (shut down), Brave (free tier eliminated Feb 2026; $5 monthly
  credits with card + attribution required), DuckDuckGo (no official API), self-hosted
  SearXNG (fine for enthusiasts; not a default).
- Provider keys live only in the Worker secrets; the browser never sees them. Interactive-chat
  web tools (Q11) would route through the worker the same way.

---

## 22. Implementation readiness

**Post-review status (2026-09-08):** the owner's three mandatory gates are resolved —
§7.4 (scheduler comparison: hand-rolled `SchedulerPort`, SDK not adopted, revisit triggers
recorded), §8.5 (Autonomy Context specification: consent flag, budgets, lifecycle, invariants),
and §8.4.1 (Google credential decision record: device-native now, server-side offline OAuth as
a separately-reviewed future security project with explicit triggers). Q1, Q4, and Q6 are
resolved by owner endorsement or specification; Q2 stands unless contested.

**IMPLEMENTATION READY for Phase A0–A1** (routine domain, consent model, local execution —
zero cloud dependency), with Phase B onward proceeding on the `SchedulerPort`/`WakeSource`
contract of §4.4 and Workflows subordinate to the scheduler. Since §7.4 was a mandatory gate,
its verdict (hand-rolled; SDK not adopted; revisit triggers recorded) is presented for the
owner's concurrence alongside the greenlight decision. Remaining open questions (Q5, Q7–Q12)
resolve at their phase boundaries without re-architecture.

---

## Appendix A — Cloudflare quick-reference (verified 2026-09)

| Dimension | Free | Paid ($5/mo) |
|---|---|---|
| Worker requests | 100 k/day | unlimited |
| Worker CPU / invocation | 10 ms | 30 s default, 5 min max |
| Cron CPU | 10 ms | 30 s (<1 h) / 15 min (≥1 h) |
| Cron wall time | 15 min | 15 min |
| Cron triggers / account | 5 | 250 |
| Subrequests (external) | 50 | 10 k (→10 M configurable) |
| Durable Objects | SQLite-backed, 100 classes, 5 GB | unlimited classes/storage, 10 GB/DO |
| DO alarm retries | 6× exponential backoff | same |
| Queues | 10 k ops/day, 24 h retention | 1 M ops/month, 14 d retention |
| Workflows | 3 k steps/day, 1 GB-mo | 500 k steps/month, then $0.80/100 k |
| KV | 100 k reads / 1 k writes/day, 1 GB | 10 M reads / 1 M writes/month |
| D1 | 5 M rows read / 100 k rows written/day, 5 GB | 25 B / 50 M per month, 5 GB |
| R2 | 10 GB, 1 M Class A / 10 M Class B per month | usage-based, no egress |

Sources: Cloudflare official docs —
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
[Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[DO alarms (at-least-once, 6 retries, canonical single-alarm pattern)](https://developers.cloudflare.com/durable-objects/api/alarms/),
[Queues limits](https://developers.cloudflare.com/queues/platform/limits/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workflows billing changelog](https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/),
[subrequest changelog](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/),
[Agents SDK — long-running agents](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/),
[Agents SDK — schedule tasks](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/),
[Agents SDK — Agent class internals](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/),
[Agents SDK — testing](https://developers.cloudflare.com/agents/getting-started/testing-your-agent/),
[`agents` package (v0.22.0 manifest and version history)](https://www.npmjs.com/package/agents).

## Appendix B — Web push quick-reference

Payload ≤ 4 096 bytes encrypted (~3 993 plaintext); VAPID JWT ≤ 24 h (12 h recommended);
404/410 = subscription invalid → delete + await resubscribe; TTL bounds retention; visible
notification mandatory on iOS (no silent push; home-screen install required);
[web.dev push protocol](https://web.dev/articles/push-notifications-web-push-protocol),
[RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291),
[RFC 8030](https://datatracker.ietf.org/doc/html/rfc8030).
