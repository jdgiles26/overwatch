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

---

## 11. Real-world correlation analysis with AI-generated DOD report — `XL` (multi-session)

**Status.** Foundation merged this session: `apps/fabric/src/correlation.ts`
(Pearson r + `isSignificantCorrelation` predicate) and tests. The rest
is planned across sessions 2–5 below.

**Motivation.** Operators ask "did event stream A drive event stream B?"
— e.g. did the geomagnetic-storm spike correlate with the GPS anomaly
cluster? Today THREATCON is per-stream; there's no cross-stream answer.

**Multi-session sketch.**

| Session | Stage | Deliverable |
|---|---|---|
| 1 ✅ done | Foundation | `correlation.ts` Pearson kernel + significance gate, pure-stats |
| 2 | Fabric route + bucketing | `POST /api/correlation` accepting two event filters + time window + bucket size, returning `{ r, significant, samples }` |
| 3 | Web panel | `CorrelationPanel.tsx` — picker for two filters, view r over time, cross-highlight to intel feed + map |
| 4 | Research connector | When `significant === true`, fire a one-shot scrape over a whitelisted RSS subset; persist excerpts to a new `research_notes` table |
| 5 | DOD-format report | Compose result + scraped notes via on-device LLM (`apps/web/src/lib/ai.ts`); render Markdown → printable HTML with DOD layout (classification header, BLUF, findings, recommendations, sources) |

**Blockers / risks.**
- Pearson on bucketed event counts misses causality, time lag, and
  confounders — document this in the panel; don't let users mistake
  correlation for causation.
- Scraping is rate-limited and may violate ToS; only the existing RSS
  catalog whitelist, no closed-source sites without explicit opt-in.
- LLM hallucination in the report — require citation back to scraped
  excerpts and visibly mark anything not cite-able as inferred.

**Dependencies.** `pearson` (done). Scraping piggybacks on the existing
`rss` connector. The DOD report renderer is new and isolated.

**Effort.** XL — split as above; no single session should attempt
more than one stage.



**below is list of prompts and ideas needing to be implemented before above ideas**



### Step 1: Feature Ideation Plan

**Here are 10 enhancements tailored to the OverWatch situational awareness dashboard:**

1. **Multi-Modal Video/CCTV Ingestion (VLM):** Fix the failing YOLO pipeline with an optimized WebGPU Vision-Language worker.
2. **Predictive Threat Trajectory Mapping:** Forecast the spread of fires, hazmat, or riots using Open-Meteo wind vectors.
3. **Automated SOP Agent Execution:** AI automatically drafts action plans for specific response teams based on the THREATCON.
4. **Temporal "Scrubbing" Time Machine:** Replay past events in the 3D globe to analyze the lead-up to a crisis.
5. **Dynamic Spatial-Temporal Filtering Rings:** Custom drawn geofences to instantly silence noisy data outside a critical zone.
6. **Decentralized P2P Data Mesh:** Fallback WebRTC mesh networking for reliability if the main intel server drops.
7. **Cognitive Load Balancing (Focus Mode):** UI automatically dims low-priority UI elements based on the analyst's high-stress context.
8. **Automated Alert Triage & De-duplication:** A secondary local AI model groups similar Reddit/News alerts to prevent feed flooding.
9. **Standardized Threat Export (STIX/TAXII):** One-click architecture to export intel to allied systems.
10. **Role-Based Generative UI:** The dashboard layout restructures itself dynamically whether logged in as "Analyst" or "Overseer."

---

### Step 2: Agentic Workflow Prompts (Ideas 1 & 2)

#### Idea 1: Multi-Modal Video/CCTV Ingestion (VLM)

