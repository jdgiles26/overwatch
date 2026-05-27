import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const readme = readFileSync(resolve(REPO, "packages/ai/README.md"), "utf8");

if (/\*\*Status:\*\*\s*placeholder/i.test(readme)) {
  console.log("RED: @overwatch/ai is still a placeholder — extraction not done");
  process.exit(0);
}

const indexTs = readFileSync(resolve(REPO, "packages/ai/src/index.ts"), "utf8");
for (const sym of ["runChat", "runVisionCaption", "detectRepetitionLoop"]) {
  assert.ok(indexTs.includes(sym), `index.ts is missing export ${sym}`);
}
console.log("GREEN: @overwatch/ai has been extracted");
