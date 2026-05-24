// Smoke test for the Cesium asset mirror. Asserts the script produces a
// usable public/cesium directory with the runtime entry points the browser
// needs. Run via `node apps/web/scripts/copy-cesium-assets.test.mjs`.

import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_CESIUM = resolve(here, "..", "public", "cesium");

const required = [
  "Cesium.js",
  "Widgets/widgets.css",
  "Workers",
  "Assets",
  "ThirdParty",
];

let failed = 0;
for (const r of required) {
  const path = join(PUBLIC_CESIUM, r);
  if (!existsSync(path)) {
    console.error(`MISSING: ${path}`);
    failed++;
  } else {
    console.log(`OK: ${r}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} required Cesium asset(s) missing.`);
  console.error(
    "Run `pnpm --filter @overwatch/web cesium:assets` or `pnpm --filter @overwatch/web dev` (predev re-runs the copy).",
  );
  process.exit(1);
}
console.log("\nAll required Cesium runtime assets present.");
