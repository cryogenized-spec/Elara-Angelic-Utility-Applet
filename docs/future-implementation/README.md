# Future Implementation

This directory records future infrastructure and integration work that is intentionally not part of the current visual/API foundation.

## Cloudflare health signal

Add an application-level infrastructure status indicator that automatically checks the production Cloudflare Worker when Elara loads. The first signal should verify the Worker health endpoint and report a clear Worker status such as reachable/unreachable.

Do not treat a healthy Worker as proof that Gemini or Google Workspace is operational. Keep separate states for:

- Cloudflare Worker reachable
- Gemini provider verified/unverified
- Google authorization connected/not connected
- Individual Google capability available/unavailable

The UI should never imply that a green Worker light guarantees a successful Gemini model request.

## Scheduled automation / Cron

Cloudflare Worker Cron Triggers are reserved for scheduled agent work. The Worker should dispatch scheduled work through a durable job/orchestration boundary rather than depending on an open browser tab.

Planned capabilities include recurring reminders, scheduled task maintenance, calendar-driven actions, periodic Workspace synchronization, and scheduled agent runs.

Cron configuration, schedules, retry policy, idempotency, execution records, and user authorization must remain server-side and auditable.

## Background execution

Agent work must be able to continue when the browser tab is closed or the web UI is not active. Long-running or scheduled execution belongs on the Cloudflare side, using the appropriate durable execution primitive rather than attempting to keep the React page alive.

The browser remains a presentation/control surface. It must be able to reconnect later, retrieve completed work, and display the resulting activity without requiring the original tab to have remained open.

## User re-contact / notifications

For scheduled or background work, Elara will eventually need a user notification channel. The preferred first web/PWA path is Web Push with a service worker so the user can be notified even after closing the page.

A future Android wrapper can add native notification affordances, including richer notification interactions where supported. A notification is a delivery mechanism, not a replacement for the persistent task/result record.

Notification permissions, subscriptions, revocation, delivery failures, and user preferences must be explicit and privacy-safe.

WhatsApp is deliberately out of the current scope. Telegram may be evaluated later as an optional external channel.

## Internet / external knowledge access

A future internet-access layer may be added for agent research and external information retrieval. This must be exposed as narrowly scoped, application-owned tools rather than arbitrary model-generated HTTP requests.

The internet tool boundary will require:

- explicit allow-listed operations
- argument validation
- destination and protocol restrictions
- timeout and retry controls
- rate limiting and abuse protection
- safe result normalization
- provenance/source metadata
- separation from Google OAuth credentials and Workspace tools

## Architecture rule

Future infrastructure must preserve the existing boundaries: the UI does not own secrets, OAuth internals, provider clients, background execution, or arbitrary network access. Scheduled work, notifications, OAuth, Workspace services, and internet access remain separate application capabilities with auditable execution paths.
