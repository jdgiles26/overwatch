# Drone Airspace Detection PRD

## Problem

Overwatch has no awareness of low-altitude airspace threats. A hostile drone can loiter over a monitored area, approach a protected location, or conduct surveillance and the platform produces no signal — the existing computer-vision detectors only fire if the drone appears on a camera frame, and the OpenSky connector only surfaces transponder-equipped aircraft. Small commercial and military-grade drones are transponder-free by default, fly below conventional radar, and are increasingly used for hostile reconnaissance and payload delivery. Operators currently have no early-warning capability and no way to characterize intent before a drone reaches visual range.

## Solution

A passive RF airspace detection layer built on the ISAC (Integrated Sensing and Communication) bistatic sensing approach from Wang et al. (["Towards SISO Bistatic Sensing for ISAC"](https://github.com/Zhongqin-Wang/Towards-SISO-Bistatic-Sensing-for-ISAC)). Ground-based RF sensor nodes monitor channel state information (CSI) disruptions caused by drone rotor micro-Doppler signatures within their sensing zones. When a drone is detected, Overwatch:

1. Creates a live **DroneTrack** — a geospatial entity with position history, velocity, heading, and a Kalman-smoothed state estimate. During signal loss the track coasts forward as a **Ghost Track** (dashed rendering) for up to 60 seconds before expiry.
2. Renders a **WebGL Range Ring** in Cesium visualising the estimated detection radius and radial error margin from the sensing node, anchored to the node's known position.
3. Auto-locks the Cesium globe camera onto the active track, simulating a co-orbiting observer drone that follows and frames the target in real time.
4. Runs on-device ML inference via **MobileViT XXS** (WebGPU-accelerated, synthetically pre-trained on micro-Doppler signatures then fine-tuned on domain-specific flight kinematics) to predict flight path, estimated target, speed/heading, and a multi-factor aggression classification (hostile / neutral / unknown) with confidence score.
5. Emits a first-class `IngestEvent` (`category: "drone"`) into the existing alert rules, THREATCON, and PIR pipeline.

The sensing hardware is commodity (WiFi NIC with CSI extraction firmware, RTL-SDR, or dedicated ISAC node); Overwatch is sensor-agnostic and speaks MQTT or HTTP ingest.

## Architectural Decisions (Locked)

| Decision | Choice | Rationale |
|---|---|---|
| **ML model** | MobileViT XXS via WebGPU, synthetically pre-trained and transfer-learned on flight kinematics | Runs fully on-device, fits the existing `getOrCreatePipeline` / WebGPU path in `apps/web/src/lib/ai.ts`; synthetic training avoids dependency on labelled real-world capture datasets |
| **Single-node geo** | Dynamic WebGL Range Ring in Cesium; `DroneTrack.geo` is the node's position with a `rangeM` field encoding estimated range and `rangeErrorM` encoding uncertainty | A bistatic SISO node gives range + Doppler without bearing — a range ring honestly represents what is known and gives operators accurate situational awareness |
| **Track TTL / signal loss** | Predictive coasting via server-side Kalman: track stays active, rendered as dashed Ghost Track primitives in Cesium, for up to 60 seconds after last detection; expires if no new frame arrives | Preserves operator situational awareness through transient RF occlusion; 60 s is ~3× the maximum expected detection gap for a 20 Hz sensing node |
| **Aggression classifier features** | Full kinematic suite: evasion manoeuvres (heading variance vs. time), loitering detection (net displacement / path length ratio), altitude descent rate toward nearest Location, speed variance, payload estimation (hover stability signature), swarm synchronisation heuristics (cross-track temporal correlation against other active DroneTrack IDs) | Reduces false-positive hostile classification for transit drones; swarm heuristic enables escalation when multiple tracks move in coordinated patterns |
| **EventCategory** | `"drone"` — new enum member | Clean isolation for alert rules and PIR; `"air"` remains for manned/ADS-B aircraft; schema migration note below |

**Schema migration note:** Adding `"drone"` to `EventCategory` is additive to the Zod enum — existing events with other categories parse unchanged. Consumers that exhaustively switch on `EventCategory` (none currently in the codebase) would need a new case. The `EventCategory` enum is internal to this monorepo; no external breaking change.

## User Stories

- As an operator, I can see a real-time drone track on the 3D globe the moment an RF node detects a UAV in its sensing zone, so I know an incursion is happening before the drone reaches visual range.
- As an operator, I can see a WebGL Range Ring centred on the detecting RF node, showing the estimated detection radius and margin of error, so I understand the spatial confidence of the track.
- As an operator, I can watch the Cesium camera auto-follow the drone track — panning and zooming as the drone moves — so I get a continuous tactical picture without touching the controls.
- As an operator, I can see a Ghost Track (dashed trail) continue updating the projected position for up to 60 seconds when the RF signal is lost, so I am not left blind during transient occlusions.
- As an operator, I can read the predicted flight path arc on the globe (the next 30 s of trajectory) so I can anticipate which asset or location the drone is heading toward.
- As an operator, I can see an aggression score and classification (hostile / neutral / unknown) — derived from kinematic evasion, loitering, descent rate, payload stability, and swarm correlation — updated in real time, so I can make a proportional response decision.
- As an operator, I can see estimated speed, heading, altitude, and a predicted "intended target" label (derived from the projected path intersecting saved Locations) in a detail panel.
- As an operator, I can see a swarm alert when two or more active drone tracks are synchronised, so coordinated multi-drone incursions are surfaced immediately.
- As an operator, I can click a detected drone event in the IntelFeed and have it open the DroneDetailPanel, just as clicking any event opens EventDetail.
- As an operator, I can configure an alert rule with `categories: ["drone"]` and `minSeverity: "high"` so the siren fires only when a potentially hostile UAV is detected, not on every neutral overflight.
- As an operator, I can ask the Analyst "What is drone track DT-3 doing?" and get an LLM summary drawn from the current DroneTrack payload, just as I can ask about any other event.
- As a site engineer, I can register an RF sensor node as a connector instance (with MQTT broker URL, topic, and sensing-zone polygon) so new sensing nodes are added without code changes.
- As a site engineer, I can view a sensing-zone polygon drawn on Map2D showing the active coverage area of each RF node so I can identify dead zones.
- As an operator, I can see a new PIR answer — "Is hostile drone activity detected in the AO?" — in the Assessment panel so the THREATCON score correctly reflects aerial threat state.

## Architecture

### New / modified modules

| Module | Responsibility |
|---|---|
| `packages/schemas/src/index.ts` | Add `"drone"` to `EventCategory`; add `DroneTrack` Zod schema (id, nodeId, geo, rangeM, rangeErrorM, positionHistory, velocity, heading, altM, state: `"active"\|"coasting"\|"expired"`, coastingSince?); add `DroneClassification` schema (aggressionScore, label, confidence, evasionScore, loiterRatio, descentRate, payloadStability, swarmCorrelated, predictedPath, estimatedTarget); extend `ServerToClient` discriminated union with `{ type: "drone-track", data: DroneTrack }` and `{ type: "drone-classification", data: DroneClassification }` envelopes |
| `packages/connectors/src/sources/drone-rf.ts` | Connector subscribing to MQTT `{topic}` on `{brokerUrl}` or polling `{endpointUrl}` every `{intervalMs}` ms; deserialises detection frames `{ ts, nodeId, doppler: number[], rssi: number, csi?: number[], rangeM?: number }`, emits `IngestEvent { category: "drone", severity: derived, payload: frame }` |
| `apps/fabric/src/drone.ts` | **DroneTrackAggregator** — maps `nodeId` → open `DroneTrack`; applies Kalman filter (constant-velocity model) on each new detection frame; on detection gap > 5 s, transitions track to `"coasting"` and projects position from last velocity; expires track at 60 s coasting; broadcasts `drone-track` WS envelope on every state change; runs swarm correlation across all active tracks and sets `swarmCorrelated: true` when two or more tracks have correlated heading/speed within a 10 s window |
| `apps/web/src/components/droneWorker.ts` | Web Worker receiving `DroneTrack` messages; loads MobileViT XXS ONNX model via `getOrCreatePipeline`; computes aggression feature vector (evasionScore, loiterRatio, descentRate toward nearest Location, payloadStability from hover jitter, swarmCorrelated flag); runs inference; predicts 30-step flight path (position delta regression); posts `DroneClassification` back to main thread; re-runs on each position history update |
| `apps/web/src/components/DroneTrackLayer.tsx` | Cesium primitive layer — UAV billboard (colour: green=unknown, amber=neutral, red=hostile), historical trail polyline, dashed Ghost Track polyline when `state==="coasting"`, 30-step prediction arc, confidence cone (width = uncertainty), nearest-Location approach vector line, WebGL Range Ring (ellipse primitive centred on node geo with `semiMajorAxis=rangeM+rangeErrorM`, `semiMinorAxis=rangeM-rangeErrorM`); reacts to `droneTracks` and `droneClassifications` from store |
| `apps/web/src/components/DroneDetailPanel.tsx` | Slide-in panel — track ID and state badge, classification ring (hostile/neutral/unknown donut), speed/heading/altitude readout, predicted target Location chip, aggression sub-score breakdown (evasion, loiter, descent, payload, swarm), 30-second path prediction arc thumbnail, aggression timeline sparkline (last 60 s), raw payload accordion, "Follow track" / "Release" button |
| `apps/web/src/lib/store.ts` | Add `droneTracks: DroneTrack[]`, `droneClassifications: Map<string, DroneClassification>`, `followDroneId: string \| null`; `pushDroneTrack(t)` upserts by track `id`, caps at 100 tracks; `setDroneClassification(id, c)`; `setFollowDrone(id \| null)` |
| `apps/web/src/lib/ws.ts` | Handle `drone-track` → `pushDroneTrack`; handle `drone-classification` → `setDroneClassification`; auto-set `followDroneId` on first `extreme` drone track if none currently followed |
| `apps/web/src/components/Map3D.tsx` | New `useEffect` for `followDroneId` — on each track position update, call `viewer.camera.flyTo` with the track's latest geo at a fixed 800 m altitude offset and 45° pitch (co-orbiting observer perspective); transition to Ghost Track camera — slow drift on coasting state; release on expiry |
| `apps/fabric/src/threatcon.ts` | `drone` category weight: `+2.0` per active extreme-severity track, `+1.0` per active high-severity track; new PIR `"Is hostile drone activity detected in the AO?"` → `yes` if any `drone` event with `severity >= "high"` in the last 15 minutes, `unknown` if any `drone` event in the last 60 minutes, `no` otherwise |

### Data flow

```
RF node (MQTT / HTTP)
  → drone-rf connector (packages/connectors)
  → orchestrator → persistEvent + broadcast { type: "event", category: "drone" }
  → DroneTrackAggregator (apps/fabric/src/drone.ts)
      → Kalman filter + coasting state machine
      → swarm correlation check (cross-track)
      → broadcast { type: "drone-track", data: DroneTrack }
  → browser ws.ts → pushDroneTrack → store
      → DroneTrackLayer (Cesium: billboard, trail, ghost, range ring, prediction arc)
      → droneWorker.ts (MobileViT XXS on WebGPU)
          → DroneClassification → store.setDroneClassification
          → DroneDetailPanel (live read)
          → DroneTrackLayer (classification colour, confidence cone)
      → auto-follow if extreme and no current follow
  → IngestEvent also flows → IntelFeed, alert rules, THREATCON/PIR (unchanged pipeline)
```

### Sensor protocol

The `drone-rf` connector accepts two ingest modes (configured per-instance):

- **MQTT** — subscribes to `{topic}` on `{brokerUrl}`; each message is a JSON frame `{ ts, nodeId, doppler: number[], rssi: number, csi?: number[], rangeM?: number }`.
- **HTTP poll** — `GET {endpointUrl}` every `{intervalMs}` ms; same frame shape.

`rangeM` is optional; if absent, `DroneTrackAggregator` uses the default sensing range from the node's saved connector config. `rangeErrorM` defaults to 20% of `rangeM` if not supplied.

## Testing Strategy

**Unit (DroneTrackAggregator)** — feed a synthetic sequence of 10 detection frames for one track; assert single `DroneTrack` output with monotonically increasing position history; assert coasting transition at 5 s gap; assert expiry broadcast at 60 s gap. Feed two correlated tracks (matching heading + speed within 10 s); assert `swarmCorrelated: true` on both.

**Unit (droneWorker inference)** — known MobileViT XXS input vectors → assert deterministic output; assert loitering drone (net displacement / path length < 0.1) scores `loiterRatio > 0.8`; assert straight-transit drone scores `aggressionScore < 0.3`.

**Integration (drone-rf connector)** — local MQTT broker in CI; publish 5 synthetic frames; assert `IngestEvent { category: "drone" }` persisted in DB within 1 s.

**Integration (schema)** — assert `"drone"` parses as valid `EventCategory`; assert existing events with other categories parse unchanged; assert `DroneTrack` and `DroneClassification` round-trip through Zod.

**Browser (DroneTrackLayer)** — synthetic two-point active track: assert range ring ellipse primitive present; synthetic coasting track: assert trail polyline uses dashed material. Synthetic classification with `label: "hostile"`: assert billboard colour is red.

**E2E** — MQTT publish → WebSocket → store → `followDroneId` set → Cesium camera position within 0.01° lat/lon of track's latest geo.

## Scope

**In:**
- Passive RF detection via MQTT or HTTP ingest from commodity sensing hardware
- DroneTrack with Kalman-smoothed position, velocity, heading, coasting / Ghost Track up to 60 s
- WebGL Range Ring in Cesium showing detection radius and radial error per node
- Cesium globe auto-follow with co-orbiting observer camera perspective
- 30-second flight path prediction arc and confidence cone on globe
- MobileViT XXS aggression classifier: kinematic evasion, loitering, descent rate, payload stability, swarm synchronisation
- Swarm detection alert when ≥ 2 tracks are correlated
- Predicted intended target (nearest saved Location on projected path)
- DroneDetailPanel with all inference sub-scores and sparkline
- `"drone"` EventCategory (additive enum change) flowing through alert rules, THREATCON, PIR
- PIR: "Is hostile drone activity detected in the AO?"
- THREATCON weighting: +2.0 per extreme track, +1.0 per high track
- Sensing-zone polygon on Map2D per connector instance
- Multi-node support via `nodeId` (each node posts independently; no TDOA triangulation)

**Out:**
- Active RF jamming, spoofing, or counter-UAS actuation
- TDOA / multi-node triangulation (v2 — enabled by `nodeId` in frame payload)
- Drone-camera video integration (uses existing `CameraFeed` / `cv` pipeline independently)
- FAA UTM / LAANC regulatory lookups
- Specific drone make/model RF fingerprinting
- Mobile companion app
- MobileViT XXS training pipeline (model is a pre-built ONNX artifact; training is out-of-repo)

## Open Questions

All five original architectural questions are resolved. No open questions remain before planning.

> **Resolved decisions:** MobileViT XXS on WebGPU (synthetic transfer learning) · WebGL Range Ring in Cesium · Ghost Track coasting 60 s via Kalman · Full kinematic + payload + swarm aggression suite · `"drone"` as new `EventCategory` member (additive, no external breaking change).
