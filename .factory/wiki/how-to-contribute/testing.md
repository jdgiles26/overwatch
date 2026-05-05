# Testing

There are zero test files in this repository. `rg --files -g '*.test.*' -g '*.spec.*'` returns nothing across all four real workspaces. The `pnpm test` script is wired in `/package.json` (`"test": "pnpm -r run test"`) but no workspace defines a `test` script, so it's a no-op.

This page is the "if you want to add the first test, here's how" guide. It deliberately picks the smallest possible reasonable layer that fits the existing stack.

## What's there to test

Roughly five categories of code, in increasing order of effort:

| Layer | Files | Why test it |
|---|---|---|
| Pure functions | `apps/fabric/src/threatcon.ts`, `apps/fabric/src/alerts.ts`, `packages/connectors/src/util.ts` | No I/O. Easy. Highest value per line. |
| Schemas | `packages/schemas/src/index.ts` | Behavioural contract. Catches accidental shape changes. |
| Fastify routes | `apps/fabric/src/index.ts` | Use `fastify.inject()` — no real HTTP needed. |
| Connectors | `packages/connectors/src/sources/*.ts` | Mock `fetch` and assert emitted events. |
| React components | `apps/web/src/components/*.tsx` | `@testing-library/react` for the Zustand-driven views. |

Web Workers (`cvWorker.ts`, `topicWorker.ts`) and the WebGPU model loaders (`apps/web/src/lib/ai.ts`) are hard to test in unit form because they assume the browser. Treat those as integration territory.

## Recommended stack

**Vitest 1.x + @testing-library/react 16 + supertest** (or `fastify.inject()`).

Why Vitest:
- It uses the same Vite-style config and pipeline that Next 15 ships, so TypeScript, ESM, and `@huggingface/transformers`-style externals work without extra glue.
- It has a built-in mock layer (`vi.mock`, `vi.fn()`) that's nearly identical to Jest's.
- It runs `.ts` files directly the same way `tsx` already does for the fabric.

Why `@testing-library/react`:
- Already React-19 compatible as of 16.x.
- Plays nicely with Zustand: just import the real store and reset it in `beforeEach`.

Why `fastify.inject()` over supertest:
- No real port binding, no async cleanup, no server lifecycle.
- The fabric is a single Fastify instance that you can construct in a test and call `.inject({ method, url, payload })` on directly.

A pragmatic minimum:

```bash
pnpm add -D -w vitest@^1 @vitest/coverage-v8 happy-dom
pnpm --filter @overwatch/web add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Add to `/package.json`:

```jsonc
{
  "scripts": {
    "test":     "pnpm -r run test",
    "test:run": "pnpm -r --parallel run test:run"
  }
}
```

Add to each workspace `package.json` you want covered:

```jsonc
{
  "scripts": {
    "test":     "vitest",
    "test:run": "vitest run"
  }
}
```

## Sample vitest config

`/vitest.workspace.ts` (root):

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "apps/fabric",
  "apps/web",
  "packages/connectors",
  "packages/schemas",
]);
```

`apps/fabric/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: {
      "@overwatch/schemas": new URL("../../packages/schemas/src/index.ts", import.meta.url).pathname,
      "@overwatch/connectors": new URL("../../packages/connectors/src/index.ts", import.meta.url).pathname,
    },
  },
});
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@/lib": new URL("./src/lib", import.meta.url).pathname,
      "@/components": new URL("./src/components", import.meta.url).pathname,
      "@overwatch/schemas": new URL("../../packages/schemas/src/index.ts", import.meta.url).pathname,
    },
  },
});
```

`apps/web/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Stub the heavy WebGPU bundle so AnalystPanel etc. don't try to fetch models.
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  TextStreamer: class {},
  InterruptableStoppingCriteria: class { interrupt() {} },
  RawImage: { read: vi.fn() },
  env: { backends: {} },
}));
```

## Minimal first test plan

The four tests below give meaningful coverage of the moving parts that are most likely to regress without anyone noticing. They're the ones to write first.

### 1. `RuleEngine.evaluate()` — `apps/fabric/src/alerts.ts`

The rule engine is pure logic (apart from `recordFiring`) and covers a boolean matrix:

- `categories` filter
- `minSeverity` threshold
- `keywords` substring (case-insensitive)
- `bbox` containment
- `nearLocationId + nearKm` haversine
- `rateLimitMs` per-rule throttle

Recommended file: `apps/fabric/src/alerts.test.ts`. Pattern:

