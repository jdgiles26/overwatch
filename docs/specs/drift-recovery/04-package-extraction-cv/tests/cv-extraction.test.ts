import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const readme = readFileSync(resolve(REPO, "packages/cv/README.md"), "utf8");

if (/\*\*Status:\*\*\s*placeholder/i.test(readme)) {
  console.log("RED: @overwatch/cv is still a placeholder — extraction not done");
  process.exit(0);
}

for (const f of ["packages/cv/src/engine.ts", "packages/cv/src/protocol.ts",
                 "packages/cv/src/workers/cv.ts", "packages/cv/src/workers/vision.ts",
                 "packages/cv/src/workers/drone.ts"]) {
  assert.ok(existsSync(resolve(REPO, f)), `${f} is missing`);
}
console.log("GREEN: @overwatch/cv has been extracted");
