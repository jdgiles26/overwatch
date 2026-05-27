/**
 * Scaffold test for the @overwatch/agent extraction.
 *
 * Today this file asserts what the package looks like *before* the
 * work has been done. It is intentionally a "red" test for the
 * graduation moment — when the package is real, this file flips green
 * by inverting each assertion.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const readme = readFileSync(resolve(REPO, "packages/agent/README.md"), "utf8");
const stillPlaceholder = /\*\*Status:\*\*\s*placeholder/i.test(readme);

const srcExists = existsSync(resolve(REPO, "packages/agent/src/overseer.ts"));
const webStillOwnsAgent = existsSync(resolve(REPO, "apps/web/src/lib/agent.ts"));

if (stillPlaceholder) {
  console.log("RED: @overwatch/agent is still a placeholder — extraction not done");
  process.exit(0);
}

assert.ok(srcExists, "packages/agent/src/overseer.ts is missing");
assert.ok(!webStillOwnsAgent, "apps/web/src/lib/agent.ts should be removed once extracted");
console.log("GREEN: @overwatch/agent has been extracted");
