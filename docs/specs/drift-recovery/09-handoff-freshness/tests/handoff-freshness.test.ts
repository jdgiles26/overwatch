import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const handoff = readFileSync(resolve(REPO, "handoff.md"), "utf8");

// Allow markdown emphasis (`**`) between the label and its value so the
// rule applies regardless of whether the header is plain or bolded.
const G = "[*\\s]*";

const violations: string[] = [];
if (new RegExp(`Last updated:${G}\\d{4}-\\d{2}-\\d{2}`, "i").test(handoff)) {
  violations.push("Last updated date");
}
if (new RegExp(`Local main:${G}\`?[0-9a-f]{7,40}\`?`, "i").test(handoff)) {
  violations.push("Local main SHA");
}
if (new RegExp(`Tests:${G}\\d+\\/\\d+`, "i").test(handoff)) {
  violations.push("Tests N/N");
}
if (new RegExp(`Working tree:${G}clean`, "i").test(handoff)) {
  violations.push("Working tree clean");
}

if (violations.length) {
  // RED is the *expected* state until spec 09 is resolved. Print the
  // violations so the implementing agent knows what to strip, and exit
  // 0 so this scaffold does not break the verify pipeline. When the
  // spec is done, flip to `process.exit(1)` on the green branch.
  console.log(`RED: handoff.md still asserts volatile facts: ${violations.join(", ")}`);
  process.exit(0);
}
console.log("GREEN: handoff.md has been de-volatilised");
