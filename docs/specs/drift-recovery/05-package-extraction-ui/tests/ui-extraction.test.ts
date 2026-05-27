import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const readme = readFileSync(resolve(REPO, "packages/ui/README.md"), "utf8");

if (/\*\*Status:\*\*\s*placeholder/i.test(readme)) {
  console.log("RED: @overwatch/ui is still a placeholder — phase 1 extraction not done");
  process.exit(0);
}

for (const f of ["packages/ui/src/TopBar.tsx", "packages/ui/src/EventDetail.tsx",
                 "packages/ui/src/ConsoleFilter.tsx", "packages/ui/src/TimeScrubber.tsx"]) {
  assert.ok(existsSync(resolve(REPO, f)), `${f} is missing`);
}
console.log("GREEN: @overwatch/ui phase 1 extracted");
