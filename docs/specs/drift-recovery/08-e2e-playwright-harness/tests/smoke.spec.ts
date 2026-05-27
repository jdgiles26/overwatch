/**
 * Placeholder Playwright spec. The implementing agent will:
 *   1. add `@playwright/test` to devDependencies at the repo root
 *   2. add `e2e/playwright.config.ts`
 *   3. move this file to `e2e/smoke.spec.ts`
 *   4. wire `pnpm e2e` to run it
 *
 * Until then, this file is intentionally not executable — it's a
 * shape sketch for the agent to follow.
 */

// import { test, expect } from "@playwright/test";
//
// test("dashboard loads without console errors", async ({ page }) => {
//   const errors: string[] = [];
//   page.on("console", (msg) => {
//     if (msg.type() === "error") errors.push(msg.text());
//   });
//
//   await page.goto("http://localhost:3311");
//   await expect(page.locator('[data-agent="topbar-status"]')).toBeVisible({ timeout: 10_000 });
//   await page.waitForTimeout(5_000);
//   expect(errors).toEqual([]);
// });

console.log("RED: playwright not yet wired — see SPEC.md");