```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Implement a WebGPU-accelerated Vision-Language Model (VLM) pipeline for the OverWatch 'Camera' feeds to replace the currently failing YOLO architecture.
context: |
  The application is a real-time situational awareness dashboard. The UI must remain perfectly smooth at 60fps.
guardrails:
  - STRICT: All VLM inference MUST execute inside a dedicated Web Worker to prevent main UI thread blocking.
  - STRICT: If WebGPU is unsupported by the browser, fallback to WebGL gracefully. DO NOT crash the application. Emit a localized UI toast warning.
  - STRICT: Throttle video frame sampling to a maximum of 1 FPS to manage memory footprint and prevent OOM errors.
execution_steps:
  1. Initialize the `@huggingface/transformers` VLM pipeline in a new file `vlm-worker.ts`.
  2. Create an `OffscreenCanvas` to capture RTSP frames securely.
  3. Stream bounding box coordinates and threat classifications back to the main Redux/Zustand state manager.
  4. Ensure futuristic UI rendering of the bounding boxes using glowing SVG/Canvas overlays.

```

### Step 4: Agentic Workflow Prompts (Ideas 5 & 6)
#### Idea 5: Dynamic Spatial-Temporal Filtering Rings

```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Implement user-drawn dynamic spatial-temporal geofences to instantly filter and silence low-priority telemetry outside of designated critical zones.
context: |
  OverWatch operators are currently overwhelmed by global alert noise. They need to draw custom "Focus Rings" on the Cesium 3D globe to isolate local incidents.
guardrails:
  - STRICT: Offload all geospatial point-in-polygon calculations to a dedicated Web Worker using Turf.js to prevent main thread UI stuttering.
  - STRICT: Do not delete data outside the rings; update their Redux state to `muted: true` and reduce their render opacity in the UI to 10%.
  - STRICT: Apply a modern 2026 glassmorphic UI effect to the active filter ring, with a subtle glowing edge indicating the active boundary.
execution_steps:
  1. Add a polygon drawing tool overlay to the Cesium canvas.
  2. Instantiate a `GeospatialWorker` to ingest the drawn polygon and stream the updated visibility state of all active markers back to the Redux store.
  3. Update the 3D entity rendering loop to automatically transition muted entities into a low-power visual state.

```

#### Idea 6: Decentralized P2P Data Mesh (Fallback)

```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Engineer a fallback WebRTC Peer-to-Peer (P2P) mesh network using CRDTs to keep the dashboard operational if the primary intelligence server goes offline.
context: |
  System reliability is paramount. If the main WebSocket drops, connected operator instances must form a mesh to share local threat state and observations.
guardrails:
  - STRICT: Use a Conflict-free Replicated Data Type (CRDT) library (like Yjs or Automerge) to handle peer state resolution without data corruption.
  - STRICT: All WebRTC data channel payloads MUST be end-to-end encrypted using the Web Crypto API.
  - STRICT: If fallback mode triggers, the UI must display a high-contrast, pulsing "P2P MESH ACTIVE" warning banner across the top header.
execution_steps:
  1. Monitor the primary WebSocket connection; on `close` or timeout, immediately initialize the WebRTC P2P signaling phase.
  2. Bind the active Redux threat state to a Yjs shared document.
  3. Sync the Yjs document across all connected peers, mapping state updates back into the UI transparently.

```

---

### Fact Citing & Validation

