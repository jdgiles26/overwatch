# 08 — E2E Playwright harness · TDD checklist

- [ ] `e2e/playwright.config.ts` exists and declares a `chromium` project.
- [ ] `e2e/smoke.spec.ts` loads `http://localhost:3311` and asserts:
      - top bar renders
      - no `console.error` calls during the first 5 seconds
      - WebSocket connects (assert via network event capture)
- [ ] `e2e/connectors.spec.ts` loads `/connectors` and asserts the
      catalog has > 0 rows.
- [ ] `e2e/camera.spec.ts` mocks `getUserMedia` (Playwright
      `page.context().grantPermissions(['camera'])` or fake media
      stream flag), adds a webcam tile, switches to YOLO, asserts a
      POST `/api/cv-event` is observed.
- [ ] `pnpm e2e` script exists and runs Playwright headless.
- [ ] `future/IDEAS.md` #9 is deleted (this spec replaces it).