```ts
// apps/fabric/src/alerts.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./db.js", () => ({
  listLocations: vi.fn(() => [{ id: "loc1", label: "DC HQ", lat: 38.9, lon: -77.0 }]),
  listRules: vi.fn(() => [
    {
      id: "r1", label: "Severe weather near DC", enabled: true,
      notify: { desktop: true, sound: true, soundKind: "chime", severityFloor: "moderate" },
      condition: {
        categories: ["weather"],
        minSeverity: "high",
        keywords: ["tornado"],
        nearLocationId: "loc1", nearKm: 50,
        rateLimitMs: 1000,
      },
    },
  ]),
  recordFiring: vi.fn(),
}));

import { RuleEngine } from "./alerts.js";

const ev = (overrides: Partial<any> = {}): any => ({
  id: "e1", source: "nws", connectorId: "nws-alerts",
  category: "weather", severity: "high",
  title: "Tornado warning", summary: "near DC",
  occurredAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  geo: { lat: 38.9, lon: -77.0 },
  ...overrides,
});

describe("RuleEngine.evaluate", () => {
  let engine: RuleEngine;
  beforeEach(() => {
    engine = new RuleEngine();
  });

  it("matches when every condition is true", () => {
    const out = engine.evaluate(ev());
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toContain("severity high >= high");
    expect(out[0]?.reason).toContain('keyword "tornado"');
  });

  it("rejects on category mismatch", () => {
    expect(engine.evaluate(ev({ category: "seismic" }))).toEqual([]);
  });

  it("rejects when severity below floor", () => {
    expect(engine.evaluate(ev({ severity: "low" }))).toEqual([]);
  });

  it("rejects when keyword missing", () => {
    expect(engine.evaluate(ev({ title: "Heavy rain", summary: "DC" }))).toEqual([]);
  });

  it("rejects when geo outside radius", () => {
    expect(engine.evaluate(ev({ geo: { lat: 0, lon: 0 } }))).toEqual([]);
  });

  it("rate-limits repeated matches", () => {
    expect(engine.evaluate(ev())).toHaveLength(1);
    expect(engine.evaluate(ev({ id: "e2" }))).toHaveLength(0); // within 1000ms
  });
});
```

### 2. `computeThreatcon` — `apps/fabric/src/threatcon.ts`

`computeThreatcon` returns a deterministic score; assert the band thresholds:

```ts
// apps/fabric/src/threatcon.test.ts
import { describe, it, expect } from "vitest";
import { computeThreatcon } from "./threatcon.js";

const loc = (lat: number, lon: number) => ({
  id: "l1", label: "x", geo: { lat, lon }, radiusKm: 50, kind: "home" as const,
});
const ev = (severity: any, lat: number, lon: number) => ({
  id: `e-${Math.random()}`, source: "x", connectorId: "x",
  category: "weather" as const, severity,
  title: "x", occurredAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  geo: { lat, lon },
});

describe("computeThreatcon", () => {
  it("nominal when there are no events", () => {
    const tc = computeThreatcon([], [loc(0, 0)]);
    expect(tc.score).toBe(0);
    expect(tc.level).toBe("nominal");
  });

  it("escalates with multiple extreme events near a location", () => {
    const events = Array.from({ length: 5 }, () => ev("extreme", 0, 0));
    const tc = computeThreatcon(events, [loc(0, 0)]);
    expect(tc.score).toBeGreaterThanOrEqual(8);
    expect(tc.level).toBe("critical");
  });

  it("ignores events outside radius", () => {
    const tc = computeThreatcon([ev("extreme", 80, 0)], [loc(0, 0)]);
    expect(tc.level).not.toBe("critical");
  });
});
```

### 3. The briefing-context shape — `apps/web/src/components/AnalystPanel.tsx`

`AnalystPanel.runBriefing()` calls `apiGet("/api/briefing-context")`. The shape must match the LLM prompt's expectations: `{ threatcon, pir, counts, top: Array<{ id, cat, sev, title, where, when, src }> }`. A schema test (or a snapshot of the response shape) will catch regressions.

```ts
// apps/fabric/src/briefing-context.test.ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

// Light mock of the rest of the fabric so we can mount only this route.
vi.mock("./db.js", () => ({
  recentEvents: vi.fn(() => [
    {
      id: "e1", source: "nws", connectorId: "nws-alerts",
      category: "weather", severity: "high",
      title: "Tornado warning",
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      geo: { lat: 38.9, lon: -77.0 },
    },
  ]),
  listLocations: vi.fn(() => [{ id: "l1", label: "DC", lat: 38.9, lon: -77.0, radius_km: 25, kind: "home" }]),
}));

describe("/api/briefing-context", () => {
  it("returns threatcon, pir, counts, top", async () => {
    // Only practical if the route is factored into a registerable fn.
    // The current apps/fabric/src/index.ts is a monolithic top-level — see "Refactor" below.
  });
});
```

