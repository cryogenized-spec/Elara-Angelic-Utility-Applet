---
id: SYS-PWA
status: active
verified_commit: 0b5fd5623962c1d737ec6f5a793428bc42cc8649
scope: installable web app, service-worker lifecycle and certified Pages deployment
paths: [src/pwa.ts, vite.config.ts, .github/workflows/ci.yml]
keywords: [pwa, service-worker, pages, deployment, update]
---

# PWA and deployment

## 1. Purpose and boundary

`SYS-PWA` owns Elara's installable browser shell, service-worker update lifecycle and static GitHub Pages deployment. Cloudflare runtime behavior remains owned by `SYS-WORKER / worker.md`.

## 2. Runtime architecture

```text
main push
-> Runtime verification
-> production build
-> final reliability gate
-> Pages artifact from dist/
-> deploy job
-> GitHub Pages

open/installed client
-> register service worker
-> immediate + periodic/focus/visibility update checks
-> waiting worker
-> user-visible refresh action
-> SKIP_WAITING + reload
```

The service worker uses a prompt strategy. Discovery is aggressive, activation is not: deployment must not reload an active conversation behind the user's back.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Update lifecycle | `src/pwa.ts` |
| Manifest/Workbox/base path | `vite.config.ts` |
| Certification and Pages deployment | `.github/workflows/ci.yml` |
| App icons | `public/icons/` |

## 4. Data and contracts

Vite base, manifest `id/start_url/scope` use `/Elara-Angelic-Utility-Applet/`. The PWA is `standalone`, `portrait-primary`, with 192px and 512px PNG icons. Workbox precaches built JS/CSS/HTML/images/SVG/icons/WOFF2 and cleans obsolete caches.

`initPwaUpdater()` registers once even under React StrictMode, checks for updates on load, every 30 minutes, when the document becomes visible and when the window regains focus. `onNeedRefresh` only notifies the app. `applyPwaUpdate()` applies the waiting worker explicitly.

Pages deployment is part of the certified CI workflow. Only a `main` push may package `dist/`, and the deploy job depends on the successful runtime-verification job. The site never deploys source-tree output or an independently rebuilt artifact.

## 5. Invariants

- Never auto-activate a new worker over a running page with unsaved or in-flight UI state.
- `registerType:'prompt'` is deliberate; do not replace it with `autoUpdate` without revisiting UX/state safety.
- The repository base path must remain aligned across Vite and manifest settings.
- Pages publishes only the certified `dist/` artifact.
- PWA caching must not turn credentials or provider responses into a general offline cache.
- An uncertified `main` commit must not reach the Pages deploy job.

## 6. Security and failure semantics

Service-worker registration/update failures are non-fatal to normal browser use and are logged as safe PWA errors. Worker-autonomy credentials are unrelated to this service worker. Deployment assets must not embed Gemini or Google OAuth secrets. Pages write and OIDC permissions are confined to the deploy job.

Version coherence is owned by the page as well as the plugin. When a document already has a service-worker controller, any later controllerchange means new worker code has claimed an old JavaScript runtime; that page reloads exactly once. Because Workbox clientsClaim applies to sibling clients, each already-controlled open tab performs the same reload. First-ever installation remains non-disruptive because the document had no previous controller. This prevents old pages from later requesting stale hashed lazy chunks or speaking old client protocols under a newly activated worker.

## 7. Verification and tests

Use `npm run build`, PWA/update component tests and deployed Pages smoke tests. CI builds, verifies and packages one artifact in the runtime job; deployment consumes that artifact only after runtime certification succeeds. Installed-app update behavior should still be tested on a real Android device because long-lived standalone sessions differ from ordinary navigation.

## 8. Known gaps

Offline behavior is intentionally limited to the installable/static shell; Elara's network providers still require connectivity. Expanded offline data policy must be designed per subsystem rather than achieved by broad service-worker caching.
