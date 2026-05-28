"use client";
import { useEffect, useMemo, useRef } from "react";
import { applyFilter, useStore } from "@/lib/store";
import { loadCesium } from "@/lib/cesium";
import { DroneTrackLayer } from "./DroneTrackLayer";
import type { IngestEvent } from "@overwatch/schemas";

export function Map3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const entitiesRef = useRef<Map<string, any>>(new Map());
  const trailsRef = useRef<Map<string, any>>(new Map());
  const events = useStore((s) => s.events);
  const filter = useStore((s) => s.filter);
  const timeWindow = useStore((s) => s.timeWindow);
  const followEntity = useStore((s) => s.followEntity);
  const locations = useStore((s) => s.locations);
  const flyTo = useStore((s) => s.flyTo);
  const setFlyTo = useStore((s) => s.requestFlyTo);
  const select = useStore((s) => s.selectEvent);
  const followDroneId = useStore((s) => s.followDroneId);
  const droneTracks = useStore((s) => s.droneTracks);
  const setFollowDrone = useStore((s) => s.setFollowDrone);

  const visibleEvents = useMemo(
    () =>
      applyFilter(events, filter, timeWindow)
        .filter((e) => e.geo)
        .slice(0, 1500),
    [events, filter, timeWindow],
  );

  // Build per-aircraft trails from successive ADS-B pings.
  const aircraftTrails = useMemo(() => {
    const byIcao = new Map<string, IngestEvent[]>();
    for (const e of events) {
      if (!e.geo) continue;
      const id = e.payload?.icao24;
      if (!id) continue;
      const arr = byIcao.get(id) ?? [];
      arr.push(e);
      byIcao.set(id, arr);
    }
    const trails: { id: string; path: [number, number][] }[] = [];
    for (const [id, arr] of byIcao) {
      if (arr.length < 2) continue;
      arr.sort(
        (a, b) =>
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
      const path = arr
        .slice(-12)
        .map((e) => [e.geo!.lon, e.geo!.lat] as [number, number]);
      trails.push({ id, path });
    }
    return trails.slice(0, 30);
  }, [events]);

  useEffect(() => {
    let destroyed = false;
    let viewer: any = null;
    (async () => {
      const Cesium = await loadCesium();
      // Load Cesium Workers / Assets / Widgets / ThirdParty from our own
      // origin. Mirrored into apps/web/public/cesium by
      // scripts/copy-cesium-assets.mjs (predev / prebuild). Refresh with:
      //   pnpm --filter @overwatch/web cesium:assets
      if (!document.getElementById("cesium-widgets-css")) {
        const link = document.createElement("link");
        link.id = "cesium-widgets-css";
        link.rel = "stylesheet";
        link.href = "/cesium/Widgets/widgets.css";
        document.head.appendChild(link);
      }
      Cesium.Ion.defaultAccessToken =
        process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "";

      if (destroyed || !containerRef.current) return;

      // Use OSM as a free imagery provider that needs no token
      const imagery = new Cesium.UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        credit: "© OpenStreetMap contributors",
        maximumLevel: 19,
      });
      viewer = new Cesium.Viewer(containerRef.current, {
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        timeline: false,
        animation: false,
        infoBox: false,
        selectionIndicator: false,
        fullscreenButton: false,
        // preserveDrawingBuffer + alpha lets us snapshot the WebGL canvas later.
        contextOptions: {
          webgl: { preserveDrawingBuffer: true, alpha: true },
        },
        baseLayer: Cesium.ImageryLayer.fromProviderAsync(Promise.resolve(imagery), {}),
      });
      // Mark the underlying canvas for the Overseer agent.
      try {
        viewer.scene.canvas.dataset.agent = "map-3d-canvas";
      } catch {
        /* ignore */
      }
      viewerRef.current = viewer;
      (window as any).__cesiumViewer = viewer;
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.fog.enabled = true;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0e14");
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#05070a");
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-30, 25, 18_000_000),
        duration: 1.2,
      });

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: any) => {
        const picked = viewer.scene.pick(click.position);
        if (picked?.id?.id) {
          select(String(picked.id.id));
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    })();

    return () => {
      destroyed = true;
      try {
        viewerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
    };
  }, [select]);

  // Sync entities with events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const Cesium = await loadCesium();
      if (cancelled) return;
      const seenIds = new Set(visibleEvents.map((e) => e.id));
      // Remove gone
      for (const [id, ent] of entitiesRef.current.entries()) {
        if (!seenIds.has(id)) {
          viewer.entities.remove(ent);
          entitiesRef.current.delete(id);
        }
      }
      for (const e of visibleEvents) {
        if (!e.geo) continue;
        const color = severityColor(Cesium, e.severity);
        const existing = entitiesRef.current.get(e.id);
        if (existing) {
          existing.position = Cesium.Cartesian3.fromDegrees(
            e.geo.lon,
            e.geo.lat,
            (e.geo.alt ?? 0) > 0 ? e.geo.alt! : 0,
          );
          continue;
        }
        const ent = viewer.entities.add({
          id: e.id,
          name: e.title,
          position: Cesium.Cartesian3.fromDegrees(
            e.geo.lon,
            e.geo.lat,
            (e.geo.alt ?? 0) > 0 ? e.geo.alt! : 0,
          ),
          point: {
            pixelSize: e.severity === "extreme" ? 12 : e.severity === "high" ? 10 : 6,
            color,
            outlineColor: Cesium.Color.fromCssColorString("#ffffff").withAlpha(0.5),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          description: `${e.title}<br/><small>${e.summary ?? ""}</small>`,
        });
        entitiesRef.current.set(e.id, ent);
      }

      // Aircraft trails (polylines per ICAO24)
      const trailIds = new Set(aircraftTrails.map((t) => `trail-${t.id}`));
      for (const [tid, ent] of trailsRef.current) {
        if (!trailIds.has(tid)) {
          viewer.entities.remove(ent);
          trailsRef.current.delete(tid);
        }
      }
      for (const t of aircraftTrails) {
        const tid = `trail-${t.id}`;
        const positions = Cesium.Cartesian3.fromDegreesArray(
          t.path.flatMap((p) => p),
        );
        const existing = trailsRef.current.get(tid);
        if (existing) {
          existing.polyline.positions = positions;
          continue;
        }
        const ent = viewer.entities.add({
          id: tid,
          polyline: {
            positions,
            width: 2,
            material: Cesium.Color.fromCssColorString("#5cf0c9").withAlpha(0.55),
            clampToGround: false,
          },
        });
        trailsRef.current.set(tid, ent);
      }

      // Locations as glow rings
      for (const loc of locations) {
        const id = `loc-${loc.id}`;
        if (entitiesRef.current.has(id)) continue;
        const ring = viewer.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(loc.geo.lon, loc.geo.lat, 0),
          ellipse: {
            semiMajorAxis: loc.radiusKm * 1000,
            semiMinorAxis: loc.radiusKm * 1000,
            material: Cesium.Color.fromCssColorString("#38e0b2").withAlpha(0.08),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#38e0b2"),
            height: 0,
          },
          label: {
            text: loc.label,
            font: "11px sans-serif",
            fillColor: Cesium.Color.fromCssColorString("#38e0b2"),
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        entitiesRef.current.set(id, ring);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleEvents, locations, aircraftTrails]);

  // Follow an aircraft if requested.
  useEffect(() => {
    if (!followEntity || followEntity.kind !== "icao24") return;
    const recent = events.find(
      (e) => e.payload?.icao24 === followEntity.value && e.geo,
    );
    if (!recent || !recent.geo || !viewerRef.current) return;
    (async () => {
      const Cesium = await loadCesium();
      viewerRef.current.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          recent.geo!.lon,
          recent.geo!.lat,
          200_000,
        ),
        duration: 1.0,
      });
    })();
  }, [followEntity, events]);

  // Co-orbiting camera follow for drone tracks
  useEffect(() => {
    if (!followDroneId || !viewerRef.current) return;
    const track = droneTracks.find((t) => t.id === followDroneId);
    if (!track || track.state === "expired") { setFollowDrone(null); return; }
    const geo = track.positionHistory.at(-1)?.geo ?? track.geo;
    (async () => {
      const Cesium = await loadCesium();
      viewerRef.current.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          geo.lon, geo.lat, (geo.alt ?? 0) + 800,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(track.headingDeg),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: track.state === "coasting" ? 3 : 0.5,
      });
    })();
  }, [followDroneId, droneTracks, setFollowDrone]);

  // Fly-to requests
  useEffect(() => {
    if (!flyTo || !viewerRef.current) return;
    (async () => {
      const Cesium = await loadCesium();
      viewerRef.current.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          flyTo.lon,
          flyTo.lat,
          (flyTo.zoom ? 5_000_000 / flyTo.zoom : 800_000),
        ),
        duration: 1.2,
      });
      setFlyTo(null);
    })();
  }, [flyTo, setFlyTo]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" data-agent="map-3d" />
      <DroneTrackLayer viewerRef={viewerRef} />
    </>
  );
}

function severityColor(Cesium: any, sev: string): any {
  const c = Cesium.Color.fromCssColorString;
  if (sev === "extreme") return c("#ff3860");
  if (sev === "high") return c("#ff6a3d");
  if (sev === "moderate") return c("#ffb020");
  if (sev === "low") return c("#5cf0c9");
  return c("#38e0b2").withAlpha(0.85);
}

