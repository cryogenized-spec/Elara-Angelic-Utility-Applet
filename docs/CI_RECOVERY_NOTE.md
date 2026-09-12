# CI recovery note

The first CI attempt after the next-feature implementation failed before dependency installation because the live Gemini Worker transport gate failed. The failure was environmental/live-boundary verification, not a TypeScript, unit-test, build, or Playwright failure; all later steps were skipped by the workflow.

The verification script has been tightened so its failure distinguishes health HTTP status, health payload state, health CORS origin, preflight HTTP status, preflight origin, allowed method, and allowed headers.

The feature phase is not considered green until a new push reaches lint, typecheck, unit tests, build, Playwright, and the final reliability gate successfully.

## Diagnosing CI failures from this working environment (2026-09-12)

Workflow logs are not reachable from the development sandbox: `gh run view --log-failed`
hits a blocked log receiver, artifact downloads redirect to a blocked blob host, and
`/jobs/<id>/logs` returns 404. Two channels do work:

1. **Check-run annotations** — the primary channel, and the only one that carries
   Playwright failure text (the github reporter writes full failure messages there):
   `gh api /repos/<owner>/<repo>/commits/<sha>/check-runs?per_page=20` gives the run's
   check runs; fetch each failure's annotations route
   (`/repos/<owner>/<repo>/check-runs/<id>/annotations`). Note the summary object's
   `annotations_url` field can be null — take the id and construct the route. This is
   why E2E specs keep diagnostics inside assertion messages: that is the only way a
   browser-test failure self-reports from CI.
2. **The jobs API step list** — `gh api /repos/<owner>/<repo>/actions/runs/<run_id>/jobs`
   with a jq filter over `steps[].conclusion`. Disciplined lesson from this branch's
   history: when CI fails at a *step* (lint, typecheck, build, reliability gate) rather
   than inside a test, the annotations channel is **empty** — there is no test failure
   to annotate. The step list names the failing step exactly and was what localized the
   foundation-documents failure and the deliberate typecheck-gate proof (2026-09-12)
   within seconds. Check it first; fall back to annotations when the failing step is
   "End-to-end tests".
