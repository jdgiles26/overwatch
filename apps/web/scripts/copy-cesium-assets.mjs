// Mirror the Cesium runtime assets (Workers/, Assets/, Widgets/, ThirdParty/)
// into apps/web/public/cesium so the browser loads them from the same origin
// as the app. The cesium.com CDN is unusable for us because it does not send
// an `Access-Control-Allow-Origin` header — when the page lives on
// localhost:3311 (or our prod origin), the browser blocks every Worker fetch
// with a CORS error and Map3D fails to render terrain pickers.
//
// Idempotent: skips copy if the destination already has Cesium.js with the
// same mtime as the source. Force re-copy with `--force`.
//
// Runs from `apps/web` via `predev` / `prebuild` hooks. Don't import this
// from app code — it uses Node fs APIs.

import { cp, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const DEST = join(APP_ROOT, "public", "cesium");

const force = process.argv.includes("--force");

const require = createRequire(import.meta.url);

function findCesiumBuildDir() {
  // `cesium/index.js` resolves to the package entry; the Build/Cesium dir
  // is two levels up from the entry (entry is at <pkg>/Build/Cesium/index.js
  // in distributed builds, OR at <pkg>/index.cjs in source builds).
  const candidates = [
    // Most reliable: the package package.json sits at <pkg>/package.json.
    () => {
      const pkgJson = require.resolve("cesium/package.json");
      return join(dirname(pkgJson), "Build", "Cesium");
    },
  ];
  for (const c of candidates) {
    try {
      const p = c();
      if (existsSync(join(p, "Cesium.js"))) return p;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "copy-cesium-assets: could not find Cesium Build dir. " +
      "Is the `cesium` package installed?",
  );
}

async function shouldCopy(src) {
  if (force) return true;
  const destEntry = join(DEST, "Cesium.js");
  if (!existsSync(destEntry)) return true;
  const [s, d] = await Promise.all([
    stat(join(src, "Cesium.js")),
    stat(destEntry),
  ]);
  // If source is newer (package upgrade) or destination is older, copy.
  return s.mtimeMs > d.mtimeMs;
}

async function main() {
  const src = findCesiumBuildDir();
  if (!(await shouldCopy(src))) {
    console.log(`[cesium] ${DEST} is up-to-date, skipping copy`);
    return;
  }
  await mkdir(DEST, { recursive: true });
  console.log(`[cesium] copying ${src} -> ${DEST}`);
  await cp(src, DEST, { recursive: true, dereference: true });
  console.log("[cesium] copy complete");
}

main().catch((err) => {
  console.error("[cesium] copy failed:", err.message);
  process.exitCode = 1;
});
