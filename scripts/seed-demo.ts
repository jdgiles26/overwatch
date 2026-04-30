/**
 * Seed the fabric with demo locations, connectors, and cameras.
 * Run after the fabric is up:  pnpm seed
 */
const FABRIC = process.env.FABRIC_URL ?? "http://localhost:4311";

async function post(path: string, body: any) {
  const r = await fetch(`${FABRIC}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${path} -> ${r.status} ${t}`);
  }
  return r.json().catch(() => ({}));
}

async function main() {
  console.log(`Seeding fabric at ${FABRIC}`);

  for (const loc of [
    { id: "home-dc", label: "DC HQ", lat: 38.9072, lon: -77.0369, radiusKm: 30, kind: "home" },
    { id: "home-sf", label: "SF Office", lat: 37.7749, lon: -122.4194, radiusKm: 25, kind: "work" },
    { id: "home-tok", label: "Tokyo Lab", lat: 35.6762, lon: 139.6503, radiusKm: 40, kind: "other" },
  ]) {
    await post("/api/locations", loc);
    console.log("  + location", loc.label);
  }

  for (const cam of [
    {
      id: "cam-bunny",
      label: "Demo: Big Buck Bunny",
      source: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      kind: "hls",
      lat: 38.9,
      lon: -77.03,
      detectors: ["motion"],
    },
    {
      id: "cam-noaa-times",
      label: "EarthCam Times Sq (HLS)",
      source: "https://videos-3.earthcam.com/fecnetwork/9974.flv/playlist.m3u8",
      kind: "hls",
      lat: 40.7589,
      lon: -73.9851,
      detectors: ["motion", "person"],
    },
    {
      id: "cam-rtsp-demo",
      label: "Demo RTSP (go2rtc)",
      source: "ffmpeg:https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      kind: "rtsp",
      lat: 51.5074,
      lon: -0.1278,
      detectors: ["motion"],
      whepUrl: "http://localhost:1984/api/webrtc?src=bigbuckbunny",
    },
  ]) {
    await post("/api/cameras", cam);
    console.log("  + camera", cam.label);
  }

  const seedConnectors = [
    { connectorId: "demo-simulator", label: "Demo Simulator", config: {} },
    { connectorId: "usgs-quakes", label: "USGS Earthquakes", config: { feed: "all_hour", minMag: 1 } },
    { connectorId: "nws-alerts", label: "NWS Active Alerts", config: {} },
    { connectorId: "iss-location", label: "ISS Live", config: { intervalMs: 12000 } },
    { connectorId: "open-meteo", label: "Open-Meteo Weather", config: {} },
    { connectorId: "nasa-eonet", label: "NASA EONET Events", config: {} },
    { connectorId: "spacex-launches", label: "SpaceX Launches", config: { upcoming: true } },
    { connectorId: "hackernews", label: "Hacker News", config: { kind: "new", limit: 10 } },
    { connectorId: "coingecko", label: "Crypto Prices", config: {} },
    { connectorId: "reddit", label: "Reddit Worldnews", config: { subreddits: ["worldnews"], limit: 10 } },
    { connectorId: "noaa-swpc", label: "Space Weather", config: {} },
    { connectorId: "gdelt", label: "GDELT Global", config: {} },
    {
      connectorId: "rss",
      label: "BBC + CISA RSS",
      config: {
        urls: [
          "https://feeds.bbci.co.uk/news/rss.xml",
          "https://www.cisa.gov/cybersecurity-advisories/all.xml",
        ],
        category: "news",
      },
    },
    {
      connectorId: "mqtt-generic",
      label: "HiveMQ Public Demo",
      config: {
        url: "wss://broker.hivemq.com:8884/mqtt",
        topics: ["overwatch/demo/#"],
        category: "iot",
      },
    },
    { connectorId: "webhook", label: "Webhook /ingest/demo", config: { key: "demo", category: "iot" } },
  ];
  for (const c of seedConnectors) {
    try {
      const r = await post("/api/connectors", c);
      console.log("  + connector", c.label, r.id ?? "");
    } catch (e: any) {
      console.warn("  ! failed to add", c.label, e.message);
    }
  }
  console.log("Seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