* **Fact:** Web Workers can efficiently handle heavy geospatial point-in-polygon computations off the main thread to maintain 60fps rendering.
1. [Turf.js: Advanced Geospatial Analysis](https://turfjs.org/)
2. [MDN Web Docs: Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
3. [Mapbox: Optimizing Map Performance with Workers](https://docs.mapbox.com/help/troubleshooting/mapbox-gl-js-performance/)


* **Fact:** WebRTC data channels combined with Conflict-free Replicated Data Types (CRDTs) enable robust, decentralized state synchronization when central servers fail.
1. [WebRTC API Documentation - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
2. [Yjs: A CRDT Framework for Real-Time Collaboration](https://yjs.dev/)
3. [Automerge: CRDT for JSON-like Data Syncing](https://automerge.org/)



Shall we proceed to the prompts for **Ideas 7 & 8**, which focus on cognitive load balancing and automated alert triage?
#### Idea 2: Predictive Threat Trajectory Mapping

```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Develop a Predictive Threat Trajectory engine for spatial events (Wildfires, Airborne Hazards, Transport anomalies).
context: |
  OverWatch uses a 3D Globe (Cesium) and 2D map. Current alerts are static. Analysts need to see 1-hour and 6-hour forecasted threat expansion cones.
guardrails:
  - STRICT: Base all trajectory calculations on the existing Open-Meteo wind speed/direction feed to ensure data consistency.
  - STRICT: Do NOT mutate the raw intelligence data state. Generate predictive layers as isolated, toggleable UI visual states.
  - STRICT: Render output as low-opacity, animated polygon overlays (using 2026 UI standards) in the Cesium environment.
execution_steps:
  1. Create a `TrajectoryEngine` class that accepts an origin coordinate `[lat, lng]`, wind vector, and event severity.
  2. Output a GeoJSON Polygon representing the predicted danger zone.
  3. Bind the GeoJSON layer to the Cesium instance with an eye-catching, pulsing animation to denote "predicted" vs "actual" data.

```
### Step 3: Agentic Workflow Prompts (Ideas 3 & 4)
#### Idea 3: Automated SOP Agent Execution
```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Integrate a LangGraph-based AI agent framework to automatically draft and propose Standard Operating Procedures (SOPs) for dispatch teams based on current THREATCON levels.
context: |
  OverWatch operators require rapid tactical suggestions. The agent must read live context but NOT autonomously dispatch units without human approval.
guardrails:
  - STRICT: Implement a Human-in-the-Loop (HITL) approval gate for all generated action plans.
  - STRICT: Ensure the agent's state graph isolates the reasoning loop from the execution phase.
  - STRICT: Render the proposed SOP in a futuristic, 2026-style glowing glassmorphism modal with clear "APPROVE" or "DENY" biometric-style toggles.
execution_steps:
  1. Initialize the LangGraph state machine with nodes for `AnalyzeThreat`, `DraftSOP`, and `AwaitHumanApproval`.
  2. Connect the `DraftSOP` node to the UI state manager via WebSockets to stream the generated plan.
  3. Create an immutable audit log entry once the human operator approves the SOP.

```

#### Idea 4: Temporal "Scrubbing" Time Machine

```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Build a Temporal "Scrubbing" slider enabling analysts to replay past geospatial events and system states on the 3D Cesium globe.
context: |
  The dashboard currently displays real-time data. Analysts need a "time machine" to scrub backward through the Redux state history and time-dynamic Cesium elements.
guardrails:
  - STRICT: Utilize Redux time-travel debugging concepts to replay the application state without mutating the active real-time data feed buffer.
  - STRICT: Hook the scrubber UI directly to the Cesium `ClockViewModel` and `AnimationViewModel` to synchronize 3D layer animations with application state.
  - STRICT: Lazy-load historical state chunks via IndexedDB to prevent browser Out-of-Memory (OOM) crashes.
execution_steps:
  1. Implement a custom, neon-accented timeline slider component docked at the bottom of the viewport.
  2. Map the slider's `onChange` event to the Redux dispatcher to jump to historical state snapshots.
  3. Sync the Redux state timestamp with `Cesium.JulianDate` to seamlessly render past 3D bounding boxes and fire paths.

```

---

### Fact Citing & Validation

* **Fact:** Agentic architectures can enforce human-in-the-loop workflows and isolate reasoning using frameworks like LangGraph.
1. [LangGraph: Agent Orchestration Framework for Reliable AI Agents](https://www.langchain.com/langgraph)
2. [LangChain: Bridging the Gap to Production-Grade AI Agents](https://focused.io/lab/langchain-bridging-the-gap-to-production-grade-ai-agents)
3. [AI Agent Frameworks: Tools For AI Development in 2026](https://www.temok.com/blog/ai-agent-frameworks)


* **Fact:** Web applications can achieve time-dynamic visualization and historical replays using Redux state snapshots paired with CesiumJS temporal engines.
1. [Getting Started with Redux State Containers](https://redux.js.org/introduction/getting-started)
2. [Time-Travel Debugging with Redux](https://cursa.app/en/page/time-travel-debugging-with-redux)
3. [Cesium Time Animation using CZML](https://cesium.com/blog/2018/03/21/czml-time-animation/)



I am pausing here for your confirmation or structural adjustments before drafting the prompts for Ideas 5 and 6.
---
### Step 5: Agentic Workflow Prompts (Ideas 7 & 8)
#### Idea 7: Cognitive Load Balancing (Focus Mode)
```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Implement a dynamic "Focus Mode" that automatically dims or hides low-priority UI modules when the global THREATCON level reaches critical thresholds.
context: |
  During a crisis, operators face information overload. The UI must adaptively shed non-essential data (e.g., standard weather feeds, minor traffic alerts) to highlight the active threat vector.
guardrails:
  - STRICT: Bind the visibility and opacity states of all UI modules directly to the centralized Redux `threatLevel` state.
  - STRICT: Use CSS transitions (minimum 300ms ease-in-out) to fade out modules. Do NOT unmount them abruptly to avoid jarring screen shifts.
  - STRICT: Implement a manual "Override/Expand" toggle button using 2026 glassmorphism styling to allow operators to force-show hidden modules if needed.
execution_steps:
  1. Create a `useCognitiveLoad` React hook that calculates module priority against the current THREATCON level.
  2. Apply the hook to all secondary widgets, outputting a dynamic CSS class (`opacity-100` vs `opacity-20 pointer-events-none`).
  3. Mount a floating, neon-accented "Focus Mode Active" indicator in the top-right header that acts as the manual override toggle.
```
#### Idea 8: Automated Alert Triage & De-duplication
```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Deploy a local AI agent to cluster, de-duplicate, and summarize redundant OSINT (Reddit/News) feeds into single, high-value intelligence cards.
context: |
  Social media and news feeds flood the system with redundant reports of the same event. We require an AI pipeline to group these using local compute to maintain zero-latency offline capabilities.
guardrails:
  - STRICT: Utilize a local deepseek4 (ds4) model runtime via the `pi-ds4` provider package to ensure data never leaves the local metal.
  - STRICT: The AI must never delete raw alerts. It must group them into a single parent `IntelCard` object with an array of original source URLs attached.
  - STRICT: The clustering process must run asynchronously and yield to the main thread; use requestIdleCallback or a dedicated worker if feed volume exceeds 50 req/sec.
execution_steps:
  1. Initialize the `pi-ds4` client connection in a new `feed-triage-service.ts` file, targeting the `ds4/deepseek-v4-flash` model.
  2. Write a precise system prompt for the model: "Group the following incoming text alerts by incident. Return a JSON array of grouped incidents with a generated short summary."
  3. Render the grouped `IntelCard` in the UI with a "Sources (X)" expandable accordion to view the raw, de-duplicated links.

```
---
### Fact Citing & Validation
* **Fact:** Adaptive user interfaces that reduce visual clutter during high-stress scenarios significantly lower operator cognitive load and improve reaction times.
1. [Nielsen Norman Group: Cognitive Load in User Interfaces](https://www.nngroup.com/articles/minimize-cognitive-load/)
2. [Human Factors and Ergonomics Society: Control Room Design Standards](https://www.hfes.org/)
3. [UX Collective: Designing for High-Stress Environments](https://www.google.com/search?q=https://uxdesign.cc/designing-for-high-stress-environments-a-guide-for-ux-designers-b84555811b71)


* **Fact:** Local language models (like DeepSeek V4) can be deployed directly on metal for zero-latency, privacy-preserving text clustering and triage without relying on cloud APIs.
1. [DeepSeek AI Official Documentation](https://github.com/deepseek-ai)
2. [Hugging Face: Deploying Local LLMs for Production](https://huggingface.co/blog/inference-endpoints-llm)
3. [Towards Data Science: Real-time Text Clustering with Language Models](https://towardsdatascience.com/)



### Step 6: Agentic Workflow Prompts (Ideas 9 & 10)
#### Idea 9: Standardized Threat Export (STIX/TAXII)

```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Implement a one-click data export pipeline that serializes the current active threat state into STIX 2.1 JSON format for immediate sharing with allied intelligence systems.
context: |
  Operators need to instantly bundle current incident data, active boundaries, and threat classifications into a universally accepted format without leaving the main dashboard viewport.
guardrails:
  - STRICT: Ensure strictly typed adherence to the OASIS STIX 2.1 schema. Any missing mandatory fields must be intelligently mapped to "Unknown" rather than throwing validation errors.
  - STRICT: Execute the JSON serialization inside a dedicated Web Worker. Parsing thousands of active threat nodes on the main thread will cause UI stuttering.
  - STRICT: Attach a cryptographic hash (SHA-256) of the exported payload to an immutable Redux audit log for chain-of-custody tracking.
execution_steps:
  1. Add a high-visibility, metallic-styled "EXPORT INTEL" action button to the global navigation header.
  2. Map the localized Redux threat objects to STIX `Incident`, `Location`, and `Indicator` Domain Objects.
  3. Trigger an automatic file download or a direct API POST to a configured TAXII server upon successful generation.

```

#### Idea 10: Role-Based Generative UI
```yaml
# CLAUDE AGENTIC WORKFLOW PROMPT
objective: |
  Develop a Generative UI layout engine that dynamically restructures the dashboard components based on whether the authenticated user is an "Analyst" (needs granular data) or an "Overseer" (needs high-level aggregates and approval queues).
context: |
  A static layout limits operational efficiency. The UI must fluidly adapt its grid and widget priority based on the operator's specific mission role.
guardrails:
  - STRICT: Do NOT rely solely on client-side state for role enforcement. Ensure all underlying data feeds strictly validate the user's JWT role before pushing updates over WebSockets.
  - STRICT: Utilize modern CSS Grid transitions and Framer Motion to animate the layout shifts seamlessly. Do not unmount and remount the entire DOM tree abruptly.
  - STRICT: Use React `Suspense` boundaries to lazy-load role-specific widgets (like the 'Overseer Approval Matrix') only when that role is confirmed, saving memory bandwidth.
execution_steps:
  1. Create a `LayoutEngine` component that subscribes to the authenticated user's role state.
  2. Define two distinct grid templates: `grid-template-analyst` (focus on the Cesium 3D globe and raw feeds) and `grid-template-overseer` (focus on metrics, SOP approvals, and summarized intel).
  3. Animate the transition between layouts using shared layout IDs to create a premium, 2026-era UX feel.
```
---
### Fact Citing & Validation
* **Fact:** STIX (Structured Threat Information Expression) and TAXII (Trusted Automated Exchange of Intelligence Information) are the industry-standard protocols for securely exchanging cyber and physical threat intelligence.
1. [OASIS Cyber Threat Intelligence (CTI) Technical Committee](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=cti)
2. [CISA: Automated Indicator Sharing (AIS) Overview](https://www.google.com/search?q=https://www.cisa.gov/automated-indicator-sharing-ais)
3. [MITRE: Introduction to STIX and TAXII](https://stixproject.github.io/)
* **Fact:** Dynamic, component-driven layouts built with CSS Grid and React Suspense boundaries optimize both rendering performance and user context switching without blocking the main browser thread.
1. [React Documentation: Concurrent UI Patterns and Suspense](https://react.dev/reference/react/Suspense)
2. [MDN Web Docs: CSS Grid Layout and Fluid Typography](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout)
3. [Framer Motion: Shared Layout Animations and Fluid Interfaces](https://www.google.com/search?q=https://www.framer.com/motion/layout-animations/)