This test exposes a refactor opportunity: `apps/fabric/src/index.ts` is one big file with all routes mounted at module load. If you want to test routes via `fastify.inject()`, factor the route registrations into `registerRoutes(app)` so a test can construct a fresh Fastify instance per spec.

### 4. One or two connectors — `packages/connectors/src/sources/*.ts`

Mock global `fetch` and assert emitted events.

```ts
// packages/connectors/src/sources/usgs-quakes.test.ts
import { describe, it, expect, vi } from "vitest";
import { usgsQuakes } from "./usgs-quakes.js";

const fakeAbort = new AbortController();

it("emits a seismic event for each feature", async () => {
  const emit = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    features: [
      { id: "us1", properties: { mag: 5.2, place: "Anza, CA", time: 1700_000_000_000, title: "M 5.2" }, geometry: { coordinates: [-116, 33, 5] } },
    ],
  }), { status: 200 })));

  // Drive one iteration; abort after ~50ms so the loop exits.
  setTimeout(() => fakeAbort.abort(), 50);
  await usgsQuakes.run({
    config: usgsQuakes.defaultConfig as any,
    signal: fakeAbort.signal,
    log: vi.fn(),
    emit,
    now: () => new Date().toISOString(),
  });

  expect(emit).toHaveBeenCalled();
  const call = emit.mock.calls[0]?.[0];
  expect(call?.category).toBe("seismic");
  expect(call?.severity).toBe("high");
});
```

The pattern:
- Stub `fetch` with `vi.stubGlobal`.
- Provide a fake `ConnectorCtx` with a real `AbortController` so `await sleep(...)` will exit when you abort.
- Assert on the captured `emit` calls.

## Sample test file pattern

Place tests next to their source file with a `.test.ts` (or `.test.tsx`) suffix:

```
apps/fabric/src/
├── alerts.ts
├── alerts.test.ts          ← unit tests for RuleEngine
├── threatcon.ts
├── threatcon.test.ts       ← unit tests for computeThreatcon / computePIR
└── ...
```

This matches the existing `import { ... } from "./db.js"` style — relative `.js` imports continue to work in tests if the Vitest config has the workspace path mapping.

## React component example

```tsx
// apps/web/src/components/IntelFeed.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntelFeed } from "./IntelFeed";
import { useStore } from "@/lib/store";

describe("IntelFeed", () => {
  beforeEach(() => {
    useStore.setState({
      events: [
        {
          id: "e1", source: "nws", connectorId: "nws-alerts",
          category: "weather", severity: "high",
          title: "Tornado warning", summary: "DC area",
          occurredAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        },
      ],
      filter: { categories: new Set(), severities: new Set(), query: "" },
      timeWindow: null,
    } as any);
  });

  it("renders the event title", () => {
    render(<IntelFeed />);
    expect(screen.getByText("Tornado warning")).toBeInTheDocument();
  });
});
```

The Zustand store is a singleton — you can set it directly in `beforeEach`. No provider wrapping needed.

## What not to test (yet)

- **The Cesium globe.** Cesium touches `WebGLRenderingContext` and a worker pool at import time. Mocking it is a project unto itself.
- **The Hugging Face WebGPU pipeline.** Same problem squared.
- **Drag-and-drop / WebRTC playback.** Out of scope for unit tests; needs a real browser.

These are integration-level tests. If you want them, Playwright against `pnpm dev` is the realistic path, but it sits outside the scope of this guide.

## Honest caveat

None of the above exists yet. The current commit (`bc1d1ee`) ships zero `*.test.*` files. Adopt the layer above incrementally — start with `RuleEngine.evaluate` and `computeThreatcon`, then expand. The strictness of `tsc --noEmit` plus the visual feedback loop of `pnpm dev` covers more ground than typical untested code, but the moment a refactor of the rule engine or threatcon scoring lands without the corresponding tests, regressions will sneak in.

## See also

- [development-workflow](./development-workflow.md) — the workflow these tests would slot into.
- [debugging](./debugging.md) — the manual verification steps that fill the gap until tests exist.
- [patterns-and-conventions](./patterns-and-conventions.md) — the descriptive style guide; tests should follow the same conventions.
