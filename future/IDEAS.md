# 10 Future Ideas — OverWatch

A seed list. Each idea has a sketch, dependencies, risks, and a
T-shirt sizing. None of these are committed; promote to `docs/plans/`
when scoping begins.

---

## 1. Replace heuristic threat classifier with a trained model — `M`

**Motivation.** Today `drone.ts` classifies tracks via hand-tuned
heuristics on RF features (`apps/fabric/src/drone.ts`). Heuristics
drift as the connector set widens; a small classifier (logreg or
gradient-boosted tree) trained on labeled tracks would generalize
better and produce calibrated confidence scores.

**Sketch.** Add a `drone-classifier` package that exports
`classify(track: DroneTrack): DroneClassification`. Train offline
from `events.json` exports; ship the model as ONNX bundled with
fabric. Fall back to heuristics if the model fails to load.

**Dependencies.** A labeled corpus of drone-RF tracks (we don't have
one yet — need to label ~500 tracks from live + simulator data).

**Risks.** Mislabeled training data could produce worse-than-heuristic
calibration. Mitigation: shadow the model behind the heuristic for
N days and compare predictions before flipping the default.

**Effort.** M (1–2 weeks including labeling).

---

## 2. Real RTSP camera integration end-to-end test — `M`

**Motivation.** `infra/go2rtc.yaml` advertises RTSP→WebRTC but nothing
in CI validates the path. `scripts/smoke-drone.ts` is the model — we
need `smoke-camera.ts` that spins up go2rtc against a known RTSP
test stream and asserts a WHEP playback handshake.

**Sketch.** Use `playwright` headless to navigate to a camera tile,
wait for the video element to acquire ≥1 second of playback, and
assert latency ≤500 ms. Run nightly in CI; fail loudly.

**Dependencies.** Public RTSP test stream that's actually stable
(NOT the BBB demo, which is HLS-only).

**Risks.** WebRTC is finicky on macOS containers — may need a Linux-
only CI lane.

**Effort.** M (4–6 days).

---

## 3. Multi-tenancy + per-org connector isolation — `XL`

**Motivation.** Today fabric is single-tenant. SQLite `connector_instances`
has no `org_id`. The encrypted key is per-install, not per-org.

**Sketch.** Add `orgs`, `users`, `memberships` tables; add `org_id` FK
to every other tenant-scoped table; derive AES key per org from a
master KDF (HKDF). Add a Fastify auth plugin (JWT or session). The
web app gains an org switcher.

