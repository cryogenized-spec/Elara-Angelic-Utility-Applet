---
id: SYS-PWA
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: installable web app, service-worker lifecycle and Pages deployment
paths: [src/pwa.ts, vite.config.ts, .github/workflows/deploy.yml]
keywords: [pwa, service-worker, pages, deployment, update]
---

# PWA and deployment

## 1. Purpose and boundary

`SYS-PWA` owns Elara's installable browser shell, service-worker update lifecycle and static GitHub Pages deployment. It does not own the Cloudflare runtime; see `SYS-WORKER / worker.md`.

## 2. Runtime architecture

```text
main push
-> GitHub Actions build
-> Vite dist/
-> GitHub Pages artifact

open/installed client
-> register service worker
-> immediate + periodic/focus/visibility update checks
-> waiting worker
-> user-visible refresh action
-> SKIP_WAITING + reload
```

The service worker uses a prompt strategy. Discovery is aggressive, activation is not: a deploy must not reload an active conversation behind the user's back.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Update lifecycle | `src/pwa.ts` |
| Manifest/Workbox/base path | `vite.config.ts` |
| Pages deployment | `.github/workflows/deploy.yml` |
| App icons | `public/icons/` |

## 4. Data and contracts

Vite base, manifest `id/start_url/scope` use `/Elara-Angelic-Utility-Applet/`. The PWA is `standalone`, `portrait-primary`, with 192px and 512px PNG icons. Workbox precaches built JS/CSS/HTML/images/SVG/icons/WOFF2 and cleans obsolete caches.

`initPwaUpdater()` registers once even under React StrictMode, checks for updates on load, every 30 minutes, when the document becomes visible and when the window regains focus. `onNeedRefresh` only notifies the app. `applyPwaUpdate()` applies the waiting worker explicitly.

GitHub Pages builds from `main`, uploads `dist/`, then deploys the Pages artifact. It does not serve the source tree or require a compiled-output branch.

## 5. Invariants

- Never auto-activate a new worker over a running page with unsaved/in-flight UI state.
- `registerType:'prompt'` is deliberate; do not replace it with `autoUpdate` without revisiting UX/state safety.
- The repository base path must remain aligned across Vite and manifest settings.
- Pages publishes only built output.
- PWA caching must not turn credentials/provider responses into a general offline cache.

## 6. Security and failure semantics

Service-worker registration/update failures are non-fatal to normal browser use and are logged as safe PWA errors. Worker-autonomy credentials are unrelated to this service worker. Deployment assets must not embed Gemini or Google OAuth secrets.

## 7. Verification and tests

Use `npm run build`, PWA/update component tests and deployed Pages smoke tests. CI verifies the application before the independent Pages workflow builds/deploys. Installed-app update behavior should be tested on a real Android device because long-lived standalone sessions differ from ordinary navigation.

## 8. Known gaps

Offline behavior is intentionally limited to the installable/static shell; Elara's network providers still require connectivity. Any expanded offline data policy must be designed per subsystem rather than achieved by broad service-worker caching.
