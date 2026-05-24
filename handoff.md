# OverWatch — Agent Handoff Document

> **Last updated:** 2026-05-24
> **Local main:** `98889b0`
> **Remote (jdgiles26/main):** `98889b0` — in sync, no open PRs
> **Tests:** 196/196 pass (102 web + 89 fabric + 5 connectors)
> **Verify:** `pnpm verify` green across 9 workspaces
> **Working tree:** clean (last commit landed via PR #4 merge)

This document supersedes prior handoffs. Read it cover-to-cover before any
substantive change; it captures everything an incoming agent would
otherwise have to re-derive from `git log`.

---

## 1. Repo topology

```
overwatch/                  pnpm monorepo, 2 apps + 6 packages, all private
├── apps/
│   ├── fabric/             Fastify + better-sqlite3 + WS hub, :4311
│   └── web/                Next.js 15.5.18 + React 19 dashboard, :3311
├── packages/
│   ├── schemas/            Shared Zod schemas — ACTIVE
│   ├── connectors/         23 data-source connectors — ACTIVE
│   ├── agent/              Scaffolded placeholder (README + tsconfig)
│   ├── ai/                 Scaffolded placeholder
│   ├── cv/                 Scaffolded placeholder
│   └── ui/                 Scaffolded placeholder
├── scripts/                seed-demo / demo-drone-server / smoke-drone
├── infra/                  docker-compose + go2rtc.yaml + Dockerfiles
├── docs/                   FEATURES.md, plans/, specs/, README index
├── future/                 IDEAS.md (11 forward-looking proposals)
└── .agents/                BASELINE.md (hard rules for AI coding agents)
```

Each top-level folder has its own README scoped to its concerns and
agent-friendly notes — start there before editing anything in that folder.

---

## 2. Recent commit history (newest first)

| SHA | Author | Summary |
|---|---|---|
| `98889b0` | dependabot (squash) | **PR #4** — Bump `ws` 8.20.0 → 8.20.1 (security fix: `websocket.close()` memory disclosure) |
| `39efc07` | this session | Serve Cesium runtime assets from same origin (no CDN CORS) |
| `666c514` | this session | SW skip 206 / opaque / Range responses, drop old caches on activate |
| `a6ec8a1` | this session | Anchor Next.js workspace root to repo (post Next 15.5 upgrade) |
| `77e93e6` | dependabot (squash) | **PR #3** — Bump Next 15.1.3 → 15.5.18 (11 security advisories) |
| `adf8be7` | this session | Split-view + rules-overwrite fixes + PIR click-to-expand + correlation foundation |
| `0af9b34` | merge | jdgiles26/main into local (resolve modify/delete on HTML files) |
| `387050d` | parallel droid session | YOLO/VLM detection modes + drone detector engine + vitest harness |
| `4707c79` | droid auto-commit | Snapshot of earlier `handoff.md` |
| `487a0df` | this session | Per-folder READMEs + future/IDEAS.md + doc map in root |
| `89f2ebc` | this session | Scaffold 4 placeholder packages (agent/ai/cv/ui) |
| `299946c` | this session | Gitignore `.claude/` + `.factory/` |
| `f060ffa` | this session | Untrack runtime db/key + README intro cleanup |
| `ae41d52` | this session | Fix pnpm install/dev (allowBuilds + ignore-scripts=false) |

---

## 3. Architectural state — what works today

### 3.1 Backend (`apps/fabric`)
- HTTP + WS on `:4311`
- SQLite (WAL mode) with AES-256-GCM-encrypted connector configs at rest
- THREATCON derivation + 7 PIRs (`threatcon.ts`)
- Alert rule engine (`alerts.ts`) — **fixed this session**: previously every
  newly-created rule with empty-string id from the web UI overwrote the
  previous one via `INSERT OR REPLACE`. Now `normalizeRuleId()` in
  `apps/fabric/src/rules.ts` mints a fresh id for empty / whitespace / non-
  string inputs.
- Drone-RF aggregator + classification (`drone.ts`)
- 23 connector orchestration
- Pure Pearson correlation kernel (`correlation.ts`) — **new this session**,
  foundation for the multi-session correlation feature

### 3.2 Frontend (`apps/web`)
- Single Zustand store (`lib/store.ts`) — all UI state
- 3D globe via Cesium 1.140 — **Cesium assets now served from
  `/cesium/` same-origin** (was CDN with CORS issues)
- 2D map via MapLibre — **split-view + 2D rendering now works** after
  fixing the `grid-rows-1` + `min-h-0` layout regression in `MapView.tsx`
- Camera strip with per-tile detection mode (`OFF` / `YOLO` / `VLM` / `BOTH`)
- AI surfaces: Analyst chat, Overseer autonomous agent
- Vision Workers: VLM (LFM2-VL-450M) + YOLO (DETR-ResNet-50)
- Drone RF Worker
- Service worker (`public/sw.js`) — **fixed this session**: skips 206 /
  Range / opaque responses; cache bumped to v2 with activate-time
  invalidation of old caches

### 3.3 AI pipelines (3-tier fallback)
| Pipeline | WebGPU | WebGL | WASM | On fallback |
|---|---|---|---|---|
| Analyst LLM | Transformers.js | — | Transformers.js q8 | ErrorBanner |
| VLM (camera scene) | LFM2-VL-450M | TF.js MobileNet v2 | LFM2-VL-450M q8 | ErrorBanner |
| YOLO (drone obj-det) | DETR | TF.js coco-ssd lite | DETR q8 | ErrorBanner |
| Overseer / caption | Same as Analyst | — | Same as Analyst | ErrorBanner |
| Whisper STT | Same as Analyst | — | Same as Analyst | ErrorBanner |
| Frame capture | OffscreenCanvas | DOM `<canvas>` | — | ErrorBanner |

Maximum-functionality preservation: every tier works; the user is always
notified when not running on the best available backend.

`droneWorker.ts` (NLI drone classification) and `topicWorker.ts` (NLI
topic tagging) use `device: "wasm"` as a deliberate single-backend
choice — deberta-v3-xsmall NLI is sensitive on WebGPU.

### 3.4 Assessment panel — clickable PIRs
- Each PIR row in `AssessmentPanel.tsx` is a button: click to expand
  detail + linked evidence events
- "Show on map" CTA flies the globe to the first geo-located evidence
  event (uses `pirShowOnMapTarget` from `lib/pirDetail.ts`)
- Individual evidence rows are clickable to select + fly

---

## 4. Test inventory (196 total)

| Package | Count | Files |
|---|---|---|
| `@overwatch/web` | 102 | `agent.test.ts` (14), `ai.test.ts` (5), `backendSelector.test.ts` (5), `boundingBox.test.ts` (10), `cocoSsdAdapter.test.ts` (4), `detectionConfig.test.ts` (13), `droneDetectorEngine.test.ts` (14), `errors.test.ts` (5), `frameCapture.test.ts` (5), `mapLayout.test.ts` (3), `mobilenetVlmAdapter.test.ts` (8), `pirDetail.test.ts` (7), `rules.test.ts` (2), `toasts.test.ts` (7) |
| `@overwatch/fabric` | 89 | `alerts.test.ts` (23), `correlation.test.ts` (10), `db.test.ts` (23), `drone.test.ts` (6), `orchestrator.test.ts` (17), `rules.test.ts` (5), `threatcon.test.ts` (5) |
| `@overwatch/connectors` | 5 | `drone-rf.test.ts` (5) |

No E2E / browser tests. UI testing today is manual; a recorded playwright
harness is documented in `future/IDEAS.md` #9.

---

## 5. Untracked or excluded files

| Path | Reason | Action |
|---|---|---|
| `apps/web/public/cesium/` | 25 MB Cesium runtime assets, regenerated by `predev`/`prebuild` from `node_modules/cesium/Build/Cesium/` | Stays gitignored; refresh with `pnpm --filter @overwatch/web cesium:assets` |
| `apps/fabric/data/key.bin` | Auto-generated AES-256-GCM key (mode `0o600`), per-clone | Stays gitignored |
| `apps/fabric/data/overwatch.db*` | SQLite DB + WAL/SHM, regenerated on first start | Stays gitignored |
| `.claude/worktrees/*` | Per-user worktree dirs from this AI tool | Stays gitignored |
| `.factory/` | Per-user Factory.app tool config | Stays gitignored |

Working tree is clean as of this commit (`98889b0`). Run `git status` to
verify before any new work.

---

## 6. Known issues / pending tasks

### 6.1 In code, marked but not blocking
- `apps/web/src/components/cvWorker.ts:30` — fire detection is an explicit
  *heuristic placeholder* ("high-edge regions"). Not a real fire classifier.
  Would require a small image-classification model. Tracked informally.
- `docs/plans/2026-05-05-drone-airspace-detection.md:277` — MobileViT XXS
  ONNX artifact is out-of-repo (training is out of scope). The drone NLI
  worker uses a deterministic synthetic classifier today; a `TODO` flags
  where the real model would slot in.

### 6.2 Multi-session features in `future/IDEAS.md`
| # | Title | Status |
|---|---|---|
| 1 | Replace heuristic threat classifier with trained model | Sketched |
| 2 | Real RTSP camera E2E test in CI | Sketched |
| 3 | Multi-tenancy + per-org isolation | Sketched (XL) |
| 4 | Server-side ONNX inference (replace browser YOLO) | Sketched |
| 5 | Persistent event log with time-travel scrubber | Sketched |
| 6 | Connector audit pass (find silent no-ops) | Sketched |
| 7 | Schema migration framework | Sketched |
| 8 | Function-calling Overseer (replace JSON-extraction) | Sketched |
| 9 | Replay-driven UI testing harness (playwright) | Sketched |
| 10 | Incident view (collapse correlated events) | Sketched |
| 11 | Real-world correlation + AI DOD report | **Foundation merged** (Pearson kernel + significance gate); 4 more sessions planned (fabric route, web panel, scraping connector, DOD renderer) |

### 6.3 Operator-level pending
- **GitHub PAT in `~/.npmrc`** — flagged for rotation; not in repo, not in
  scope for any commit, but the operator should rotate at their discretion.
- **Stray `~/pnpm-lock.yaml`** — unrelated file in `$HOME` from an old
  install. The Next 15.5 fix (commit `a6ec8a1`) anchors `outputFileTracingRoot`
  to the repo so this no longer breaks builds, but it's harmless cruft.
- **Factory.app "Auto-commit updates" setting** — was responsible for two
  `auto-commit:` historical commits. Disable in Factory app settings if
  the unattended commits aren't wanted.
- **No SW unregister step in dev** — when iterating on `public/sw.js` you
  must manually unregister + hard-refresh via DevTools to pick up changes.

### 6.4 Live services
- Dev server expected on `:3311` (web) and `:4311` (fabric)
- After a Next major-minor bump, always nuke `apps/web/.next/` before
  restart — webpack chunk shape changes can produce
  `Cannot read properties of undefined (reading 'call')` runtime errors
  from stale chunks
- After dependency churn, browser tabs may need a hard-refresh + SW
  unregister to pick up new bundles

---

## 7. Commands reference

```bash
# Install / verify
pnpm install                              # uses pnpm 11.2.2 (corepack)
pnpm verify                               # typecheck + lint, all 9 workspaces
pnpm test                                 # 196 tests across 3 workspaces

# Dev (separate terminals)
pnpm --filter @overwatch/fabric dev       # :4311
pnpm --filter @overwatch/web dev          # :3311 (predev mirrors Cesium assets)

# Single-package tests
pnpm --filter @overwatch/fabric test
pnpm --filter @overwatch/web test
pnpm --filter @overwatch/connectors test

# Maintenance
pnpm seed                                 # seed demo data (fabric must be up)
pnpm --filter @overwatch/web cesium:assets   # force-refresh public/cesium/
rm -rf apps/web/.next                     # nuke Next cache after framework bump

# Git / push (jdgiles26 remote)
git push -u jdgiles26 main
gh pr list --repo jdgiles26/overwatch
gh pr merge <N> --repo jdgiles26/overwatch --squash --delete-branch
```

---

## 8. AI model registry

| Purpose | Model | Loader | Notes |
|---|---|---|---|
| Analyst chat | `HuggingFaceTB/SmolLM2-360M-Instruct` | `runChat` | Default; prone to hallucination |
| Analyst (option) | `HuggingFaceTB/SmolLM2-1.7B-Instruct` | same | Available in UI dropdown |
| Analyst (option) | `onnx-community/Qwen2.5-0.5B-Instruct` | same | Available |
| Analyst (option) | `onnx-community/Llama-3.2-1B-Instruct` | same | Available |
| Camera VLM | `onnx-community/LFM2-VL-450M-ONNX` | `visionWorker` | WebGPU / WASM |
| Camera VLM (WebGL fallback) | `@tensorflow-models/mobilenet` v2 α=1.0 | `visionWorker` | TF.js path |
| Camera object detection | `Xenova/detr-resnet-50` | `droneDetectorWorker` | WebGPU / WASM |
| Camera object detection (WebGL fallback) | `@tensorflow-models/coco-ssd` lite_mobilenet_v2 | `droneDetectorWorker` | TF.js path |
| Overseer vision | `Xenova/vit-gpt2-image-captioning` | `runVisionCaption` | Image-to-text |
| Topic / NLI | `Xenova/nli-deberta-v3-xsmall` | inline (`useTopicWorker`) | WASM-only |
| Voice STT | `Xenova/whisper-tiny.en` | `voice.ts` | WebGPU / WASM |

---

## 9. Guardrails for the next agent

These are project-level; the universal baseline is `.agents/BASELINE.md`.

1. **Preserve working state.** Verify before claiming done — run `pnpm
   verify && pnpm test`. Do not declare a UI fix complete without a
   browser test (and say so if you can't run one).
2. **Don't over-tighten `.gitignore`.** Verify what's tracked vs ignored
   before adding rules. Several files (key.bin, overwatch.db) are
   correctly listed and stay that way.
3. **Surface, don't push.** A local pre-push hook may block direct
   pushes; print the `git push` command for the operator rather than
   retrying.
4. **Don't touch encryption keys casually.** `apps/fabric/data/key.bin`
   is the AES key for connector configs at rest; rotating wipes
   readable config history.
5. **Worker / Cesium assets** must stay same-origin. If you add an asset
   the browser loads via `fetch`/`<script>`, verify CORS headers from
   the source — `cesium.com` doesn't send `ACAO`. Mirror to
   `public/cesium/` via the existing script.
6. **Next.js cache + browser SW** are sticky after framework upgrades.
   After any Next minor/major bump, nuke `.next/`, restart, and direct
   the user to hard-refresh + SW unregister.
7. **Don't add features beyond the ask.** Every commit in §2 is scoped
   and named. The pattern is: TDD, smallest possible diff, single
   responsibility per commit, Co-Authored-By if collaborating.
