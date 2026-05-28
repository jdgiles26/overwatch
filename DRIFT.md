# DRIFT.md — Documentation ↔ Implementation Drift Register

> **Purpose.** A single, machine-checkable catalog of every place where the
> repository's documentation diverges from the running code, where a feature
> is half-built, where a claim is untrue, or where a scaffolded surface has
> never been filled in.
>
> **Authority.** When `DRIFT.md` and any other doc disagree about whether a
> feature is real, `DRIFT.md` wins. The other doc has a drift entry filed
> against it. Resolve by either (a) implementing the feature, (b) deleting
> the doc claim, or (c) moving it explicitly under `future/IDEAS.md`.
>
> **How to use this file.**
>
> - Every entry has a **status** (`OPEN`, `IN_PROGRESS`, `RESOLVED`) and an
>   **owner spec** under `docs/specs/drift-recovery/`.
> - `pnpm drift` (see `scripts/drift-check.ts`) asserts the mechanical
>   subset of these claims. Anything labelled `[auto]` is checked there
>   and will fail CI when it drifts again.
> - When you resolve a drift, **delete the row**, do not just flip the
>   status. The doc is meant to be small; the git history holds the trail.
> - When you discover a new drift, add a row here *first*, then write the
>   spec and the test.

---

## 1. Snapshot

| Metric | Claim location | Claim | Reality (2026-05-27) |
|---|---|---|---|
| Connector count | `CLAUDE.md`, `docs/FEATURES.md §6` header | 22 | **23** (see `packages/connectors/src/sources/`) [auto] |
| Connector count | root `README.md`, `apps/web/README.md` quickstart, `handoff.md` | 23 | 23 (consistent) |
| Tracked tests | `handoff.md §4` | 196 | needs re-count; `handoff.md` is two sessions stale |
| Working tree | `handoff.md` header | clean at `98889b0` | tip is past `98889b0`; document is stale |

The two-versus-three connector wording is the only place where the
docs disagree with each other. Everywhere else, drift is doc-vs-code.

---

## 2. Deployment

> All Docker / first-run rows have been resolved as of 2026-05-27 and
> removed from this register per the recovery rules. The constraints are
> now enforced mechanically in `scripts/drift-check.ts` so a regression
> would fail `pnpm verify` before it ever shipped. The next agent should
> add new deployment drift rows here if they appear.

---

## 3. Scaffolded packages that contain no code

All four were created in commit `89f2ebc` as extraction targets.
Every README ships an explicit **"Status: placeholder"** banner, so
this is not technically a lie — but the root README and `handoff.md`
both list them as part of `packages/` without flagging that they
re-export nothing. Treat each as drift until extraction lands.

| Package | Current source-of-truth location | Spec |
|---|---|---|
| `@overwatch/agent` | `apps/web/src/lib/agent.ts` | `docs/specs/drift-recovery/02-package-extraction-agent/` |
| `@overwatch/ai`    | `apps/web/src/lib/ai.ts`     | `docs/specs/drift-recovery/03-package-extraction-ai/` |
| `@overwatch/cv`    | `apps/web/src/components/{cv,vision,drone}Worker.ts` | `docs/specs/drift-recovery/04-package-extraction-cv/` |
| `@overwatch/ui`    | `apps/web/src/components/*.tsx` | `docs/specs/drift-recovery/05-package-extraction-ui/` |

`pnpm drift` asserts: if the package README still says `Status:
placeholder`, no other workspace may import from it. The day a
package is real, the assertion flips. [auto]

---

## 4. Models that pretend to be classifiers

### 4.1 Fire detection — **OPEN**

`apps/web/src/components/cvWorker.ts:30` runs an edge-density
heuristic and emits a `cv-detection` event tagged `fire`. The web UI
treats this as a real classifier; `docs/FEATURES.md` does not flag it
as a heuristic. Either replace with a small image classifier or
rename the event class to `high-edge-density-region` and remove the
"fire" presentation. Spec:
`docs/specs/drift-recovery/06-fire-detection-classifier/`.

### 4.2 Drone MobileViT XXS — **OPEN**

`docs/plans/2026-05-05-drone-airspace-detection.md:277` describes the
NLI drone classifier as a *placeholder* until a MobileViT XXS ONNX
artifact is dropped in. The artifact is out-of-repo and the
deterministic synthetic classifier ships in production paths. Spec:
`docs/specs/drift-recovery/07-drone-mobilevit-classifier/`.

---

## 5. Missing test surfaces

### 5.1 End-to-end / browser tests — **OPEN**

`handoff.md` ("No E2E / browser tests") and `future/IDEAS.md` #9 both
record this gap. Every "verify before claiming done" rule in
`.agents/BASELINE.md` and `CLAUDE.md` is currently unenforceable for
UI behavior — there is no harness. Spec:
`docs/specs/drift-recovery/08-e2e-playwright-harness/`.

### 5.2 Drift check itself — **CLOSED-BY-CONSTRUCTION**

The drift catalog enforces itself: `scripts/drift-check.ts` runs the
mechanical assertions marked `[auto]` above. `pnpm drift` is wired
into the verify pipeline.

---

## 6. Stale narrative documentation

### 6.1 `handoff.md` — **OPEN**

The file is the agent on-boarding contract. It claims:

- Local main is `98889b0`. Tip is past that.
- Working tree is clean. False at time of audit.
- Tests are 196/196. Likely true, but not re-verified.

Fix by either (a) wiring a `pre-push` hook that refreshes the header
from `git log` + `pnpm test -- --reporter=json`, or (b) shrinking
`handoff.md` to *only* the durable parts and deleting the snapshot
header. Both options are on the table — pick one in the spec.
Owner spec: `docs/specs/drift-recovery/09-handoff-freshness/`.

---

## 7. Conventions

- One row per drift, one spec per row.
- A spec without a failing test is half a spec.
- Resolving a drift means deleting the row, not annotating it.
