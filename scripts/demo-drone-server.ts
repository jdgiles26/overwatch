/**
 * Demo drone frame server for local development.
 * Serves moving simulated drone frames on :8091/detections.
 *
 * Each frame includes lat/lon/alt so the drone-rf connector places the
 * target at the correct position (requires the per-frame geo feature in
 * packages/connectors/src/sources/drone-rf.ts).
 *
 * Run with:  pnpm tsx scripts/demo-drone-server.ts
 */

import http from "node:http";

const PORT = 8091;

// Drone 1: circles Washington DC area
let angle1 = 0;
const D1 = { lat: 38.9072, lon: -77.0369, r: 0.012, alt: 120, speed: 0.04 };

// Drone 2: straight approach from the south-east (evasive behaviour)
let d2Step = 0;
const D2_START = { lat: 38.865, lon: -76.99 };
const D2_END   = { lat: 38.925, lon: -77.06 };

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

const frameServer = http.createServer((_req, res) => {
  angle1 += D1.speed;
  const lat1 = D1.lat + Math.sin(angle1) * D1.r;
  const lon1 = D1.lon + Math.cos(angle1) * D1.r;
  const alt1 = D1.alt + Math.sin(angle1 * 3) * 25;

  d2Step = Math.min(d2Step + 0.008, 1);
  const lat2 = lerp(D2_START.lat, D2_END.lat, d2Step);
  const lon2 = lerp(D2_START.lon, D2_END.lon, d2Step);

  const frames = [
    {
      ts: new Date().toISOString(),
      nodeId: "demo-node-1",
      doppler: [0.6 + Math.sin(angle1) * 0.3, 0.3, 0.2],
      rssi: -55,
      rangeM: 120 + Math.sin(angle1) * 40,
      rangeErrorM: 22,
      lat: lat1,
      lon: lon1,
      alt: alt1,
    },
    {
      ts: new Date().toISOString(),
      nodeId: "demo-node-2",
      doppler: [0.4, 0.8 + Math.sin(d2Step * Math.PI) * 0.2, 0.1],
      rssi: -62,
      rangeM: 200,
      rangeErrorM: 40,
      lat: lat2,
      lon: lon2,
      alt: 85,
    },
  ];

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(frames));
});

frameServer.listen(PORT, () => {
  console.log(`\nDemo drone frame server on :${PORT}`);
  console.log(`  Drone 1 (demo-node-1): circles ${D1.lat.toFixed(4)},${D1.lon.toFixed(4)} r≈1.3 km`);
  console.log(`  Drone 2 (demo-node-2): straight approach from SE → downtown`);
  console.log(`\nPress Ctrl-C to stop.\n`);
});

process.on("SIGINT", () => { frameServer.close(); process.exit(0); });
