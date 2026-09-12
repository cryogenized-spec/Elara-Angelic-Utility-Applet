# UI Pass 06 — Quick-action rail

## Status
Implemented on `main` as the Workspace quick-action UI/application boundary.

## Scope

Pass 6 implements the Android-first horizontal utility rail for Calendar, Tasks, and Gmail. The rail is typed and configurable through a `QuickActionDescriptor` list rather than hard-coding button behavior into JSX.

Each shortcut dispatches through the application's Workspace shortcut boundary and runs as a normal generation turn restricted to the registered tools that shortcut names — `TopToolRail` → `WorkspaceMenu` → `App.runWorkspaceShortcut` → the Gemini tool loop with `tools` narrowed to the shortcut's registry entries. It does not mutate conversation state directly, and no adapter fabricates Workspace data.

> Correction (2026-09-11): this pass originally described the rail as sitting behind "a deterministic demo boundary" because the production OAuth-backed Workspace runtime was not yet reachable. That is no longer true. `demoQuickActionPort` and the `QuickActionPort` seam in `src/app/quick-actions/` are now unreferenced residue from that design — the rail is live, and whether a shortcut returns real data depends on the Google authorization runtime (see `docs/ACTIVE_IMPLEMENTATION_ROADMAP.md`), not on a demo adapter in the UI.

The shortcut affordance is rendered by `WorkspaceMenu`; the `QuickActionSurface` component that displayed a per-action "authorization required" panel belonged to the demo boundary and is likewise no longer mounted.

## Files

- `src/app/quick-actions/contracts.ts` — typed action IDs, capability keys, descriptors, surface model, and application port.
- `src/app/quick-actions/defaults.ts` — default Calendar/Tasks/Gmail configuration and temporary deterministic adapter.
- `src/app/components/TopToolRail.tsx` — configurable horizontal action rail with pressed/active state.
- `src/app/components/QuickActionSurface.tsx` — dedicated non-chat result surface.
- `src/app/quick-action-rail.css` — rail/surface styling and reduced-motion behavior.
- `src/app/App.tsx` — application-level dispatch and surface lifecycle.
- `e2e/smoke.spec.ts` — coverage that actions open surfaces without creating messages.

## Boundary decisions

The UI knows only action descriptors and the narrow dispatch port. It does not construct Google requests or own OAuth. The capability strings align with the existing Google capability contract: Calendar event reads use `calendar.events.read`, Tasks reads use `tasks.read`, and Gmail reads use `gmail.read`.

The eventual production adapter should resolve those capability keys through the single OAuth authority and call the focused Google service boundary. The existing Calendar, Tasks, Gmail, and tool registries remain the source of truth for actual execution semantics.

## Validation

The Playwright coverage verifies that Calendar opens its own action surface, that no `.message` nodes are added, that the surface can be dismissed, and that Tasks/Gmail replace the active surface. The implementation intentionally does not claim live Workspace authorization or live provider results until the executable runtime is connected to the existing OAuth/service contracts.

## Next

Pass 7 is visual polish and motion. Pass 8 is deployed physical-device reliability validation. The production Workspace adapter remains a separate runtime integration task and must not be implemented by bypassing the current OAuth/service boundaries.
