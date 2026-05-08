"use client";
import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { DroneClassification, DroneTrack } from "@overwatch/schemas";

const DRONE_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="%23fff" opacity="0.9"/><line x1="12" y1="12" x2="4" y2="4" stroke="%23fff" stroke-width="1.5" opacity="0.7"/><line x1="12" y1="12" x2="20" y2="4" stroke="%23fff" stroke-width="1.5" opacity="0.7"/><line x1="12" y1="12" x2="4" y2="20" stroke="%23fff" stroke-width="1.5" opacity="0.7"/><line x1="12" y1="12" x2="20" y2="20" stroke="%23fff" stroke-width="1.5" opacity="0.7"/><circle cx="4" cy="4" r="2.5" fill="%23fff" opacity="0.8"/><circle cx="20" cy="4" r="2.5" fill="%23fff" opacity="0.8"/><circle cx="4" cy="20" r="2.5" fill="%23fff" opacity="0.8"/><circle cx="20" cy="20" r="2.5" fill="%23fff" opacity="0.8"/></svg>`;

type EntityBundle = {
  billboard: any;
  trail: any;
  ring: any;
  arc: any | null;
  cone: any[];
};

type Props = { viewerRef: React.MutableRefObject<any> };

function labelColor(Cesium: any, cls: DroneClassification | undefined): any {
  if (!cls) return Cesium.Color.fromCssColorString("#00ffff");
  if (cls.label === "hostile") return Cesium.Color.fromCssColorString("#ff3333");
  if (cls.label === "neutral") return Cesium.Color.fromCssColorString("#ff9900");
  return Cesium.Color.fromCssColorString("#00ffff");
}

// Never use fixed entity IDs for drone entities — Cesium enforces global
// uniqueness and React StrictMode / HMR can cause the same IDs to be added
// twice when cleanup fires with a null viewer. All entities are tracked by
// reference via bundlesRef instead.
function addEntity(viewer: any, def: object): any {
  return viewer.entities.add(def);
}

export function DroneTrackLayer({ viewerRef }: Props) {
  const droneTracks = useStore((s) => s.droneTracks);
  const droneClassifications = useStore((s) => s.droneClassifications);
  const bundlesRef = useRef<Map<string, EntityBundle>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const Cesium = await import("cesium");
      if (cancelled) return;

      const activeIds = new Set(droneTracks.map((t) => t.id));

      // Remove expired / gone tracks
      for (const [id, bundle] of bundlesRef.current.entries()) {
        if (!activeIds.has(id)) {
          try { viewer.entities.remove(bundle.billboard); } catch { /* ignore */ }
          try { viewer.entities.remove(bundle.trail); } catch { /* ignore */ }
          try { viewer.entities.remove(bundle.ring); } catch { /* ignore */ }
          if (bundle.arc) { try { viewer.entities.remove(bundle.arc); } catch { /* ignore */ } }
          for (const c of bundle.cone) { try { viewer.entities.remove(c); } catch { /* ignore */ } }
          bundlesRef.current.delete(id);
        }
      }

      for (const track of droneTracks) {
        if (track.state === "expired") continue;
        const cls = droneClassifications[track.id];
        const color = labelColor(Cesium, cls);
        const geo = track.positionHistory.at(-1)?.geo ?? track.geo;
        const alt = (geo.alt ?? 0) < 1 ? 100 : geo.alt!;

        const existing = bundlesRef.current.get(track.id);

        if (existing) {
          // Update billboard position
          existing.billboard.position = Cesium.Cartesian3.fromDegrees(geo.lon, geo.lat, alt);
          existing.billboard.billboard.color = color;

          // Update trail
          existing.trail.polyline.positions = buildTrailPositions(Cesium, track);
          existing.trail.polyline.material = buildTrailMaterial(Cesium, track, color);

          // Update prediction arc + cones
          if (cls?.predictedPath?.length) {
            if (!existing.arc) {
              existing.arc = addArc(viewer, Cesium, cls, color);
            } else {
              existing.arc.polyline.positions = Cesium.Cartesian3.fromDegreesArrayHeights(
                cls.predictedPath.flatMap((p) => [p.lon, p.lat, (p.alt ?? alt)]),
              );
              existing.arc.polyline.material = color.withAlpha(0.5);
            }
            // Cones encode confidence spread — always rebuild when classification updates.
            for (const c of existing.cone) { try { viewer.entities.remove(c); } catch { /* ignore */ } }
            existing.cone = addCone(viewer, Cesium, geo, alt, cls, color);
          }
          continue;
        }

        // Create new entity bundle (no fixed IDs — see addEntity note above)
        const billboard = addEntity(viewer, {
          position: Cesium.Cartesian3.fromDegrees(geo.lon, geo.lat, alt),
          billboard: {
            image: DRONE_SVG,
            width: 24,
            height: 24,
            color,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
          },
        });

        const trail = addEntity(viewer, {
          polyline: {
            positions: buildTrailPositions(Cesium, track),
            width: 2,
            material: buildTrailMaterial(Cesium, track, color),
            clampToGround: false,
          },
        });

        const ring = addEntity(viewer, {
          position: Cesium.Cartesian3.fromDegrees(track.geo.lon, track.geo.lat, 0),
          ellipse: {
            semiMajorAxis: Math.max(1, track.rangeM + track.rangeErrorM),
            semiMinorAxis: Math.max(1, track.rangeM - track.rangeErrorM),
            material: Cesium.Color.WHITE.withAlpha(0.08),
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.35),
            outlineWidth: 1,
            height: 0,
          },
        });

        let arc: any = null;
        let cone: any[] = [];
        if (cls?.predictedPath?.length) {
          arc = addArc(viewer, Cesium, cls, color);
          cone = addCone(viewer, Cesium, geo, alt, cls, color);
        }

        bundlesRef.current.set(track.id, { billboard, trail, ring, arc, cone });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [droneTracks, droneClassifications, viewerRef]);

  // Cleanup all entities on unmount — capture inside cleanup so we read the ref
  // at teardown time (viewer is set asynchronously, so it's null at mount).
  useEffect(() => {
    const bundles = bundlesRef.current;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const viewer = viewerRef.current;
      if (!viewer) return;
      for (const bundle of bundles.values()) {
        try { viewer.entities.remove(bundle.billboard); } catch { /* ignore */ }
        try { viewer.entities.remove(bundle.trail); } catch { /* ignore */ }
        try { viewer.entities.remove(bundle.ring); } catch { /* ignore */ }
        if (bundle.arc) { try { viewer.entities.remove(bundle.arc); } catch { /* ignore */ } }
        for (const c of bundle.cone) { try { viewer.entities.remove(c); } catch { /* ignore */ } }
      }
      bundles.clear();
    };
  }, [viewerRef]);

  return null;
}

function buildTrailPositions(Cesium: any, track: DroneTrack): any {
  const hist = track.positionHistory.slice(-30);
  if (hist.length < 2) {
    const g = track.geo;
    return Cesium.Cartesian3.fromDegreesArrayHeights([g.lon, g.lat, g.alt ?? 100, g.lon, g.lat, g.alt ?? 100]);
  }
  return Cesium.Cartesian3.fromDegreesArrayHeights(
    hist.flatMap((h) => [h.geo.lon, h.geo.lat, h.geo.alt ?? 100]),
  );
}

function buildTrailMaterial(Cesium: any, track: DroneTrack, color: any): any {
  if (track.state === "coasting") {
    return new Cesium.PolylineDashMaterialProperty({
      color: color.withAlpha(0.6),
      dashLength: 16,
    });
  }
  return color.withAlpha(0.75);
}

function addArc(viewer: any, Cesium: any, cls: DroneClassification, color: any): any {
  const positions = Cesium.Cartesian3.fromDegreesArrayHeights(
    cls.predictedPath.flatMap((p) => [p.lon, p.lat, p.alt ?? 100]),
  );
  return addEntity(viewer, {
    polyline: {
      positions,
      width: 1.5,
      material: color.withAlpha(0.5),
      clampToGround: false,
    },
  });
}

function addCone(
  viewer: any, Cesium: any,
  geo: { lat: number; lon: number; alt?: number },
  alt: number, cls: DroneClassification, color: any,
): any[] {
  const spreadDeg = (1 - cls.confidence) * 20;
  // Deduplicate offsets: when spreadDeg≈0 all three would be 0 → duplicate IDs.
  const offsets = spreadDeg < 0.01 ? [0] : [-spreadDeg, 0, spreadDeg];
  const entities: any[] = [];
  for (const offset of offsets) {
    const path = cls.predictedPath.slice(0, 15).map((p, i) => {
      const rad = ((offset * Math.PI) / 180) * (i / 14);
      return {
        lon: p.lon + Math.sin(rad) * 0.001 * i,
        lat: p.lat + Math.cos(rad) * 0.001 * i,
        alt: p.alt ?? alt,
      };
    });
    if (path.length < 2) continue;
    entities.push(
      addEntity(viewer, {
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(
            path.flatMap((p) => [p.lon, p.lat, p.alt]),
          ),
          width: 1,
          material: color.withAlpha(0.25),
          clampToGround: false,
        },
      }),
    );
  }
  return entities;
}
