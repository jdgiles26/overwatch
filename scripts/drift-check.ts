#!/usr/bin/env tsx
/**
 * scripts/drift-check.ts — mechanical assertions behind DRIFT.md.
 *
 * Every check has:
 *   - id        stable identifier referenced from DRIFT.md ([auto] rows)
 *   - title     short human-readable label
 *   - run()     returns null on pass, a string describing the drift on fail
 *
 * Exits 0 if all pass, 1 if any fail. Stdout is the report.
 *
 * Run via `pnpm drift` from the repo root.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Check = { id: string; title: string; run: () => string | null };

const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");
const exists = (rel: string) => existsSync(resolve(REPO, rel));

/** Count `.ts` files in a directory, excluding `*.test.ts`. */
const countSourceFiles = (rel: string): number =>
  readdirSync(resolve(REPO, rel))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .length;

const checks: Check[] = [
  {
    id: "connector-count",
    title: "Connector count matches docs",
    run: () => {
      const actual = countSourceFiles("packages/connectors/src/sources");
      const docs: Array<{ path: string; expected: number | null }> = [
        // CLAUDE.md prose says "22 data-source connectors"
        { path: "CLAUDE.md", expected: null },
        // FEATURES.md §6 header says "22 connectors live in ..."
        { path: "docs/FEATURES.md", expected: null },
      ];
      const wrong: string[] = [];
      for (const d of docs) {
        const body = read(d.path);
        // Look for "N connectors" or "N data-source connectors"
        const matches = [...body.matchAll(/(\d+)\s+(?:data-source\s+)?connectors\b/gi)];
        for (const m of matches) {
          const n = Number(m[1]);
          if (Number.isFinite(n) && n !== actual) {
            wrong.push(`${d.path}: claims "${m[0]}", actual ${actual}`);
          }
        }
      }
      return wrong.length ? wrong.join("\n  ") : null;
    },
  },

  {
    id: "placeholder-packages-not-imported",
    title: "Placeholder @overwatch/* packages have no real consumers",
    run: () => {
      const placeholders = ["agent", "ai", "cv", "ui"];
      const stillPlaceholder = placeholders.filter((name) => {
        const readme = read(`packages/${name}/README.md`);
        return /\*\*Status:\*\*\s*placeholder/i.test(readme);
      });
      const drifted: string[] = [];
      for (const name of stillPlaceholder) {
        const needle = `@overwatch/${name}`;
        // Grep workspace package.jsons for a dependency on the placeholder.
        const consumers = ["apps/web", "apps/fabric", ...placeholders
          .filter((p) => p !== name)
          .map((p) => `packages/${p}`)];
        for (const consumer of consumers) {
          const pj = resolve(REPO, consumer, "package.json");
          if (!existsSync(pj)) continue;
          const body = readFileSync(pj, "utf8");
          if (body.includes(`"${needle}"`)) {
            drifted.push(`${consumer}/package.json depends on placeholder ${needle}`);
          }
        }
      }
      return drifted.length ? drifted.join("\n  ") : null;
    },
  },

  {
    id: "drift-md-present",
    title: "DRIFT.md exists at repo root",
    run: () => (exists("DRIFT.md") ? null : "DRIFT.md is missing"),
  },

  {
    id: "drift-recovery-spec-tree",
    title: "Every drift entry has a recovery folder",
    run: () => {
      if (!exists("DRIFT.md")) return "DRIFT.md missing — covered by drift-md-present";
      const required = [
        "docs/specs/drift-recovery/README.md",
        // 01-docker-deployment resolved 2026-05-27 — constraints
        // enforced by the cesium-* / fabric-url / compose-* asserts below.
        "docs/specs/drift-recovery/02-package-extraction-agent/SPEC.md",
        "docs/specs/drift-recovery/03-package-extraction-ai/SPEC.md",
        "docs/specs/drift-recovery/04-package-extraction-cv/SPEC.md",
        "docs/specs/drift-recovery/05-package-extraction-ui/SPEC.md",
        "docs/specs/drift-recovery/06-fire-detection-classifier/SPEC.md",
        "docs/specs/drift-recovery/07-drone-mobilevit-classifier/SPEC.md",
        "docs/specs/drift-recovery/08-e2e-playwright-harness/SPEC.md",
        "docs/specs/drift-recovery/09-handoff-freshness/SPEC.md",
      ];
      const missing = required.filter((p) => !exists(p));
      return missing.length ? `missing: ${missing.join(", ")}` : null;
    },
  },

  {
    id: "compose-publishes-go2rtc-ports",
    title: "docker-compose publishes go2rtc ports (no silent host networking)",
    run: () => {
      const body = read("infra/docker-compose.yml");
      // Match only an actual YAML key, not a comment explaining its removal.
      if (/^\s*network_mode:\s*host\b/m.test(body)) {
        return "infra/docker-compose.yml still declares network_mode: host (broken on macOS)";
      }
      const required = [/"1984:1984"/, /"8555:8555\/tcp"/, /"8555:8555\/udp"/];
      const missing = required.filter((r) => !r.test(body)).map(String);
      return missing.length ? `missing port publications: ${missing.join(", ")}` : null;
    },
  },

  {
    id: "web-next-public-build-args",
    title: "Dockerfile.web declares NEXT_PUBLIC_* as build ARGs",
    run: () => {
      const df = read("infra/Dockerfile.web");
      const required = ["NEXT_PUBLIC_FABRIC_URL", "NEXT_PUBLIC_FABRIC_WS", "NEXT_PUBLIC_GO2RTC_URL"];
      const missing = required.filter((k) => !new RegExp(`ARG\\s+${k}\\b`).test(df));
      return missing.length
        ? `Dockerfile.web is missing ARG declarations for: ${missing.join(", ")}`
        : null;
    },
  },

  {
    id: "compose-passes-next-public-build-args",
    title: "docker-compose passes NEXT_PUBLIC_* through to web build",
    run: () => {
      const body = read("infra/docker-compose.yml");
      const required = ["NEXT_PUBLIC_FABRIC_URL", "NEXT_PUBLIC_FABRIC_WS", "NEXT_PUBLIC_GO2RTC_URL"];
      const missing = required.filter((k) => !body.includes(k));
      return missing.length
        ? `docker-compose.yml does not wire build args: ${missing.join(", ")}`
        : null;
    },
  },

  {
    id: "compose-fabric-healthcheck",
    title: "fabric service has a healthcheck and web waits for it",
    run: () => {
      const body = read("infra/docker-compose.yml");
      const hasHealth = /healthcheck:[\s\S]*?\/health/.test(body);
      const gatesWeb = /condition:\s*service_healthy/.test(body);
      if (!hasHealth) return "fabric service has no /health healthcheck";
      if (!gatesWeb) return "web service does not depends_on fabric with service_healthy";
      return null;
    },
  },

  {
    id: "fabric-health-endpoint-exists",
    title: "Fabric still exposes GET /health (the healthcheck target)",
    run: () => {
      const body = read("apps/fabric/src/index.ts");
      return /app\.get\(\s*["']\/health["']/.test(body)
        ? null
        : "apps/fabric/src/index.ts no longer registers GET /health — compose healthcheck will fail";
    },
  },

  {
    id: "cesium-externalized",
    title: "Cesium is externalized in webpack (avoids the V8 octal parse error)",
    run: () => {
      const cfg = read("apps/web/next.config.mjs");
      const hasExternal = /\bcesium:\s*\{[^}]*root:\s*["']Cesium["']/.test(cfg);
      if (!hasExternal) {
        return "apps/web/next.config.mjs does not externalize `cesium` to the `Cesium` global — Cesium 1.140's bundled chunks will fail to parse with 'Octal escape sequences are not allowed in template strings'";
      }
      const layout = read("apps/web/src/app/layout.tsx");
      if (!/id=["']cesium-umd["']/.test(layout) || !/\/cesium\/Cesium\.js/.test(layout)) {
        return "apps/web/src/app/layout.tsx must render <Script id=\"cesium-umd\" src=\"/cesium/Cesium.js\" strategy=\"beforeInteractive\" /> so the global is available before Map3D mounts";
      }
      return null;
    },
  },

  {
    id: "no-direct-cesium-imports",
    title: "Client code uses loadCesium() helper, not `await import(\"cesium\")`",
    run: () => {
      // Glob would be heavier; rely on the known sites under apps/web/src.
      const targets = [
        "apps/web/src/components/Map3D.tsx",
        "apps/web/src/components/DroneTrackLayer.tsx",
      ];
      const bad: string[] = [];
      for (const t of targets) {
        if (!exists(t)) continue;
        const body = read(t);
        if (/await\s+import\(\s*["']cesium["']\s*\)/.test(body)) {
          bad.push(`${t} still uses await import("cesium") — switch to loadCesium() from @/lib/cesium`);
        }
      }
      return bad.length ? bad.join("\n  ") : null;
    },
  },

  {
    id: "dockerfile-web-bakes-fabric-url",
    title: "Dockerfile.web accepts FABRIC_URL as a build ARG (rewrites need it)",
    run: () => {
      const df = read("infra/Dockerfile.web");
      return /ARG\s+FABRIC_URL\b/.test(df)
        ? null
        : "infra/Dockerfile.web does not declare ARG FABRIC_URL — Next.js rewrites get baked with localhost:4311 default and the in-container proxy 500s on /fabric/api/*";
    },
  },

  {
    id: "compose-passes-fabric-url-build-arg",
    title: "docker-compose passes FABRIC_URL into the web build",
    run: () => {
      const body = read("infra/docker-compose.yml");
      // Must appear inside the web service's `args:` block, not just env.
      // A simple substring check suffices because the only legitimate use
      // site is the build args block.
      const inArgs = /args:[\s\S]*?FABRIC_URL/.test(body);
      return inArgs
        ? null
        : "infra/docker-compose.yml does not pass FABRIC_URL as a build arg under the web service";
    },
  },
];

let failed = 0;
const report: string[] = [];
report.push(`drift-check: ${checks.length} assertions`);
report.push("");

for (const c of checks) {
  const err = c.run();
  if (err == null) {
    report.push(`  PASS  ${c.id.padEnd(40)} ${c.title}`);
  } else {
    failed += 1;
    report.push(`  FAIL  ${c.id.padEnd(40)} ${c.title}`);
    for (const line of err.split("\n")) report.push(`        ${line}`);
  }
}

report.push("");
report.push(failed === 0 ? "drift-check: OK" : `drift-check: ${failed} FAIL`);

process.stdout.write(report.join("\n") + "\n");
process.exit(failed === 0 ? 0 : 1);
