# 08 — End-to-end Playwright harness

## Goal

A repeatable browser harness that boots the stack (or attaches to an
already-running one), drives the UI, and asserts the golden paths
that `.agents/BASELINE.md` and `CLAUDE.md` both require for "done."

## Non-goals

- Full coverage. One smoke spec per surface is enough to start.
- Visual regression (out of scope until a baseline is stable).
- Cross-browser matrix. Chromium-only until there's a reason.

## Scope

| File | Purpose |
|---|---|
| `e2e/playwright.config.ts` | base config; chromium project; webServer hook |
| `e2e/smoke.spec.ts` | loads `/`, asserts globe canvas mounts, no console errors |
| `e2e/connectors.spec.ts` | loads `/connectors`, asserts catalog renders |
| `e2e/camera.spec.ts` | adds a webcam (mocked `getUserMedia`), toggles to YOLO, expects `cv-detection` POST |
| `.github/workflows/e2e.yml` | runs Playwright on PRs |

The harness lives at the repo root in `e2e/`, not inside `apps/web`,
because it boots both apps.

## Done-when

- `pnpm e2e` runs Playwright headless against a dockerised stack.
- At least the smoke spec passes locally.
- `handoff.md §6.4` "No SW unregister step in dev" can include a
  follow-up "smoke harness covers SW init."
- `future/IDEAS.md` #9 is removed (it asked for this).

## Risks

- Cesium under headless Chromium needs WebGL; some CI runners lack
  it. Use `--use-gl=swiftshader` or skip Cesium in headless and
  cover it manually.
