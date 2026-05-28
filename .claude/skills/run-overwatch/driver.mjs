#!/usr/bin/env node
// run-overwatch driver — Puppeteer-based UI smoke + screenshot tool for the
// Overwatch stack (fabric + web + go2rtc). Pairs with SKILL.md in this dir.
//
// Why this exists (read once, then forget): the Cesium 3D globe is the canary
// for half the bundle pipeline — webpack externals, the UMD <Script> tag in
// layout.tsx, and FABRIC_URL baking in the web Dockerfile. If the globe
// renders and /fabric/api/cameras returns 200 through the rewrite, the stack
// is wired correctly. So "did it work?" = "did the globe show up?"
//
// Subcommands:
//   health           curl smoke (fabric direct + via web proxy)
//   ui [out]         launch headless Chrome, load /, wait for Cesium globe,
//                    screenshot to OUT (default: ./out/ui.png), exit non-zero
//                    if any pageerror fired or the globe didn't mount
//   console [url]    same launch but print every console.* line and pageerror
//   ports            show what's bound to 4311/3311/1984
//
// Uses system Chrome (no bundled Chromium download). Override with
// CHROME_PATH=/path/to/chrome.
//
// This driver expects the stack to already be up; use the "up"/"down" recipes
// in SKILL.md for compose lifecycle.

import { execSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WEB_URL = process.env.OVERWATCH_WEB_URL || "http://localhost:3311";
const FABRIC_URL = process.env.OVERWATCH_FABRIC_URL || "http://localhost:4311";

const cmd = process.argv[2];
const args = process.argv.slice(3);

const HELP = `run-overwatch driver
  node driver.mjs health
  node driver.mjs ui [out=./out/ui.png]
  node driver.mjs console [url=${WEB_URL}]
  node driver.mjs ports
env: CHROME_PATH, OVERWATCH_WEB_URL, OVERWATCH_FABRIC_URL`;

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function curlCode(url) {
  const r = spawnSync(
    "curl",
    ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", url],
    { encoding: "utf8" },
  );
  return r.stdout.trim() || "ERR";
}

async function withBrowser(fn) {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    return await fn({ browser, page });
  } finally {
    await browser.close();
  }
}

async function health() {
  const checks = [
    [`${FABRIC_URL}/health`, "200"],
    [`${FABRIC_URL}/api/cameras`, "200"],
    [`${WEB_URL}/`, "200"],
    [`${WEB_URL}/fabric/api/cameras`, "200"],
    [`${WEB_URL}/fabric/api/locations`, "200"],
  ];
  let failed = 0;
  for (const [url, want] of checks) {
    const got = curlCode(url);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${want}  ${url}  → ${got}`);
  }
  if (failed) die(`\n${failed} check(s) failed`, 1);
  console.log("\nall health checks passed");
}

async function ui(out) {
  // Default to <skill-dir>/out/ui.png so the path is the same whether the
  // agent runs the driver from the repo root or from the skill dir. An
  // explicit `out` arg is resolved relative to the *current working dir*
  // (normal node behavior) so absolute paths and arbitrary scripts work.
  const outPath = out ? resolve(out) : resolve(__dirname, "out/ui.png");
  mkdirSync(dirname(outPath), { recursive: true });

  const errors = [];
  await withBrowser(async ({ page }) => {
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (req) => {
      const url = req.url();
      // Tolerate Cesium asset 404s the SW retries; everything else is real.
      if (!/Cesium\/Assets/.test(url)) errors.push(`requestfailed: ${url}`);
    });

    await page.goto(WEB_URL, { waitUntil: "networkidle2", timeout: 30_000 });

    // The Map3D component sets window.__cesiumViewer once Cesium has mounted
    // and the Viewer is created. That's the "real" ready signal.
    await page.waitForFunction(
      () => !!window.Cesium && !!window.__cesiumViewer,
      { timeout: 30_000 },
    );

    // Also confirm a canvas exists inside the map region — without this the
    // viewer object can exist but the renderer hasn't attached.
    const hasCanvas = await page.evaluate(() => {
      const root = document.querySelector('[data-agent="map-3d"]');
      return !!(root && root.querySelector("canvas"));
    });
    if (!hasCanvas) errors.push("no canvas inside [data-agent=\"map-3d\"]");

    await page.screenshot({ path: outPath, fullPage: false });

    const status = await page.evaluate(() => ({
      cesium: typeof window.Cesium !== "undefined",
      version: window.Cesium?.VERSION,
      viewer: !!window.__cesiumViewer,
      canvases: document.querySelectorAll("canvas").length,
    }));
    console.log("status:", JSON.stringify(status));
  });

  console.log(`screenshot: ${outPath}`);
  if (errors.length) {
    console.error("\nerrors:");
    for (const e of errors) console.error("  " + e);
    die("UI smoke failed", 1);
  }
  console.log("UI smoke passed");
}

async function consoleProbe(url) {
  const target = url || WEB_URL;
  await withBrowser(async ({ page }) => {
    page.on("console", (m) => console.log(`[${m.type()}]`, m.text()));
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(target, { waitUntil: "networkidle2", timeout: 30_000 });
    // Give the page a beat to emit late console messages (SW, lazy chunks).
    await new Promise((r) => setTimeout(r, 2_000));
  });
}

function ports() {
  for (const p of [4311, 3311, 1984]) {
    try {
      const out = execSync(`lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null || true`, {
        encoding: "utf8",
      }).trim();
      console.log(`:${p}\n${out || "  (nothing listening)"}\n`);
    } catch (e) {
      console.log(`:${p} — ${e.message}`);
    }
  }
}

try {
  switch (cmd) {
    case "health":
      await health();
      break;
    case "ui":
      await ui(args[0]);
      break;
    case "console":
      await consoleProbe(args[0]);
      break;
    case "ports":
      ports();
      break;
    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  die(e.stack || String(e), 1);
}
