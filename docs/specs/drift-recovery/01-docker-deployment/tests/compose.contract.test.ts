/**
 * Contract test for infra/docker-compose.yml.
 *
 * Runs without spinning containers — parses the YAML as text and
 * asserts the shape DRIFT.md / SPEC.md require. Anything labelled
 * MANUAL in TESTS.md cannot be covered here; this file covers the
 * mechanical contracts only.
 *
 * To run once a Vitest runner is wired into this spec folder:
 *   pnpm exec vitest run docs/specs/drift-recovery/01-docker-deployment
 *
 * Today the spec folder has no package.json yet; this file is
 * pure-Node assertions invoked by `node --import tsx/esm` or the
 * future spec runner. Keep it dependency-free.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const compose = readFileSync(resolve(REPO, "infra/docker-compose.yml"), "utf8");
const dockerfileWeb = readFileSync(resolve(REPO, "infra/Dockerfile.web"), "utf8");
const fabricIndex = readFileSync(resolve(REPO, "apps/fabric/src/index.ts"), "utf8");

const checks: Array<[string, () => void]> = [
  ["compose drops host networking", () => {
    // Match only a real YAML key (not a comment that documents its removal).
    assert.ok(!/^\s*network_mode:\s*host\b/m.test(compose), "network_mode: host still present");
  }],
  ["compose publishes go2rtc ports", () => {
    for (const port of [`"1984:1984"`, `"8555:8555/tcp"`, `"8555:8555/udp"`]) {
      assert.ok(compose.includes(port), `missing port ${port}`);
    }
  }],
  ["Dockerfile.web declares NEXT_PUBLIC_* build args", () => {
    for (const k of ["NEXT_PUBLIC_FABRIC_URL", "NEXT_PUBLIC_FABRIC_WS", "NEXT_PUBLIC_GO2RTC_URL"]) {
      assert.ok(new RegExp(`ARG\\s+${k}\\b`).test(dockerfileWeb), `missing ARG ${k}`);
    }
  }],
  ["compose passes NEXT_PUBLIC_* into web build", () => {
    for (const k of ["NEXT_PUBLIC_FABRIC_URL", "NEXT_PUBLIC_FABRIC_WS", "NEXT_PUBLIC_GO2RTC_URL"]) {
      assert.ok(compose.includes(k), `compose does not forward ${k}`);
    }
  }],
  ["fabric has healthcheck hitting /health", () => {
    assert.ok(/healthcheck:[\s\S]*?\/health/.test(compose));
  }],
  ["web waits for fabric service_healthy", () => {
    assert.ok(/condition:\s*service_healthy/.test(compose));
  }],
  ["fabric still exposes GET /health", () => {
    assert.ok(/app\.get\(\s*["']\/health["']/.test(fabricIndex));
  }],
];

let failed = 0;
for (const [name, fn] of checks) {
  try { fn(); console.log(`  ok    ${name}`); }
  catch (e) { failed += 1; console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); }
}
if (failed > 0) {
  console.error(`\n${failed} contract failure(s)`);
  process.exit(1);
}
console.log("\ncompose contract: OK");