**Dependencies.** Decision on auth provider (in-app vs OIDC). Schema
migration tooling (currently absent — see idea #7).

**Risks.** Encryption-key derivation needs to be done right; key
rotation becomes per-org. Plan + threat-model required before any
code lands.

**Effort.** XL (multi-week, security-critical).

---

## 4. Replace browser-side YOLO with server-side ONNX runtime — `L`

**Motivation.** `Xenova/detr-resnet-50` runs OK on WebGPU but pegs
the GPU on mid-range devices, and the model download (≈160 MB) is a
brutal first-load. A server-side inference path lets weaker clients
participate without bundling the model.

**Sketch.** Add a `cv-server` worker (Node + `onnxruntime-node`)
that accepts JPEG frames over WS and returns `CvDetection[]`. The
browser becomes a thin RTP→JPEG transcoder. Add a per-tile toggle:
`local` / `server` / `off`.

**Dependencies.** `@overwatch/cv` placeholder extraction (already
scaffolded — see `packages/cv/README.md`).

**Risks.** Doubles inference cost on the server side; needs GPU
or it'll bottleneck. Mitigation: cap concurrent inference jobs.

**Effort.** L (2 weeks).

---

## 5. Persistent event log with time-travel scrubber — `M`

**Motivation.** `TimeScrubber.tsx` exists but currently only filters
in-memory events. We don't actually persist a long-tail event log —
SQLite stores recent events but there's no view query that retrieves
"the world as it looked at 14:32:11".

**Sketch.** Add a `GET /api/snapshot?at=<iso>` route on fabric that
returns all entities (events, drone tracks, threatcon, alerts) as
they would have been at that timestamp. Reconstruct from the existing
event log + a snapshot every N minutes for fast seek. Wire the
time-scrubber to load snapshots on drag-release.

**Dependencies.** None — DB already has timestamps on every event.

**Risks.** Snapshot reconstruction is O(events-since-last-snapshot);
need a snapshot cadence that bounds latency.

**Effort.** M (1 week).

---

## 6. Replace mock Wikipedia/Reddit connectors with real-stream variants — `S`

**Motivation.** `wikipedia-rc` and `reddit` are documented as live
but some implementations short-circuit to fixtures during connector
errors. Auditing the connector source files turned up no `mock` /
`fixture` literals — but verify by load-testing each connector for a
24-hour window and recording event volumes.

**Sketch.** A weekend audit pass: run each connector in isolation for
24h via `scripts/audit-connector.ts <id>`; assert non-zero throughput
and reasonable event diversity. File issues for any connector that
silently no-ops.

**Dependencies.** A new audit script (small).

**Risks.** None.

**Effort.** S (1–2 days).

---

## 7. Schema migration framework for `apps/fabric/src/db.ts` — `M`

**Motivation.** Today schema changes are ad-hoc inline `CREATE TABLE
IF NOT EXISTS` and `ALTER TABLE` statements scattered through `db.ts`.
No version table. No rollback. No CI guard against destructive ops.

**Sketch.** Introduce `migrations/` directory with `0001_init.sql`,
`0002_<change>.sql`, etc. Add a `schema_version` table; replay
unapplied migrations on startup. Forbid `DROP TABLE` outside a
gated `down` migration. Write tests for each forward + back migration.

**Dependencies.** None — pure refactor.

**Risks.** Existing DBs in the wild need a one-time bootstrap that
inserts the right `schema_version` for the implicit current schema.

**Effort.** M (3–4 days including writing tests for the back path).

---

## 8. Better Overseer agent — function-calling instead of JSON-extraction — `L`

**Motivation.** `agent.ts` parses small-model output by extracting
JSON from chatty prose. `parseAction` has 20+ branches handling
markdown fences, repeated braces, leading thoughts, etc. It works
but is fragile.

**Sketch.** Switch the on-device model to a function-calling-capable
small LM (e.g. `Qwen2.5-Coder` or fine-tuned `SmolLM2`) and define
each whitelisted action as a tool schema. The model emits structured
tool calls; we run them. Keep the existing parser as a fallback.

**Dependencies.** Find a sub-2GB function-calling-capable LM that
runs on WebGPU. (As of writing, Qwen2.5-Coder-1.5B is the leading
candidate.)

**Risks.** Browser memory pressure with a larger model. Mitigate
by gating behind a "Pro mode" toggle.

**Effort.** L (1.5 weeks; mostly evaluation + harnessing).

---

## 9. Replay-driven UI testing harness — `M`

**Motivation.** `pnpm test` covers 125 cases but most are pure-logic.
The UI flows (e.g. "drone-track appears → DroneDetailPanel opens →
classification updates → alert fires") aren't tested. Manual smoke
testing is brittle and skipped under time pressure.

**Sketch.** Capture a deterministic event-stream recording from a
running fabric (`tee` the WS broadcast to a file), then add a
playwright test that boots web pointing at a fake WS that replays
the recording. Assert key DOM state at known timestamps.

**Dependencies.** Playwright already missing — must be added as devDep.

**Risks.** Flakiness from animation timing. Mitigate by using
`page.locator(...).waitFor({state: 'visible'})` instead of fixed
delays.

**Effort.** M (1 week including recording corpus).

---

## 10. New "Incident" view — collapse correlated events into stories — `L`

**Motivation.** The intel feed today is a flat stream. A magnitude-7
earthquake might produce 50 events (one per shake report, one per
aftershock, NWS aftermath alerts, social posts). These belong to
one *incident*, not 50 list rows.

**Sketch.** Add an `incidents` table on fabric that groups events by
spatial/temporal proximity + topic. Add an `IncidentTimeline.tsx`
panel that shows incidents instead of raw events, with a drilldown to
constituent events. Reuse the existing intel-feed component for the
detail view.

**Dependencies.** Topic-tagging is partially in place (`eventTopics`
in `store.ts`) — formalize and feed into incident grouping.

**Risks.** Bad grouping is worse than no grouping. Start opt-in (a
toggle) and tune thresholds based on real event volumes.

**Effort.** L (2 weeks; algorithm tuning is the long pole).
