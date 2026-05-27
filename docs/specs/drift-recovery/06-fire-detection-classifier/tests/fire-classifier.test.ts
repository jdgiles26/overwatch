import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const cvWorker = readFileSync(resolve(REPO, "apps/web/src/components/cvWorker.ts"), "utf8");

const stillHeuristic = /high-edge|edge.?density/i.test(cvWorker) && /["']fire["']/.test(cvWorker);

if (stillHeuristic) {
  console.log("RED: cvWorker.ts still uses edge-density heuristic AND emits 'fire'");
  process.exit(0);
}
console.log("GREEN: fire detection has been replaced or renamed");
